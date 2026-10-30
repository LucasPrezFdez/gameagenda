// Núcleo TSV (`#gacat-core v1`, también `recent` y `boot`) y alias (`#gacat-aliases v1`), §7.6.

import { type Clock, type CooperativeTask, cooperate, runToEnd, type Work } from './cooperative.ts';

/** Bits de la columna `flags` del núcleo (§7.6). */
export const CatalogFlag = {
  soon: 1,
  earlyAccess: 2,
  adult: 4,
  free: 8,
  retired: 16,
  tba: 32,
} as const;

/** Variantes del TSV con las mismas columnas: núcleo, recientes y núcleo de arranque. */
export type CoreKind = 'core' | 'recent' | 'boot';

/**
 * Núcleo leído en columnas, en el orden de sus filas (rango estático: la fila 0 es la más
 * popular). `year` y `pop` valen 0 cuando el TSV los deja vacíos.
 */
export interface CoreCatalog {
  readonly kind: CoreKind;
  readonly version: string;
  readonly count: number;
  readonly appid: Uint32Array;
  readonly name: readonly string[];
  /** Nombre en español por fila, solo en las filas que lo tienen. */
  readonly nameEs: ReadonlyMap<number, string>;
  readonly flags: Uint8Array;
  readonly year: Uint16Array;
  readonly pop: Uint8Array;
}

/** Una fila del núcleo como objeto (para escribir el TSV o montar catálogos de prueba). */
export interface CoreRow {
  readonly appid: number;
  readonly name: string;
  readonly nameEs?: string | null | undefined;
  readonly flags?: number | undefined;
  readonly year?: number | null | undefined;
  readonly pop?: number | undefined;
}

/** Par alias compacto → `appid` (un alias admite varios `appid`). */
export type AliasPair = readonly [alias: string, appid: number];

export interface AliasList {
  readonly version: string;
  readonly pairs: readonly AliasPair[];
}

/** Error de formato con la línea (desde 1) en la que se detectó. */
export class CatalogFormatError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(`${message} (línea ${line})`);
    this.name = 'CatalogFormatError';
    this.line = line;
  }
}

const CORE_COLUMNS = 'appid\tname\tnameEs\tflags\tyear\tpop';
const ALIAS_COLUMNS = 'alias\tappid';
const RE_VERSION = /^\d{8}\.[1-9]\d*$/;
const MAX_APPID = 0xffffffff;
const ROWS_PER_SLICE = 2048;

/** `true` si `v` tiene la forma de versión del catálogo, `AAAAMMDD.N`. */
export function isCatalogVersion(v: string): boolean {
  return RE_VERSION.test(v);
}

function readHeader(
  text: string,
  magic: string,
  columns: string,
): { version: string; end: number } {
  let end = text.indexOf('\n');
  if (end < 0) end = text.length;
  const head = text.slice(0, end);
  const prefix = `${magic}\t`;
  if (!head.startsWith(prefix)) throw new CatalogFormatError(`cabecera distinta de «${magic}»`, 1);
  const tab = head.indexOf('\t', prefix.length);
  const version = tab < 0 ? '' : head.slice(prefix.length, tab);
  if (!isCatalogVersion(version)) throw new CatalogFormatError(`versión no válida «${version}»`, 1);
  if (head.slice(tab + 1) !== columns) throw new CatalogFormatError('columnas inesperadas', 1);
  return { version, end };
}

/** Entero decimal sin ceros a la izquierda entre `min` y `max`; vacío → 0 si `optional`. */
function parseUint(
  text: string,
  a: number,
  b: number,
  min: number,
  max: number,
  what: string,
  line: number,
  optional: boolean,
): number {
  if (a === b) {
    if (optional) return 0;
    throw new CatalogFormatError(`${what} vacío`, line);
  }
  if (b - a > 10 || (text.charCodeAt(a) === 48 && b - a > 1)) {
    throw new CatalogFormatError(`${what} no válido`, line);
  }
  let v = 0;
  for (let i = a; i < b; i++) {
    const d = text.charCodeAt(i) - 48;
    if (d < 0 || d > 9) throw new CatalogFormatError(`${what} no válido`, line);
    v = v * 10 + d;
  }
  if (v < min || v > max) throw new CatalogFormatError(`${what} fuera de rango`, line);
  return v;
}

