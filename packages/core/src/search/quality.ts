// Puertas de calidad de búsqueda (§8.10) y consultas de humo (§4.6), sin E/S: las usan las
// pruebas de `core` sobre la copia congelada y el pipeline sobre el núcleo recién construido,
// con la misma implementación.

import { normalize } from '../normalize/index.ts';
import { canSuggest, withSuggestions } from './fuzzy.ts';
import { type FuzzyMatcher, type Searcher, type SearchItem, Tier } from './types.ts';

/** Umbrales de la §8.10 (porcentajes). */
export const QUALITY_THRESHOLDS = {
  goldenMinQueries: 60,
  goldenTop1: 90,
  goldenTop5: 95,
  exactTop5: 99,
  prefixTop10: 90,
} as const;

/** Muestra de nombres exactos (2 000, semilla 42) y juegos de los prefijos (los 1 000 primeros). */
export const EXACT_SAMPLE = 2000;
export const EXACT_SEED = 42;
export const PREFIX_TOP = 1000;

/** Negativas de la puerta: ningún resultado de nivel 0–1 (se ofrece el alta manual). */
export const NEGATIVE_QUERIES: readonly string[] = ['pokemon', 'zelda', 'mario kart'];

/** Consultas de humo de la §4.6: `appid` esperado entre los `top` primeros. */
export const SMOKE_QUERIES: ReadonlyArray<{
  readonly q: string;
  readonly appid: number;
  readonly top: number;
}> = [
  { q: 'hollow knight', appid: 367520, top: 1 },
  { q: 'baldurs gate', appid: 1086940, top: 3 },
  { q: 'elden', appid: 1245620, top: 3 },
  { q: 'counter strike', appid: 730, top: 3 },
];

export interface GoldenQuery {
  readonly q: string;
  readonly appids: readonly number[];
  readonly category: string;
}

/** Lee el conjunto dorado (`consulta ⇥ appid esperados, separados por comas ⇥ categoría`). */
export function parseGolden(text: string): GoldenQuery[] {
  const out: GoldenQuery[] = [];
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#') || line.startsWith('query\t')) continue;
    const [q, ids, category] = line.split('\t');
    out.push({
      q: q as string,
      appids: (ids as string).split(',').map(Number),
      category: category as string,
    });
  }
  return out;
}

/** Generador pseudoaleatorio con semilla (mulberry32), el del banco de pruebas del prototipo. */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Lista que ve el usuario (§8.10): hasta `limit` filas de los niveles 0–3 y, si los niveles 0–2
 * dan <5, hasta 3 sugerencias del nivel 4 al final.
 */
export function visibleList(
  s: Searcher,
  fuzzy: FuzzyMatcher | null,
  q: string,
  options: { limit?: number; showAdult?: boolean } = {},
): SearchItem[] {
  const limit = options.limit ?? 8;
  const showAdult = options.showAdult ?? false;
  s.reset();
  const r = s.query(q, { limit, showAdult });
  if (!fuzzy || !canSuggest(q, r.strong)) return r.items;
  const task = s.suggest(q, fuzzy, { exclude: r.items.map((i) => i.appid), showAdult });
  while (!task.step()) {
    // todos los bloques
  }
  return withSuggestions(r.items, task.items, limit);
}

/** Puesto (desde 1) del primer `appid` esperado, o 0 si no está. */
export function rankOf(items: readonly SearchItem[], expected: readonly number[]): number {
  const k = items.findIndex((i) => expected.includes(i.appid));
  return k + 1;
}

const pct = (k: number, n: number): number => (n === 0 ? 0 : +((100 * k) / n).toFixed(1));

export interface GoldenResult {
  readonly n: number;
  readonly top1: number;
  readonly top5: number;
  /** Lo mismo sin el nivel 4 (informativo). */
  readonly top1NoFuzzy: number;
  readonly top5NoFuzzy: number;
  /** Consultas que no quedaron primeras: consulta, puesto (0 = fuera) y primer resultado. */
  readonly notTop1: Array<[q: string, rank: number, first: string]>;
  readonly ok: boolean;
}

/** Dorado: top-1 ≥90 % y top-5 ≥95 % en la lista visible, con el nivel 4. */
export function evaluateGolden(
  s: Searcher,
  fuzzy: FuzzyMatcher,
  golden: readonly GoldenQuery[],
): GoldenResult {
  let t1 = 0;
  let t5 = 0;
  let t1n = 0;
  let t5n = 0;
  const notTop1: Array<[string, number, string]> = [];
  for (const g of golden) {
    const items = visibleList(s, fuzzy, g.q);
    const k = rankOf(items, g.appids);
    const k0 = rankOf(visibleList(s, null, g.q), g.appids);
    if (k === 1) t1++;
    else notTop1.push([g.q, k, items[0]?.name ?? '']);
    if (k >= 1 && k <= 5) t5++;
    if (k0 === 1) t1n++;
    if (k0 >= 1 && k0 <= 5) t5n++;
  }
  const n = golden.length;
  const top1 = pct(t1, n);
  const top5 = pct(t5, n);
  return {
    n,
    top1,
    top5,
    top1NoFuzzy: pct(t1n, n),
    top5NoFuzzy: pct(t5n, n),
    notTop1,
    ok:
      n >= QUALITY_THRESHOLDS.goldenMinQueries &&
      top1 >= QUALITY_THRESHOLDS.goldenTop1 &&
      top5 >= QUALITY_THRESHOLDS.goldenTop5,
  };
}

