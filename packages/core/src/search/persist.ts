// Índice persistido (M3, CA3.2; §8.8): todo lo que necesita el buscador completo, en una forma que
// IndexedDB clona deprisa. Las listas de cadenas (nombres, claves y tokens) van en UTF-8, unidas
// con `\n`: restaurarlas es decodificar y partir, el doble de rápido que clonar 197 000 cadenas
// sueltas, y ocupan la mitad que una cadena unida (que pasa a 2 bytes por carácter con un solo
// nombre fuera de Latin-1). Los textos del pajar, también en UTF-8: la construcción los deja a 2
// bytes por carácter y, al decodificarlos, la parte de 1 byte vuelve a serlo (ocupa la mitad y
// `indexOf` la recorre ≈20 % más deprisa, medido en Node). El resto son *typed arrays*. Así, al
// restaurar no se normaliza ni se construye nada, y se pasa directamente a `full`.
//
// Dos partes, que se leen por separado (§8.8: «Restaurado → Completo: pajar listo»): lo
// principal, con lo que ya responden los niveles 0–2, y el pajar del nivel 3 (≈5 MB de ≈27). En el
// runner del CI, leer los 27 MB de IndexedDB tardaba el doble que en el PC: así la primera consulta
// no espera al pajar, que llega justo después (`restoreHaystack`).
//
// UTF-8 no puede llevar surrogados sueltos: con una cadena así no se guarda nada
// (`IndexFormatError` al empaquetar) y el índice se sigue construyendo en cada arranque.
//
// Sin E/S: el Worker lo guarda en `meta.searchIndex` y lo vuelve a leer. Un formato que no cuadra
// lanza `IndexFormatError`, y quien restaura vuelve a construir el índice. Va en su propia entrada
// (`@gameagenda/core/search-persist`), fuera de `search`: así el Worker lo carga en un *chunk*
// diferido, como uFuzzy, y su *chunk* de entrada sigue bajo los 40 KB (§6.2).
//
// Este módulo no importa nada en tiempo de ejecución (solo tipos): si el *chunk* diferido
// importara código del de entrada, WebKit volvería a evaluar el módulo de entrada del Worker, y un
// segundo *host* sin catálogo contestaría vacío a cada consulta (lo encontró el E2E en
// `webkit-movil`). Por eso devuelve las partes del índice y no el buscador: lo monta quien llama,
// con `searcherFromParts` de `@gameagenda/core/search`.

import type { Clock, CooperativeTask } from '../catalog-format/cooperative.ts';
import type { CoreCatalog, CoreKind } from '../catalog-format/tsv.ts';
import type { IndexData } from './full.ts';
import type { HaystackChunk, HaystackPart } from './haystack.ts';
import type { KeyData } from './keys.ts';

/** Sube cuando cambia esta forma o lo que la construcción guarda en ella. */
export const INDEX_FORMAT = 2;

/** Lo que el buscador completo necesita: claves por fila e índice (lo da `IndexBuilder.parts`). */
export interface IndexParts {
  readonly keys: KeyData;
  readonly index: IndexData;
}

/** Parte del pajar con su texto en UTF-8 (`HaystackPart` sin la cadena). */
export interface PackedHaystackPart {
  readonly bytes: Uint8Array;
  /** Longitud del texto en unidades UTF-16, para comprobarlo al decodificar. */
  readonly length: number;
  readonly offs: Uint32Array;
  readonly rows: Uint32Array;
}

export interface PackedHaystackChunk {
  readonly narrow: PackedHaystackPart;
  readonly wide: PackedHaystackPart;
}

/** Lista de cadenas en UTF-8, unidas con `\n` (ninguna lleva `\n`). */
export interface PackedStrings {
  readonly count: number;
  readonly bytes: Uint8Array;
}

/**
 * Una cadena por fila (nombres y claves base): `starts[g]` es dónde empieza la fila `g` en el
 * texto decodificado, en unidades UTF-16, y `starts[count]` = longitud del texto + 1. Al
 * restaurar no se parte: se decodifica una vez y cada fila se recorta cuando hace falta (con
 * CPU ×4, partir los nombres y las claves era el 60 % de restaurar).
 */
export interface PackedColumn extends PackedStrings {
  readonly starts: Uint32Array;
}

