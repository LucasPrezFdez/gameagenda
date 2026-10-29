// Construcción incremental y cooperativa (§8.8): claves normalizadas, pajar y tabla de exactos
// → `scan` → diccionario, postings, `fwd`, `fwp` y bitsets → `full`. Cada trozo de trabajo dura
// ≈0,4 ms en Node (p99 ≈2 ms), así que una pulsación espera como mucho un bloque de `step()`.

import { type Clock, cooperate } from '../catalog-format/cooperative.ts';
import type { AliasPair, CoreCatalog } from '../catalog-format/tsv.ts';
import {
  ARTICLES,
  articleLength,
  compact,
  isAscii,
  normalize,
  numberExtra,
  tokenize,
} from '../normalize/index.ts';
import { createFullEngine, type IndexData, prefixRange } from './full.ts';
import { HAYSTACK_CHUNK_ROWS, type HaystackChunk, HaystackChunkBuilder } from './haystack.ts';
import type { KeyData } from './keys.ts';
import { aliasPrefixList, createScanEngine, ExactTable } from './scan.ts';
import { createSearcher } from './searcher.ts';
import type { IndexBuilder, Searcher, SearchState } from './types.ts';

export interface BuildOptions {
  /** Reloj para repartir el trabajo en bloques (en el Worker, `performance.now`). */
  readonly now: Clock;
  /** Entradas mínimas de un prefijo de 1 carácter para precalcular su bitset (1 500). */
  readonly bitsetMin?: number;
}

/** Peso de cada fase en `progress` (medido en Node sobre el núcleo real; `scan` ≈0,5). */
const WEIGHTS = {
  appids: 0.03,
  aliases: 0.01,
  keys: 0.46,
  tokens: 0.3,
  sort: 0.11,
  remap: 0.04,
  invert: 0.03,
  bitsets: 0.02,
} as const;

class Progress {
  private base = 0;
  private weight = 0;
  private total = 1;
  done = 0;

  phase(weight: number, total: number): void {
    this.base += this.weight;
    this.weight = weight;
    this.total = Math.max(1, total);
    this.done = 0;
  }

  get value(): number {
    return this.base + this.weight * Math.min(1, this.done / this.total);
  }
}

/** Filas por trozo en las fases por fila (≈0,3 ms en Node). */
const SLICE = 256;

/** Ordenación estable por `appid` (radix de 2 pasadas de 16 bits). */
function* sortAppids(
  appid: Uint32Array,
  prog: Progress,
): Generator<void, { sorted: Uint32Array; rows: Uint32Array }, void> {
  const n = appid.length;
  let keys = appid.slice();
  let rows = new Uint32Array(n);
  for (let i = 0; i < n; i++) rows[i] = i;
  yield;
  let k2 = new Uint32Array(n);
  let r2 = new Uint32Array(n);
  for (const shift of [0, 16]) {
    const count = new Uint32Array(65537);
    for (let i = 0; i < n; i++) {
      const b = (((keys[i] as number) >>> shift) & 0xffff) + 1;
      count[b] = (count[b] as number) + 1;
      if ((i & 16383) === 16383) yield;
    }
    for (let b = 0; b < 65536; b++) count[b + 1] = (count[b + 1] as number) + (count[b] as number);
    for (let i = 0; i < n; i++) {
      const b = ((keys[i] as number) >>> shift) & 0xffff;
      const p = count[b] as number;
      count[b] = p + 1;
      k2[p] = keys[i] as number;
      r2[p] = rows[i] as number;
      if ((i & 16383) === 16383) {
        prog.done += 16384;
        yield;
      }
    }
    [keys, k2] = [k2, keys];
    [rows, r2] = [r2, rows];
  }
  return { sorted: keys, rows };
}

/**
 * Ordena cadenas por unidades UTF-16 (el orden de `<`): tramos de 2 048 con el `sort()`
 * nativo y mezcla por pasadas, cediendo el turno cada pocos miles de elementos.
 */