function* coreWork(
  text: string,
  kind: CoreKind,
  counter: { done: number; total: number },
): Generator<void, CoreCatalog, void> {
  const { version, end: headEnd } = readHeader(text, `#gacat-${kind} v1`, CORE_COLUMNS);
  // Recuento de filas para reservar las columnas de una vez.
  let n = 0;
  let p = headEnd + 1;
  while (p < text.length) {
    let e = text.indexOf('\n', p);
    if (e < 0) e = text.length;
    n++;
    p = e + 1;
    if ((n & 8191) === 0) yield;
  }
  counter.total = n;
  const appid = new Uint32Array(n);
  const name: string[] = new Array(n);
  const nameEs = new Map<number, string>();
  const flags = new Uint8Array(n);
  const year = new Uint16Array(n);
  const pop = new Uint8Array(n);
  p = headEnd + 1;
  const length = text.length;
  for (let g = 0; g < n; g++) {
    const line = g + 2;
    // Una sola pasada por la línea para sus tabuladores y su final: es ≈2× más rápido que un
    // `indexOf` por columna.
    let t1 = -1;
    let t2 = -1;
    let t3 = -1;
    let t4 = -1;
    let t5 = -1;
    let tabs = 0;
    let e = p;
    for (; e < length; e++) {
      const c = text.charCodeAt(e);
      if (c === 10) break;
      if (c === 9) {
        tabs++;
        if (tabs === 1) t1 = e;
        else if (tabs === 2) t2 = e;
        else if (tabs === 3) t3 = e;
        else if (tabs === 4) t4 = e;
        else if (tabs === 5) t5 = e;
      }
    }
    if (tabs < 5) throw new CatalogFormatError('faltan columnas', line);
    if (tabs > 5) throw new CatalogFormatError('sobran columnas', line);
    appid[g] = parseUint(text, p, t1, 1, MAX_APPID, 'appid', line, false);
    if (t2 === t1 + 1) throw new CatalogFormatError('nombre vacío', line);
    name[g] = text.slice(t1 + 1, t2);
    if (t3 > t2 + 1) nameEs.set(g, text.slice(t2 + 1, t3));
    flags[g] = parseUint(text, t3 + 1, t4, 1, 63, 'flags', line, true);
    year[g] = parseUint(text, t4 + 1, t5, 1, 9999, 'year', line, true);
    pop[g] = parseUint(text, t5 + 1, e, 1, 63, 'pop', line, true);
    p = e + 1;
    if ((g + 1) % ROWS_PER_SLICE === 0) {
      counter.done = g + 1;
      yield;
    }
  }
  counter.done = n;
  return { kind, version, count: n, appid, name, nameEs, flags, year, pop };
}

/**
 * Lector cooperativo del TSV del núcleo: cada `step()` lee filas hasta el plazo (§8.8). Lanza
 * `CatalogFormatError` ante una cabecera, una fila o un campo no válidos.
 */
export function createCoreReader(
  text: string,
  options: { kind?: CoreKind; now: Clock },
): CooperativeTask<CoreCatalog> {
  const counter = { done: 0, total: 0 };
  return cooperate(
    {
      gen: coreWork(text, options.kind ?? 'core', counter),
      progress: () => (counter.total > 0 ? counter.done / counter.total : 0),
    } satisfies Work<CoreCatalog>,
    options.now,
  );
}

/** Lee de una vez el TSV del núcleo (o de `recent`/`boot`, según `kind`). */
export function parseCore(text: string, kind: CoreKind = 'core'): CoreCatalog {
  return runToEnd(createCoreReader(text, { kind, now: () => 0 }));
}

/** Monta un núcleo en columnas a partir de filas ya ordenadas (pruebas y pipeline). */
export function coreFromRows(
  rows: readonly CoreRow[],
  options: { version: string; kind?: CoreKind },
): CoreCatalog {
  if (!isCatalogVersion(options.version)) {
    throw new CatalogFormatError(`versión no válida «${options.version}»`, 1);
  }
  const n = rows.length;
  const appid = new Uint32Array(n);
  const name: string[] = new Array(n);
  const nameEs = new Map<number, string>();
  const flags = new Uint8Array(n);
  const year = new Uint16Array(n);
  const pop = new Uint8Array(n);
  rows.forEach((r, g) => {
    const clean = checkRow(r, g + 2);
    appid[g] = clean.appid;
    name[g] = clean.name;
    if (clean.nameEs) nameEs.set(g, clean.nameEs);
    flags[g] = clean.flags;
    year[g] = clean.year;
    pop[g] = clean.pop;
  });
  return {
    kind: options.kind ?? 'core',
    version: options.version,
    count: n,
    appid,
    name,
    nameEs,
    flags,
    year,
    pop,
  };
}

/** Fila `g` del núcleo como objeto. */
export function coreRowAt(catalog: CoreCatalog, g: number): CoreRow {
  return {
    appid: catalog.appid[g] as number,
    name: catalog.name[g] as string,
    nameEs: catalog.nameEs.get(g) ?? null,
    flags: catalog.flags[g] as number,
    year: (catalog.year[g] as number) || null,
    pop: catalog.pop[g] as number,
  };
}