/** Cadenas de unas pocas filas: los nombres en español, sus claves y los alias. */
export interface PackedRows {
  readonly rows: Uint32Array;
  readonly values: PackedStrings;
}

export interface PersistedIndex {
  readonly format: typeof INDEX_FORMAT;
  readonly kind: CoreKind;
  readonly version: string;
  readonly count: number;
  readonly appid: Uint32Array;
  readonly flags: Uint8Array;
  readonly year: Uint16Array;
  readonly pop: Uint8Array;
  readonly names: PackedColumn;
  readonly nameEs: PackedRows;
  readonly kBase: PackedColumn;
  readonly artLen: Uint8Array;
  readonly kEs: PackedRows;
  readonly sortedAppid: Uint32Array;
  readonly rowOfSorted: Uint32Array;
  /** Alias compacto → filas: cada alias, repetido una vez por cada fila. */
  readonly aliases: PackedRows;
  readonly tokens: PackedColumn;
  readonly post: Uint32Array;
  readonly postStart: Uint32Array;
  readonly fwd: Uint32Array;
  readonly fwdStart: Uint32Array;
  readonly fwp: Uint32Array;
  readonly fwpStart: Uint32Array;
  /** Bitsets de prefijos de 1 carácter: las claves y, seguidos, los bitsets de `count / 32` palabras. */
  readonly bsAllKeys: readonly string[];
  readonly bsAll: Uint32Array;
  readonly bsFirstKeys: readonly string[];
  readonly bsFirst: Uint32Array;
}

/** El pajar del nivel 3, aparte: se lee después de lo principal. */
export interface PersistedHaystack {
  readonly format: typeof INDEX_FORMAT;
  /** Filas del núcleo al que pertenece. */
  readonly count: number;
  readonly chunks: readonly PackedHaystackChunk[];
}

/** Lo que se guarda: lo principal y el pajar, en dos filas de `meta`. */
export interface PackedIndex {
  readonly main: PersistedIndex;
  readonly haystack: PersistedHaystack;
}

/** El índice guardado no sirve (otro formato, datos truncados o de otra forma). */
export class IndexFormatError extends Error {
  override readonly name = 'IndexFormatError';
}

/** Cadenas por trozo al empaquetar: ≈1 ms en Node. */
const PACK_SLICE = 8192;

const encoder = new TextEncoder();

/** UTF-8 de `text`; con un surrogado suelto no se guarda (lo cambiaría por U+FFFD). */
function utf8(text: string): Uint8Array {
  if (typeof text.isWellFormed !== 'function' || !text.isWellFormed()) {
    throw new IndexFormatError('utf-8');
  }
  return encoder.encode(text);
}