function* sortStrings(list: readonly string[], prog: Progress): Generator<void, string[], void> {
  const n = list.length;
  const RUN = 2048;
  let src: string[] = new Array(n);
  for (let i = 0; i < n; i += RUN) {
    const part = list.slice(i, i + RUN).sort();
    for (let k = 0; k < part.length; k++) src[i + k] = part[k] as string;
    prog.done += part.length;
    yield;
  }
  let dst: string[] = new Array(n);
  for (let width = RUN; width < n; width *= 2) {
    let budget = 0;
    for (let lo = 0; lo < n; lo += 2 * width) {
      const mid = Math.min(lo + width, n);
      const hi = Math.min(lo + 2 * width, n);
      let i = lo;
      let j = mid;
      let k = lo;
      while (k < hi) {
        if (j >= hi || (i < mid && (src[i] as string) <= (src[j] as string)))
          dst[k++] = src[i++] as string;
        else dst[k++] = src[j++] as string;
        if (++budget === 8192) {
          budget = 0;
          prog.done += 8192;
          yield;
        }
      }
    }
    [src, dst] = [dst, src];
  }
  return src;
}

/** Invierte `arr` (tokens por fila) en postings (filas por token, ascendentes). */
function* invert(
  arr: Uint32Array,
  start: Uint32Array,
  n: number,
  t: number,
  prog: Progress,
): Generator<void, { post: Uint32Array; st: Uint32Array }, void> {
  const st = new Uint32Array(t + 1);
  for (let p = 0; p < arr.length; p++) {
    const i = (arr[p] as number) + 1;
    st[i] = (st[i] as number) + 1;
    if ((p & 32767) === 32767) yield;
  }
  for (let i = 0; i < t; i++) st[i + 1] = (st[i + 1] as number) + (st[i] as number);
  yield;
  const post = new Uint32Array(arr.length);
  const cur = st.slice(0, t);
  for (let g = 0; g < n; g++) {
    for (let p = start[g] as number, e = start[g + 1] as number; p < e; p++) {
      const tok = arr[p] as number;
      const c = cur[tok] as number;
      post[c] = g;
      cur[tok] = c + 1;
    }
    if ((g & 4095) === 4095) {
      prog.done += 4096;
      yield;
    }
  }
  return { post, st };
}