const RE_FIELD_BREAKS = /[\t\r\n]/g;
const RE_HAS_FIELD_BREAK = /[\t\r\n]/;

/** En los nombres, tabuladores, CR y LF pasan a espacio (§7.6). */
function cleanName(s: string): string {
  return s.replace(RE_FIELD_BREAKS, ' ');
}

function checkInt(v: number, min: number, max: number, what: string, line: number): number {
  if (!Number.isInteger(v) || v < min || v > max) {
    throw new CatalogFormatError(`${what} fuera de rango: ${v}`, line);
  }
  return v;
}

function checkRow(
  r: CoreRow,
  line: number,
): { appid: number; name: string; nameEs: string; flags: number; year: number; pop: number } {
  const appid = checkInt(r.appid, 1, MAX_APPID, 'appid', line);
  const name = cleanName(r.name);
  if (!name) throw new CatalogFormatError('nombre vacío', line);
  const es = r.nameEs ? cleanName(r.nameEs) : '';
  return {
    appid,
    name,
    nameEs: es === name ? '' : es,
    flags: checkInt(r.flags ?? 0, 0, 63, 'flags', line),
    year: checkInt(r.year ?? 0, 0, 9999, 'year', line),
    pop: checkInt(r.pop ?? 0, 0, 63, 'pop', line),
  };
}

function isCoreCatalog(x: readonly CoreRow[] | CoreCatalog): x is CoreCatalog {
  return (x as CoreCatalog).appid instanceof Uint32Array;
}

const emptyIfZero = (v: number): string => (v === 0 ? '' : String(v));

/**
 * Escribe el TSV del núcleo en el orden dado (el pipeline ordena por rango estático antes):
 * cabecera, una fila por juego y salto de línea final; los ceros y el `nameEs` igual al nombre
 * quedan vacíos.
 */
export function serializeCore(
  rows: readonly CoreRow[] | CoreCatalog,
  options: { version: string; kind?: CoreKind },
): string {
  if (!isCatalogVersion(options.version)) {
    throw new CatalogFormatError(`versión no válida «${options.version}»`, 1);
  }
  const list = isCoreCatalog(rows)
    ? Array.from({ length: rows.count }, (_, g) => coreRowAt(rows, g))
    : rows;
  const out: string[] = [
    `#gacat-${options.kind ?? 'core'} v1\t${options.version}\t${CORE_COLUMNS}`,
  ];
  list.forEach((r, i) => {
    const c = checkRow(r, i + 2);
    out.push(
      `${c.appid}\t${c.name}\t${c.nameEs}\t${emptyIfZero(c.flags)}\t${emptyIfZero(c.year)}\t${emptyIfZero(c.pop)}`,
    );
  });
  return `${out.join('\n')}\n`;
}

/** Lee el TSV de alias (`alias compacto ⇥ appid`). */
export function parseAliases(text: string): AliasList {
  const { version, end } = readHeader(text, '#gacat-aliases v1', ALIAS_COLUMNS);
  const pairs: AliasPair[] = [];
  let p = end + 1;
  let line = 1;
  while (p < text.length) {
    line++;
    let e = text.indexOf('\n', p);
    if (e < 0) e = text.length;
    const t = text.indexOf('\t', p);
    if (t < 0 || t > e) throw new CatalogFormatError('faltan columnas', line);
    if (t === p) throw new CatalogFormatError('alias vacío', line);
    const t2 = text.indexOf('\t', t + 1);
    if (t2 >= 0 && t2 < e) throw new CatalogFormatError('sobran columnas', line);
    pairs.push([text.slice(p, t), parseUint(text, t + 1, e, 1, MAX_APPID, 'appid', line, false)]);
    p = e + 1;
  }
  return { version, pairs };
}

/** Escribe el TSV de alias, ordenado por alias y `appid` y sin pares repetidos. */
export function serializeAliases(
  pairs: readonly AliasPair[],
  options: { version: string },
): string {
  if (!isCatalogVersion(options.version)) {
    throw new CatalogFormatError(`versión no válida «${options.version}»`, 1);
  }
  const sorted = [...pairs].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
  const out: string[] = [`#gacat-aliases v1\t${options.version}\t${ALIAS_COLUMNS}`];
  let prev = '';
  sorted.forEach(([alias, appid], i) => {
    if (!alias || RE_HAS_FIELD_BREAK.test(alias)) {
      throw new CatalogFormatError(`alias no válido «${alias}»`, i + 2);
    }
    checkInt(appid, 1, MAX_APPID, 'appid', i + 2);
    const row = `${alias}\t${appid}`;
    if (row !== prev) out.push(row);
    prev = row;
  });
  return `${out.join('\n')}\n`;
}