/** Une y codifica `list` a trozos, cediendo el turno entre ellos. */
function* packStrings(
  list: readonly string[],
  done: { n: number },
): Generator<void, PackedStrings> {
  const parts: Uint8Array[] = [];
  let size = 0;
  for (let i = 0; i < list.length; i += PACK_SLICE) {
    const end = Math.min(list.length, i + PACK_SLICE);
    const text = list.slice(i, end).join('\n') + (end < list.length ? '\n' : '');
    const bytes = utf8(text);
    parts.push(bytes);
    size += bytes.length;
    done.n += end - i;
    yield;
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return { count: list.length, bytes };
}

/** Como `packStrings`, con dónde empieza cada fila en el texto decodificado (`PackedColumn`). */
function* packColumn(list: readonly string[], done: { n: number }): Generator<void, PackedColumn> {
  const starts = new Uint32Array(list.length + 1);
  let at = 0;
  for (let g = 0; g < list.length; g++) {
    starts[g] = at;
    at += (list[g] as string).length + 1;
    if ((g & 32767) === 32767) yield;
  }
  starts[list.length] = at;
  return { ...(yield* packStrings(list, done)), starts };
}

function* packRows(
  map: ReadonlyMap<number, string>,
  done: { n: number },
): Generator<void, PackedRows> {
  const rows = Uint32Array.from(map.keys()).sort();
  const values = yield* packStrings(
    Array.from(rows, (g) => map.get(g) as string),
    done,
  );
  return { rows, values };
}

function* packHaystack(chunks: readonly HaystackChunk[]): Generator<void, PackedHaystackChunk[]> {
  const part = (p: HaystackPart): PackedHaystackPart => ({
    bytes: utf8(p.text),
    length: p.text.length,
    offs: p.offs,
    rows: p.rows,
  });
  const out: PackedHaystackChunk[] = [];
  for (const chunk of chunks) {
    out.push({ narrow: part(chunk.narrow), wide: part(chunk.wide) });
    yield;
  }
  return out;
}

function packBitsets(map: ReadonlyMap<string, Uint32Array>, words: number) {
  const keys = [...map.keys()];
  const all = new Uint32Array(keys.length * words);
  keys.forEach((key, i) => {
    all.set(map.get(key) as Uint32Array, i * words);
  });
  return { keys, all };
}

function* packWork(parts: IndexParts, done: { n: number }): Generator<void, PackedIndex> {
  const { keys, index } = parts;
  const cat = keys.cat;
  const names = yield* packColumn(cat.name, done);
  const nameEs = yield* packRows(cat.nameEs, done);
  const kBase = yield* packColumn(keys.kBase, done);
  const kEs = yield* packRows(keys.kEs, done);
  const aliasKeys: string[] = [];
  const aliasRows: number[] = [];
  for (const [alias, rows] of keys.aliasExact) {
    for (const g of rows) {
      aliasKeys.push(alias);
      aliasRows.push(g);
    }
  }
  const aliases = {
    rows: Uint32Array.from(aliasRows),
    values: yield* packStrings(aliasKeys, done),
  };
  // Al construir, el diccionario es un `string[]`; restaurado (no se vuelve a guardar), una columna.
  const tokenArray = Array.isArray(index.tokens)
    ? (index.tokens as readonly string[])
    : Array.from({ length: index.tokens.length }, (_, i) => index.tokens.at(i) as string);
  const tokens = yield* packColumn(tokenArray, done);
  const words = (keys.n + 31) >>> 5;
  const bsAll = packBitsets(index.bsAll, words);
  const bsFirst = packBitsets(index.bsFirst, words);
  const haystack: PersistedHaystack = {
    format: INDEX_FORMAT,
    count: keys.n,
    chunks: yield* packHaystack(keys.haystack),
  };
  const main: PersistedIndex = {
    format: INDEX_FORMAT,
    kind: cat.kind,
    version: cat.version,
    count: cat.count,
    appid: cat.appid,
    flags: cat.flags,
    year: cat.year,
    pop: cat.pop,
    names,
    nameEs,
    kBase,
    artLen: keys.artLen,
    kEs,
    sortedAppid: keys.sortedAppid,
    rowOfSorted: keys.rowOfSorted,
    aliases,
    tokens,
    post: index.post,
    postStart: index.postStart,
    fwd: index.fwd,
    fwdStart: index.fwdStart,
    fwp: index.fwp,
    fwpStart: index.fwpStart,
    bsAllKeys: bsAll.keys,
    bsAll: bsAll.all,
    bsFirstKeys: bsFirst.keys,
    bsFirst: bsFirst.all,
  };
  return { main, haystack };
}

/**
 * Prepara el índice para guardarlo, a trozos de ≈1 ms (el Worker lo hace después de `full`, sin
 * retrasar las consultas). Los *typed arrays* se comparten con el buscador, no se copian.
 */
export function createIndexPacker(
  parts: IndexParts,
  options: { readonly now: Clock },
): CooperativeTask<PackedIndex> {
  const done = { n: 0 };
  const total = Math.max(
    1,
    2 * parts.keys.n + parts.index.tokens.length + parts.keys.aliasExact.size,
  );
  // Como `cooperate` de `catalog-format`, aquí mismo: este módulo no importa nada.
  const gen = packWork(parts, done);
  let result: PackedIndex | null = null;
  return {
    step(deadline) {
      while (result === null) {
        const next = gen.next();
        if (next.done) {
          result = next.value;
          break;
        }
        if (options.now() >= deadline) break;
      }
      return result !== null;
    },
    get progress() {
      return result === null ? Math.min(1, done.n / total) : 1;
    },
    get result() {
      return result;
    },
  };
}

/** Empaqueta de una vez (pruebas y banco de pruebas). */
export function packIndex(parts: IndexParts): PackedIndex {
  const task = createIndexPacker(parts, { now: () => 0 });
  while (!task.step(Number.POSITIVE_INFINITY)) {
    // sin plazo
  }
  return task.result as PackedIndex;
}

// --- Restaurar ---------------------------------------------------------------

function fail(what: string): never {
  throw new IndexFormatError(what);
}

function typed<T extends Uint8Array | Uint16Array | Uint32Array>(
  value: unknown,
  ctor: { new (...args: never[]): T },
  length: number | null,
  what: string,
): T {
  if (!(value instanceof ctor)) fail(what);
  if (length !== null && value.length !== length) fail(what);
  return value;
}

const decoder = new TextDecoder();

function unpackStrings(value: unknown, count: number | null, what: string): string[] {
  const packed = value as PackedStrings | undefined;
  if (typeof packed?.count !== 'number') fail(what);
  const bytes = typed(packed.bytes, Uint8Array, null, what);
  if (count !== null && packed.count !== count) fail(what);
  if (packed.count === 0) return [];
  const list = decoder.decode(bytes).split('\n');
  if (list.length !== packed.count) fail(what);
  return list;
}

/**
 * Una columna: la fila `g` y las filas `[from, to)`, recortadas del texto decodificado. Con `n`
 * `null`, vale el recuento guardado (el del diccionario).
 */
function unpackColumn(
  value: unknown,
  n: number | null,
  what: string,
): { count: number; at(g: number): string; range(from: number, to: number): string[] } {
  const packed = value as PackedColumn | undefined;
  if (typeof packed?.count !== 'number' || (n !== null && packed.count !== n)) fail(what);
  const count = packed.count;
  const text = decoder.decode(typed(packed.bytes, Uint8Array, null, what));
  const starts = typed(packed.starts, Uint32Array, count + 1, what);
  if (starts[0] !== 0 || starts[count] !== (count === 0 ? 0 : text.length + 1)) fail(what);
  return {
    count,
    at: (g) => text.slice(starts[g], (starts[g + 1] as number) - 1),
    range: (from, to) =>
      from >= to ? [] : text.slice(starts[from], (starts[to] as number) - 1).split('\n'),
  };
}

function unpackRows(value: unknown, what: string): { rows: Uint32Array; values: string[] } {
  const packed = value as PackedRows | undefined;
  const rows = typed(packed?.rows, Uint32Array, null, what);
  return { rows, values: unpackStrings(packed?.values, rows.length, what) };
}

function rowMap(value: unknown, n: number, what: string): Map<number, string> {
  const { rows, values } = unpackRows(value, what);
  const map = new Map<number, string>();
  for (let i = 0; i < rows.length; i++) {
    const g = rows[i] as number;
    if (g >= n) fail(what);
    map.set(g, values[i] as string);
  }
  return map;
}

function bitsets(keys: unknown, all: unknown, words: number, what: string) {
  if (!Array.isArray(keys) || !keys.every((k) => typeof k === 'string')) fail(what);
  const data = typed(all, Uint32Array, keys.length * words, what);
  const map = new Map<string, Uint32Array>();
  keys.forEach((key: string, i) => {
    map.set(key, data.subarray(i * words, (i + 1) * words));
  });
  return map;
}

function haystackOf(value: unknown, n: number): HaystackChunk[] {
  if (!Array.isArray(value)) fail('haystack');
  const part = (p: unknown): HaystackPart => {
    const { bytes, length, offs, rows } = (p ?? {}) as Partial<PackedHaystackPart>;
    const text = decoder.decode(typed(bytes, Uint8Array, null, 'haystack'));
    if (text.length !== length) fail('haystack');
    const records = typed(rows, Uint32Array, null, 'haystack');
    const starts = typed(offs, Uint32Array, records.length + 1, 'haystack');
    if (starts[records.length] !== text.length) fail('haystack');
    for (const g of records) if (g >= n) fail('haystack');
    return { text, offs: starts, rows: records };
  };
  return value.map((chunk: Partial<PackedHaystackChunk> | null) => ({
    narrow: part(chunk?.narrow),
    wide: part(chunk?.wide),
  }));
}

/**
 * Las partes del buscador completo (`full`) a partir de lo principal, sin normalizar ni construir
 * nada (el buscador lo monta `searcherFromParts`). Sin el pajar: los niveles 0–2 ya responden y el
 * 3 espera a `restoreHaystack`. Lanza `IndexFormatError` si no es un índice de este formato.
 */
export function restoreParts(value: unknown): IndexParts {
  const data = (value ?? {}) as Partial<PersistedIndex>;
  if (data.format !== INDEX_FORMAT) fail('format');
  const { count: n, version, kind } = data;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) fail('count');
  if (typeof version !== 'string' || (kind !== 'core' && kind !== 'recent' && kind !== 'boot')) {
    fail('version');
  }
  const cat: CoreCatalog = {
    kind,
    version,
    count: n,
    appid: typed(data.appid, Uint32Array, n, 'appid'),
    // Los nombres, con `nameOf`: no se parten 197 000 cadenas al restaurar.
    name: [],
    nameEs: rowMap(data.nameEs, n, 'nameEs'),
    flags: typed(data.flags, Uint8Array, n, 'flags'),
    year: typed(data.year, Uint16Array, n, 'year'),
    pop: typed(data.pop, Uint8Array, n, 'pop'),
  };
  const aliasList = unpackRows(data.aliases, 'aliases');
  const aliasExact = new Map<string, number[]>();
  const aliasOf = new Map<number, string[]>();
  for (let i = 0; i < aliasList.rows.length; i++) {
    const alias = aliasList.values[i] as string;
    const g = aliasList.rows[i] as number;
    if (g >= n) fail('aliases');
    const rows = aliasExact.get(alias);
    if (rows) rows.push(g);
    else aliasExact.set(alias, [g]);
    const list = aliasOf.get(g);
    if (list) list.push(alias);
    else aliasOf.set(g, [alias]);
  }
  const names = unpackColumn(data.names, n, 'names');
  const kBase = unpackColumn(data.kBase, n, 'kBase');
  const keys: KeyData = {
    cat,
    n,
    // Solo para la construcción y el escaneo, que no se usan con un índice restaurado.
    kBase: [],
    keyOf: kBase.at,
    keysOf: kBase.range,
    nameOf: names.at,
    artLen: typed(data.artLen, Uint8Array, n, 'artLen'),
    kEs: rowMap(data.kEs, n, 'kEs'),
    sortedAppid: typed(data.sortedAppid, Uint32Array, n, 'sortedAppid'),
    rowOfSorted: typed(data.rowOfSorted, Uint32Array, n, 'rowOfSorted'),
    aliasExact,
    aliasOf,
    // El nivel 3 no responde hasta `restoreHaystack`.
    haystack: [],
  };
  const dictionary = unpackColumn(data.tokens, null, 'tokens');
  const t = dictionary.count;
  const tokens = {
    length: t,
    at: (i: number) => (i >= 0 && i < t ? dictionary.at(i) : undefined),
  };
  const words = (n + 31) >>> 5;
  const index: IndexData = {
    tokens,
    post: typed(data.post, Uint32Array, null, 'post'),
    postStart: typed(data.postStart, Uint32Array, t + 1, 'postStart'),
    fwd: typed(data.fwd, Uint32Array, null, 'fwd'),
    fwdStart: typed(data.fwdStart, Uint32Array, n + 1, 'fwdStart'),
    fwp: typed(data.fwp, Uint32Array, null, 'fwp'),
    fwpStart: typed(data.fwpStart, Uint32Array, t + 1, 'fwpStart'),
    bsAll: bitsets(data.bsAllKeys, data.bsAll, words, 'bsAll'),
    bsFirst: bitsets(data.bsFirstKeys, data.bsFirst, words, 'bsFirst'),
  };
  if (index.postStart[t] !== index.post.length || index.fwpStart[t] !== index.fwp.length) {
    fail('post');
  }
  if (index.fwdStart[n] !== index.fwd.length) fail('fwd');
  return { keys, index };
}

/**
 * Las partes de `parts` con el pajar guardado: el buscador que se monta con ellas ya responde
 * también al nivel 3. Lanza `IndexFormatError` si no es el pajar de ese índice.
 */
export function restoreHaystack(value: unknown, parts: IndexParts): IndexParts {
  const data = (value ?? {}) as Partial<PersistedHaystack>;
  if (data.format !== INDEX_FORMAT) fail('format');
  if (data.count !== parts.keys.n) fail('count');
  const haystack = haystackOf(data.chunks, parts.keys.n);
  return { keys: { ...parts.keys, haystack }, index: parts.index };
}