class GrowableU32 {
  data: Uint32Array;
  length = 0;
  constructor(capacity: number) {
    this.data = new Uint32Array(Math.max(16, capacity));
  }
  push(v: number): void {
    if (this.length === this.data.length) {
      const next = new Uint32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = v;
  }
}

function* buildWork(
  cat: CoreCatalog,
  aliases: readonly AliasPair[],
  bitsetMin: number,
  out: { state: SearchState; searcher: Searcher | null },
  prog: Progress,
): Generator<void, Searcher, void> {
  const n = cat.count;

  // 1. appid → fila.
  prog.phase(WEIGHTS.appids, 2 * n);
  const { sorted: sortedAppid, rows: rowOfSorted } = yield* sortAppids(cat.appid, prog);
  const rowOf = (appid: number): number => {
    let lo = 0;
    let hi = n - 1;
    while (lo <= hi) {
      const m = (lo + hi) >>> 1;
      const v = sortedAppid[m] as number;
      if (v < appid) lo = m + 1;
      else if (v > appid) hi = m - 1;
      else return rowOfSorted[m] as number;
    }
    return -1;
  };

  // 2. Alias → filas (los de juegos que no están se ignoran).
  prog.phase(WEIGHTS.aliases, aliases.length);
  const aliasExact = new Map<string, number[]>();
  const aliasOf = new Map<number, string[]>();
  for (let i = 0; i < aliases.length; i++) {
    const [a, appid] = aliases[i] as AliasPair;
    const g = rowOf(appid);
    if (g >= 0 && a) {
      const rows = aliasExact.get(a);
      if (!rows) aliasExact.set(a, [g]);
      else if (!rows.includes(g)) rows.push(g);
      const list = aliasOf.get(g);
      if (!list) aliasOf.set(g, [a]);
      else if (!list.includes(a)) list.push(a);
    }
    if ((i & 1023) === 1023) {
      prog.done = i;
      yield;
    }
  }
  for (const rows of aliasExact.values()) rows.sort((x, y) => x - y);

  // 3. Claves normalizadas, mapa de exactos y pajar compacto → `scan`.
  prog.phase(WEIGHTS.keys, n);
  const kBase: string[] = new Array(n);
  const artLen = new Uint8Array(n);
  const kEs = new Map<number, string>();
  const exact = new ExactTable(n + (n >>> 3));
  const haystack: HaystackChunk[] = [];
  const hb = new HaystackChunkBuilder();
  for (let g = 0; g < n; g++) {
    const nb = normalize(cat.name[g] as string);
    const al = articleLength(nb);
    kBase[g] = nb;
    artLen[g] = al;
    exact.add(nb, 0, g);
    if (al > 0) exact.add(nb, al, g);
    const c = compact(nb);
    hb.add(c, g);
    const es = cat.nameEs.get(g);
    if (es !== undefined) {
      const ne = normalize(es);
      if (ne && ne !== nb) {
        kEs.set(g, ne);
        exact.add(ne, 0, g);
        const ae = articleLength(ne);
        if (ae > 0) exact.add(ne, ae, g);
        const ce = compact(ne);
        if (ce !== c) hb.add(ce, g);
      }
    }
    if ((g + 1) % HAYSTACK_CHUNK_ROWS === 0 || g === n - 1) haystack.push(hb.finish());
    if ((g & (SLICE - 1)) === SLICE - 1) {
      prog.done = g;
      yield;
    }
  }
  const keys: KeyData = {
    cat,
    n,
    kBase,
    artLen,
    kEs,
    sortedAppid,
    rowOfSorted,
    aliasExact,
    aliasOf,
    haystack,
  };
  out.searcher = createSearcher(createScanEngine(keys, exact, aliasPrefixList(aliasExact)));
  out.state = 'scan';
  yield;

  // 4. Diccionario y tokens por fila (`fwd`) y primeras palabras (`fwp`).
  prog.phase(WEIGHTS.tokens, n);
  const tokId = new Map<string, number>();
  const tokList: string[] = [];
  const fwd = new GrowableU32(n * 4);
  const fw = new GrowableU32(n * 2);
  const fwdStart = new Uint32Array(n + 1);
  const fwStart = new Uint32Array(n + 1);
  let gStart = 0;
  let fStart = 0;
  const addTok = (t: string): number => {
    let id = tokId.get(t);
    if (id === undefined) {
      id = tokList.length;
      tokId.set(t, id);
      tokList.push(t);
    }
    for (let p = gStart; p < fwd.length; p++) if (fwd.data[p] === id) return id;
    fwd.push(id);
    return id;
  };
  const addFirst = (id: number): void => {
    for (let p = fStart; p < fw.length; p++) if (fw.data[p] === id) return;
    fw.push(id);
  };
  const addKey = (k: string): void => {
    if (isAscii(k)) {
      let i = 0;
      let w = 0;
      let art = false;
      for (;;) {
        let j = k.indexOf(' ', i);
        if (j < 0) j = k.length;
        const t = k.slice(i, j);
        if (t) {
          const id = addTok(t);
          if (w === 0) {
            addFirst(id);
            art = ARTICLES.has(t);
          } else {
            if (w === 1 && art) addFirst(id);
            const x = numberExtra(t);
            if (x) addTok(x);
          }
          w++;
        }
        if (j >= k.length) break;
        i = j + 1;
      }
      return;
    }
    const toks = tokenize(k, false);
    if (toks[0] !== undefined) addFirst(addTok(toks[0]));
    for (let i = 1; i < toks.length; i++) addTok(toks[i] as string);
    const words = k.split(' ');
    if (words.length > 1 && ARTICLES.has(words[0] as string)) {
      const t2 = tokenize(words.slice(1).join(' '), false)[0];
      if (t2 !== undefined) addFirst(addTok(t2));
    }
    for (let i = 1; i < words.length; i++) {
      const x = numberExtra(words[i] as string);
      if (x) addTok(x);
    }
  };
  for (let g = 0; g < n; g++) {
    gStart = fwd.length;
    fStart = fw.length;
    fwdStart[g] = gStart;
    fwStart[g] = fStart;
    addKey(kBase[g] as string);
    const e = kEs.get(g);
    if (e !== undefined) addKey(e);
    const al = aliasOf.get(g);
    if (al) for (const a of al) addTok(a);
    if ((g & (SLICE - 1)) === SLICE - 1) {
      prog.done = g;
      yield;
    }
  }
  fwdStart[n] = fwd.length;
  fwStart[n] = fw.length;

  // 5. Diccionario ordenado (orden de `<`, el de la búsqueda binaria).
  const t = tokList.length;
  prog.phase(WEIGHTS.sort, t * (1 + Math.max(0, Math.ceil(Math.log2(t / 2048)))));
  const tokens = yield* sortStrings(tokList, prog);

  // 6. Ids de token → posición en el diccionario.
  prog.phase(WEIGHTS.remap, t + fwd.length + fw.length);
  const remap = new Uint32Array(t);
  for (let r = 0; r < t; r++) {
    remap[tokId.get(tokens[r] as string) as number] = r;
    if ((r & 8191) === 8191) {
      prog.done = r;
      yield;
    }
  }
  tokId.clear();
  const fwdArr = new Uint32Array(fwd.length);
  for (let p = 0; p < fwd.length; p++) {
    fwdArr[p] = remap[fwd.data[p] as number] as number;
    if ((p & 65535) === 65535) {
      prog.done = t + p;
      yield;
    }
  }
  const fwArr = new Uint32Array(fw.length);
  for (let p = 0; p < fw.length; p++) {
    fwArr[p] = remap[fw.data[p] as number] as number;
    if ((p & 65535) === 65535) {
      prog.done = t + fwd.length + p;
      yield;
    }
  }

  // 7. Postings de tokens y de primeras palabras.
  prog.phase(WEIGHTS.invert, 2 * n);
  const all = yield* invert(fwdArr, fwdStart, n, t, prog);
  const first = yield* invert(fwArr, fwStart, n, t, prog);

  // 8. Bitsets de los prefijos de 1 carácter más frecuentes.
  prog.phase(WEIGHTS.bitsets, t);
  const words = (n + 31) >>> 5;
  const bsAll = new Map<string, Uint32Array>();
  const bsFirst = new Map<string, Uint32Array>();
  let ti = 0;
  let groups = 0;
  while (ti < t) {
    const c = String.fromCodePoint((tokens[ti] as string).codePointAt(0) as number);
    const [lo, hi] = prefixRange(tokens, c);
    for (const [post, st, map] of [
      [all.post, all.st, bsAll],
      [first.post, first.st, bsFirst],
    ] as const) {
      const a = st[lo] as number;
      const b = st[hi] as number;
      if (b - a < bitsetMin) continue;
      const bs = new Uint32Array(words);
      for (let p = a; p < b; p++) {
        const g = post[p] as number;
        bs[g >>> 5] = (bs[g >>> 5] as number) | (1 << (g & 31));
        if ((p & 65535) === 65535) yield;
      }
      map.set(c, bs);
      yield;
    }
    ti = Math.max(hi, ti + 1);
    prog.done = ti;
    // Hay miles de grupos pequeños (un carácter CJK cada uno): se cede cada 256.
    if ((++groups & 255) === 0) yield;
  }

  const ix: IndexData = {
    tokens,
    post: all.post,
    postStart: all.st,
    fwd: fwdArr,
    fwdStart,
    fwp: first.post,
    fwpStart: first.st,
    bsAll,
    bsFirst,
  };
  const searcher = createSearcher(createFullEngine(keys, ix));
  out.searcher = searcher;
  out.state = 'full';
  return searcher;
}

/**
 * Prepara la construcción del índice sobre el núcleo (con `recent` ya aplicado) y sus alias.
 * No trabaja hasta el primer `step()`; el Worker lo llama con plazos de ≤8 ms y cede el turno
 * entre llamadas. `searcher` responde desde `scan` y cambia al índice completo en `full`; quien
 * guarde el buscador de escaneo debe soltarlo entonces para liberar su tabla de exactos.
 */
export function createIndexBuilder(
  catalog: CoreCatalog,
  aliases: readonly AliasPair[],
  options: BuildOptions,
): IndexBuilder {
  const out: { state: SearchState; searcher: Searcher | null } = { state: 'none', searcher: null };
  const prog = new Progress();
  const task = cooperate(
    {
      gen: buildWork(catalog, aliases, options.bitsetMin ?? 1500, out, prog),
      progress: () => prog.value,
    },
    options.now,
  );
  return {
    step: (deadline: number) => task.step(deadline),
    get progress() {
      return task.progress;
    },
    get result() {
      return task.result;
    },
    get state() {
      return out.state;
    },
    get searcher() {
      return out.searcher;
    },
  };
}

/** Construye el índice completo de una vez (pipeline, consultas de humo y pruebas). */
export function buildSearcher(catalog: CoreCatalog, aliases: readonly AliasPair[]): Searcher {
  const b = createIndexBuilder(catalog, aliases, { now: () => 0 });
  while (!b.step(Number.POSITIVE_INFINITY)) {
    // sin plazo
  }
  return b.result as Searcher;
}
