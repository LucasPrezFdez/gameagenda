// Índice completo (estado `full`, §8.3): diccionario de tokens ordenado, postings, `fwd`, `fwp`
// y bitsets de 1 letra, con los ids en orden de rango estático y salida temprana.

import { isExact, isTitleStart, type KeyData } from './keys.ts';
import type { Collector, LevelEngine, QueryContext } from './searcher.ts';
import { Tier } from './types.ts';

export interface IndexData {
  /** Tokens ordenados por unidades UTF-16 (el orden de `<`). */
  readonly tokens: readonly string[];
  /** Postings: filas de cada token, ascendentes. */
  readonly post: Uint32Array;
  readonly postStart: Uint32Array;
  /** Tokens de cada fila, para verificar sin intersectar. */
  readonly fwd: Uint32Array;
  readonly fwdStart: Uint32Array;
  /** Primera palabra de cada clave (y la siguiente a un artículo): nivel 1. */
  readonly fwp: Uint32Array;
  readonly fwpStart: Uint32Array;
  /** Bitsets por primer carácter, sobre `post` y sobre `fwp`. */
  readonly bsAll: ReadonlyMap<string, Uint32Array>;
  readonly bsFirst: ReadonlyMap<string, Uint32Array>;
}

/** Rango `[lo, hi)` de tokens que empiezan por `p`. */
export function prefixRange(tokens: readonly string[], p: string): [number, number] {
  let lo = 0;
  let hi = tokens.length;
  while (lo < hi) {
    const m = (lo + hi) >>> 1;
    if ((tokens[m] as string) < p) lo = m + 1;
    else hi = m;
  }
  const a = lo;
  hi = tokens.length;
  while (lo < hi) {
    const m = (lo + hi) >>> 1;
    if ((tokens[m] as string).startsWith(p)) lo = m + 1;
    else hi = m;
  }
  return [a, lo];
}

function exactToken(tokens: readonly string[], t: string): number {
  const [lo, hi] = prefixRange(tokens, t);
  return lo < hi && tokens[lo] === t ? lo : -1;
}

interface Scratch {
  readonly bs: Uint32Array;
  readonly touched: number[];
}

/**
 * Recorre en orden ascendente (= rango) la unión de postings de los tokens `[lo, hi)`;
 * `cb` devuelve `false` para parar.
 */
function forEachInRange(
  post: Uint32Array,
  start: Uint32Array,
  bitsets: ReadonlyMap<string, Uint32Array>,
  lo: number,
  hi: number,
  prefix: string,
  scratch: Scratch,
  cb: (g: number) => boolean,
): void {
  const a = start[lo] as number;
  const b = start[hi] as number;
  if (b === a) return;
  if (hi - lo === 1) {
    for (let p = a; p < b; p++) if (!cb(post[p] as number)) return;
    return;
  }
  const single =
    prefix.length === 1 || (prefix.length === 2 && (prefix.codePointAt(0) as number) > 0xffff);
  const pre = single ? bitsets.get(prefix) : undefined;
  if (pre) {
    for (let w = 0; w < pre.length; w++) {
      let v = pre[w] as number;
      while (v) {
        const bit = 31 - Math.clz32(v & -v);
        v &= v - 1;
        if (!cb((w << 5) | bit)) return;
      }
    }
    return;
  }
  if (b - a <= 64) {
    const tmp = Array.from(post.subarray(a, b)).sort((x, y) => x - y);
    let prev = -1;
    for (const g of tmp) {
      if (g === prev) continue;
      prev = g;
      if (!cb(g)) return;
    }
    return;
  }
  const { bs, touched } = scratch;
  touched.length = 0;
  for (let p = a; p < b; p++) {
    const g = post[p] as number;
    const w = g >>> 5;
    if (bs[w] === 0) touched.push(w);
    bs[w] = (bs[w] as number) | (1 << (g & 31));
  }
  touched.sort((x, y) => x - y);
  let stop = false;
  for (const w of touched) {
    if (!stop) {
      let v = bs[w] as number;
      while (v) {
        const bit = 31 - Math.clz32(v & -v);
        v &= v - 1;
        if (!cb((w << 5) | bit)) {
          stop = true;
          break;
        }
      }
    }
    bs[w] = 0;
  }
}