export interface ShareResult {
  readonly n: number;
  readonly pct: number;
  readonly ok: boolean;
}

/**
 * Nombres exactos: `sample` filas al azar con semilla fija, ≥99 % en el top-5 con +18 visible.
 * Sin el nivel 4: sus sugerencias van detrás de la 5.ª fila y no cambian el top-5.
 */
export function evaluateExact(
  s: Searcher,
  names: readonly string[],
  appids: ArrayLike<number>,
  options: { sample?: number; seed?: number } = {},
): ShareResult {
  const want = Math.min(options.sample ?? EXACT_SAMPLE, names.length);
  const rnd = mulberry32(options.seed ?? EXACT_SEED);
  const sample = new Set<number>();
  while (sample.size < want) sample.add(Math.floor(rnd() * names.length));
  let hits = 0;
  for (const g of sample) {
    const items = visibleList(s, null, names[g] as string, { showAdult: true });
    const k = rankOf(items, [appids[g] as number]);
    if (k >= 1 && k <= 5) hits++;
  }
  const r = pct(hits, want);
  return { n: want, pct: r, ok: r >= QUALITY_THRESHOLDS.exactTop5 };
}

export interface PrefixResult extends ShareResult {
  /** En el top-8, la lista de la paleta (informativo). */
  readonly top8: number;
}

/** Prefijos de 4 letras de los `top` más populares: ≥90 % en el top-10, con +18 visible. */
export function evaluatePrefix(
  s: Searcher,
  names: readonly string[],
  appids: ArrayLike<number>,
  options: { top?: number } = {},
): PrefixResult {
  const n = Math.min(options.top ?? PREFIX_TOP, names.length);
  let top10 = 0;
  let top8 = 0;
  // Niveles 0–3 con limit 10, como el prototipo; el top-8 es la lista de la paleta.
  for (let g = 0; g < n; g++) {
    const q = Array.from(normalize(names[g] as string))
      .slice(0, 4)
      .join('')
      .trim();
    const k = rankOf(visibleList(s, null, q, { limit: 10, showAdult: true }), [
      appids[g] as number,
    ]);
    if (k >= 1 && k <= 10) top10++;
    if (k >= 1 && k <= 8) top8++;
  }
  const r = pct(top10, n);
  return { n, pct: r, top8: pct(top8, n), ok: r >= QUALITY_THRESHOLDS.prefixTop10 };
}

export interface NegativesResult {
  /** Tres primeros resultados de cada consulta, con su nivel. */
  readonly top3: Record<string, string[]>;
  /** Consultas con algún resultado de nivel 0–1. */
  readonly failed: string[];
  readonly ok: boolean;
}

/** Negativas: ningún resultado de nivel 0–1 en `NEGATIVE_QUERIES` (y en `extra`, informativas). */
export function evaluateNegatives(
  s: Searcher,
  fuzzy: FuzzyMatcher,
  extra: readonly string[] = [],
): NegativesResult {
  const top3: Record<string, string[]> = {};
  const failed: string[] = [];
  for (const q of [...NEGATIVE_QUERIES, ...extra]) {
    const items = visibleList(s, fuzzy, q);
    top3[q] = items.slice(0, 3).map((i) => `${i.name} [${i.tier}]`);
    if (NEGATIVE_QUERIES.includes(q) && items.some((i) => i.tier <= Tier.title)) failed.push(q);
  }
  return { top3, failed, ok: failed.length === 0 };
}

export interface SmokeResult {
  readonly checks: Array<{ q: string; appid: number; top: number; got: number[]; ok: boolean }>;
  readonly ok: boolean;
}

/** Consultas de humo de la §4.6 en la lista visible (con el nivel 4). */
export function evaluateSmoke(s: Searcher, fuzzy: FuzzyMatcher): SmokeResult {
  const checks = SMOKE_QUERIES.map(({ q, appid, top }) => {
    const got = visibleList(s, fuzzy, q)
      .slice(0, top)
      .map((i) => i.appid);
    return { q, appid, top, got, ok: got.includes(appid) };
  });
  return { checks, ok: checks.every((c) => c.ok) };
}
