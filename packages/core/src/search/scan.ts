// Puente de escaneo lineal (estado `scan`, §8.8): responde mientras se construye el índice, con
// los mismos niveles y el mismo orden. Nivel 0 con una tabla de claves exactas; niveles 1 y 2 con
// `indexOf` sobre el pajar compacto en orden de filas y las mismas comprobaciones de clave.

import { isAscii, NUMBER_EXTRAS, numberExtra, tokenize } from '../normalize/index.ts';
import { PatternCursor } from './haystack.ts';
import { isExact, isTitleStart, type KeyData } from './keys.ts';
import type { Collector, LevelEngine, QueryContext } from './searcher.ts';
import { Tier } from './types.ts';

/** FNV-1a de 32 bits de `s` desde la posición `from`. */
function hashFrom(s: string, from: number): number {
  let h = 0x811c9dc5;
  for (let i = from; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h | 0;
}

/**
 * Claves exactas (base, española, con y sin artículo) → filas, en una tabla de direccionamiento
 * abierto con su *hash*: mucho más barata de llenar que un `Map` de 200 000 cadenas. Da
 * candidatos; quien la consulta los verifica con la clave.
 */
export class ExactTable {
  /**
   * Huecos de dos enteros: fila + 1 (0 = libre) y *hash*. Intercalados, cada inserción toca una
   * sola línea de caché en vez de una en cada array.
   */
  private slots: Int32Array;
  /** Huecos − 1 (el número de huecos es potencia de 2). */
  private mask: number;
  private used = 0;

  constructor(expected: number) {
    let size = 1024;
    while (size < expected * 2) size *= 2;
    this.slots = new Int32Array(2 * size);
    this.mask = size - 1;
  }

  /** Añade la clave `key.slice(from)` de la fila `g`. */
  add(key: string, from: number, g: number): void {
    if (from >= key.length) return;
    if ((this.used + 1) * 4 > (this.mask + 1) * 3) this.grow();
    this.insert(hashFrom(key, from), g + 1);
    this.used++;
  }

  private insert(h: number, v: number): void {
    const slots = this.slots;
    let p = h & this.mask;
    while (slots[2 * p] !== 0) p = (p + 1) & this.mask;
    slots[2 * p] = v;
    slots[2 * p + 1] = h;
  }

  private grow(): void {
    const old = this.slots;
    this.slots = new Int32Array(2 * old.length);
    this.mask = old.length - 1;
    for (let p = 0; p < old.length; p += 2) {
      const v = old[p] as number;
      if (v !== 0) this.insert(old[p + 1] as number, v);
    }
  }

  /** Añade a `out` las filas cuya clave puede ser `key` (mismo *hash*). */
  candidates(key: string, out: number[]): void {
    const slots = this.slots;
    const h = hashFrom(key, 0);
    for (let p = h & this.mask; slots[2 * p] !== 0; p = (p + 1) & this.mask) {
      if (slots[2 * p + 1] === h) out.push((slots[2 * p] as number) - 1);
    }
  }
}

/** Alias ordenados, para encontrar los que empiezan por un token. */
export interface AliasPrefixList {
  readonly keys: readonly string[];
  readonly rows: readonly (readonly number[])[];
}

export function aliasPrefixList(
  aliasExact: ReadonlyMap<string, readonly number[]>,
): AliasPrefixList {
  const keys = [...aliasExact.keys()].sort();
  return { keys, rows: keys.map((k) => aliasExact.get(k) ?? []) };
}

/** Token de la consulta con lo necesario para comprobarlo sin partir la clave. */
interface QueryToken {
  readonly t: string;
  readonly spaced: string;
  /** Palabras cuyo token extra empieza por `t` («3» ← «iii»), con sus formas de búsqueda. */
  readonly sources: readonly {
    readonly mid: string;
    readonly end: string;
    readonly word: string;
  }[];
}

function queryToken(t: string): QueryToken {
  const sources = [];
  for (const [word, extra] of NUMBER_EXTRAS) {
    if (extra.startsWith(t)) sources.push({ mid: ` ${word} `, end: ` ${word}`, word });
  }
  return { t, spaced: ` ${t}`, sources };
}

/** Tokens del índice de una clave no ASCII (misma regla que el índice). */
function nonAsciiTokens(key: string): string[] {
  const toks = tokenize(key, false);
  const words = key.split(' ');
  for (let k = 1; k < words.length; k++) {
    const x = numberExtra(words[k] as string);
    if (x) toks.push(x);
  }
  return toks;
}

/** `true` si alguna palabra (o token extra) de la clave empieza por el token. */
function keyHasPrefix(key: string, q: QueryToken): boolean {
  if (isAscii(key)) {
    if (key.startsWith(q.t) || key.includes(q.spaced)) return true;
    for (const s of q.sources) if (key.includes(s.mid) || key.endsWith(s.end)) return true;
    return false;
  }
  for (const tok of nonAsciiTokens(key)) if (tok.startsWith(q.t)) return true;
  return false;
}

function rowHasPrefix(keys: KeyData, g: number, q: QueryToken): boolean {
  if (keyHasPrefix(keys.kBase[g] as string, q)) return true;
  const e = keys.kEs.get(g);
  if (e !== undefined && keyHasPrefix(e, q)) return true;
  const al = keys.aliasOf.get(g);
  if (al) for (const a of al) if (a.startsWith(q.t)) return true;
  return false;
}

/** Quita los patrones que contienen a otro (sus filas ya salen con el más corto). */
function minimalPatterns(patterns: readonly string[]): string[] {
  const sorted = [...new Set(patterns)].sort((a, b) => a.length - b.length);
  const out: string[] = [];
  for (const p of sorted) if (!out.some((o) => p.includes(o))) out.push(p);
  return out;
}

/** Recorre en orden de filas la unión de varias fuentes ascendentes. */
class MergedRows {
  private readonly cursors: PatternCursor[];
  private readonly heads: number[];
  private readonly extra: readonly number[];
  private extraPos = 0;

  constructor(cursors: PatternCursor[], extra: readonly number[]) {
    this.cursors = cursors;
    this.heads = cursors.map((c) => c.next());
    this.extra = extra;
  }

  next(): number {
    let min = -1;
    for (const h of this.heads) if (h >= 0 && (min < 0 || h < min)) min = h;
    const x = this.extraPos < this.extra.length ? (this.extra[this.extraPos] as number) : -1;
    if (x >= 0 && (min < 0 || x < min)) min = x;
    if (min < 0) return -1;
    for (let i = 0; i < this.heads.length; i++) {
      if (this.heads[i] === min) this.heads[i] = (this.cursors[i] as PatternCursor).next();
    }
    while (this.extraPos < this.extra.length && this.extra[this.extraPos] === min) this.extraPos++;
    return min;
  }
}

function aliasRowsWithPrefix(list: AliasPrefixList, t: string): number[] {
  let lo = 0;
  let hi = list.keys.length;
  while (lo < hi) {
    const m = (lo + hi) >>> 1;
    if ((list.keys[m] as string) < t) lo = m + 1;
    else hi = m;
  }
  const set = new Set<number>();
  for (let i = lo; i < list.keys.length && (list.keys[i] as string).startsWith(t); i++) {
    for (const g of list.rows[i] as readonly number[]) set.add(g);
  }
  return [...set].sort((a, b) => a - b);
}

export function createScanEngine(
  keys: KeyData,
  exact: ExactTable,
  aliases: AliasPrefixList,
): LevelEngine {
  /** Candidatos (superconjunto) a tener un token que empiece por el conductor. */
  function candidates(qts: readonly QueryToken[]): MergedRows {
    // Conductor: el token con menos fuentes de números y, a igualdad, el más largo.
    let d = qts[0] as QueryToken;
    for (const q of qts) {
      if (
        q.sources.length < d.sources.length ||
        (q.sources.length === d.sources.length && q.t.length > d.t.length)
      ) {
        d = q;
      }
    }
    const patterns = minimalPatterns([d.t, ...d.sources.map((s) => s.word)]);
    return new MergedRows(
      patterns.map((p) => new PatternCursor(keys.haystack, p)),
      aliasRowsWithPrefix(aliases, d.t),
    );
  }

  function matchesAll(g: number, qts: readonly QueryToken[]): boolean {
    for (const q of qts) if (!rowHasPrefix(keys, g, q)) return false;
    return true;
  }

  return {
    state: 'scan',
    keys,
    exactRows(ctx: QueryContext): number[] {
      const cand: number[] = [];
      exact.candidates(ctx.qn, cand);
      if (ctx.qa !== ctx.qn) exact.candidates(ctx.qa, cand);
      const out = cand.filter((g) => isExact(keys, g, ctx.qn, ctx.qa));
      return [...new Set(out)].sort((a, b) => a - b);
    },
    titleAndWords(ctx: QueryContext, acc: Collector, limit: number): void {
      if (!ctx.qt.length) return;
      const qts = ctx.qt.map(queryToken);
      const rows = candidates(qts);
      // Una sola pasada: el nivel 1 está contenido en el 2, así que los mismos candidatos sirven.
      let n1 = 0;
      let n2 = 0;
      while (n1 < limit || n2 < limit) {
        const g = rows.next();
        if (g < 0) break;
        if (!acc.accepts(g)) continue;
        if (n1 < limit && isTitleStart(keys, g, ctx.qn, ctx.qa)) {
          acc.push(g, Tier.title);
          n1++;
        } else if (n2 < limit && matchesAll(g, qts)) {
          acc.push(g, Tier.words);
          n2++;
        }
      }
    },
    wordRows(ctx: QueryContext): number[] {
      if (!ctx.qt.length) return [];
      const qts = ctx.qt.map(queryToken);
      const rows = candidates(qts);
      const out: number[] = [];
      for (let g = rows.next(); g >= 0; g = rows.next()) if (matchesAll(g, qts)) out.push(g);
      return out;
    },
  };
}