export function createFullEngine(keys: KeyData, ix: IndexData): LevelEngine {
  const scratch: Scratch = { bs: new Uint32Array((keys.n + 31) >>> 5), touched: [] };
  const { tokens, fwd, fwdStart, fwp, fwpStart, post, postStart } = ix;

  function hasTokenIn(g: number, lo: number, hi: number): boolean {
    for (let p = fwdStart[g] as number, e = fwdStart[g + 1] as number; p < e; p++) {
      const t = fwd[p] as number;
      if (t >= lo && t < hi) return true;
    }
    return false;
  }

  /** Filas de la primera palabra exacta de `qn` o de `qa` (sin ordenar, con repetidos). */
  function firstWordRows(ctx: QueryContext): number[] {
    const out: number[] = [];
    for (const f of ctx.firsts) {
      const t = exactToken(tokens, f);
      if (t < 0) continue;
      for (let p = fwpStart[t] as number, e = fwpStart[t + 1] as number; p < e; p++) {
        out.push(fwp[p] as number);
      }
    }
    return out;
  }

  /** Nivel 2: recorre el token más selectivo y comprueba los demás en `fwd`. */
  function words(
    ctx: QueryContext,
    skip: (g: number) => boolean,
    cb: (g: number) => boolean,
  ): void {
    const ranges = ctx.qt.map((t) => prefixRange(tokens, t));
    if (!ranges.length || ranges.some(([lo, hi]) => lo === hi)) return;
    let d = 0;
    let best = Number.POSITIVE_INFINITY;
    ranges.forEach(([lo, hi], j) => {
      const c = (postStart[hi] as number) - (postStart[lo] as number);
      if (c < best) {
        best = c;
        d = j;
      }
    });
    const others = ranges.filter((_, j) => j !== d);
    const [dlo, dhi] = ranges[d] as [number, number];
    forEachInRange(post, postStart, ix.bsAll, dlo, dhi, ctx.qt[d] as string, scratch, (g) => {
      if (skip(g)) return true;
      for (const [lo, hi] of others) if (!hasTokenIn(g, lo, hi)) return true;
      return cb(g);
    });
  }

  return {
    state: 'full',
    keys,
    exactRows(ctx: QueryContext): number[] {
      const out = firstWordRows(ctx).filter((g) => isExact(keys, g, ctx.qn, ctx.qa));
      return [...new Set(out)].sort((a, b) => a - b);
    },
    titleAndWords(ctx: QueryContext, acc: Collector, limit: number): void {
      const { qt, qn, qa } = ctx;
      if (!qt.length) return;
      const ranges = qt.map((t) => prefixRange(tokens, t));
      if (ranges.some(([lo, hi]) => lo === hi)) return;
      // Nivel 1: empieza por el título (con o sin artículo).
      let n = 0;
      const take1 = (g: number): boolean => {
        if (acc.accepts(g) && isTitleStart(keys, g, qn, qa)) {
          acc.push(g, Tier.title);
          n++;
        }
        return n < limit;
      };
      if (qt.length === 1) {
        const [lo, hi] = ranges[0] as [number, number];
        forEachInRange(fwp, fwpStart, ix.bsFirst, lo, hi, qt[0] as string, scratch, take1);
      } else {
        const cand = [...new Set(firstWordRows(ctx))].sort((a, b) => a - b);
        for (const g of cand) if (!take1(g)) break;
      }
      // Nivel 2: todos los tokens como prefijos de palabra.
      n = 0;
      words(
        ctx,
        (g) => !acc.accepts(g),
        (g) => {
          acc.push(g, Tier.words);
          n++;
          return n < limit;
        },
      );
    },
    wordRows(ctx: QueryContext): number[] {
      const out: number[] = [];
      words(
        ctx,
        () => false,
        (g) => {
          out.push(g);
          return true;
        },
      );
      return out;
    },
  };
}
