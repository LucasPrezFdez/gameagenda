// Consulta común a los dos motores (§8.3–§8.6): nivel 0 y alias, niveles 1–2 del motor, nivel 3
// sobre el pajar y orden final. El escaneo y el índice solo cambian cómo encuentran las filas.

import { ARTICLES, compact, normalize, stripArticle, tokenize } from '../normalize/index.ts';
import { suggestTask } from './fuzzy.ts';
import { rowsContaining } from './haystack.ts';
import {
  catalogItem,
  hiddenAdult,
  isRetired,
  type KeyData,
  rowOfAppid,
  searchItem,
} from './keys.ts';
import {
  type BrowseFilter,
  type BrowseResult,
  type CatalogItem,
  type FuzzyMatcher,
  type QueryOptions,
  type QueryResult,
  type Searcher,
  type SuggestOptions,
  type SuggestTask,
  Tier,
} from './types.ts';

/** Filas que pide la paleta (§8.4). */
export const PALETTE_LIMIT = 8;
/** El nivel 3 se evalúa si los niveles 0–2 dan menos de esto. */
const SUBSTRING_MIN = 8;
/** Filas de subcadena que se guardan por pulsación (caché del nivel 3). */
const SUBSTRING_CAP = 200;
/** Filas del nivel 3 que entran como mucho. */
const SUBSTRING_ROWS = 3;
/** Bonificación del nivel 1 sobre el 2 en la ordenación conjunta (§8.4). */
const TITLE_BONUS = 6;
/** Ventana máxima de `browse` (§8.7). */
const BROWSE_WINDOW = 200;

const RE_APPID = /^appid:\s*(\d{1,10})$/i;

/** Consulta ya normalizada. */
export interface QueryContext {
  readonly qn: string;
  /** Sin el artículo inicial (igual a `qn` si no lo hay). */
  readonly qa: string;
  readonly qc: string;
  /** Tokens de la consulta, sin el artículo inicial cuando hay más. */
  readonly qt: readonly string[];
  /** Primeros tokens de `qn` y de `qa`, sin repetir (niveles 0 y 1). */
  readonly firsts: readonly string[];
}

export function makeContext(q: string): QueryContext {
  const qn = normalize(q);
  const qa = stripArticle(qn);
  const all = tokenize(qn, true);
  const qt = all.length > 1 && ARTICLES.has(all[0] as string) ? all.slice(1) : all;
  const firsts = new Set<string>();
  if (all[0] !== undefined) firsts.add(all[0]);
  const fa = qa === qn ? all[0] : tokenize(qa, true)[0];
  if (fa !== undefined) firsts.add(fa);
  return { qn, qa, qc: compact(qn), qt, firsts: [...firsts] };
}

/** Resultados reunidos: sin repetir y sin +18 si no se muestran (se filtran antes de contar). */
export class Collector {
  readonly rows: number[] = [];
  readonly tiers: Tier[] = [];
  private readonly seen = new Set<number>();
  private readonly keys: KeyData;
  private readonly showAdult: boolean;

  constructor(keys: KeyData, showAdult: boolean) {
    this.keys = keys;
    this.showAdult = showAdult;
  }

  get size(): number {
    return this.rows.length;
  }

  has(g: number): boolean {
    return this.seen.has(g);
  }

  /** `true` si la fila puede entrar (no está ya y no es un +18 oculto). */
  accepts(g: number): boolean {
    return !this.seen.has(g) && !hiddenAdult(this.keys, g, this.showAdult);
  }

  push(g: number, tier: Tier): boolean {
    if (!this.accepts(g)) return false;
    this.seen.add(g);
    this.rows.push(g);
    this.tiers.push(tier);
    return true;
  }
}

/** Lo que cada motor aporta a la consulta común. */
export interface LevelEngine {
  readonly state: 'scan' | 'full';
  readonly keys: KeyData;
  /** Nivel 0 sin alias: filas con clave exacta, ascendentes y sin repetir. */
  exactRows(ctx: QueryContext): number[];
  /**
   * Niveles 1 y 2 en orden de filas, con salida temprana: hasta `limit` filas nuevas de cada
   * nivel (el 2 no repite las del 1).
   */
  titleAndWords(ctx: QueryContext, acc: Collector, limit: number): void;
  /** Todas las filas del nivel 2 (que incluye el 1), ascendentes: filtro del Catálogo. */
  wordRows(ctx: QueryContext): number[];
}

/** Grupo de orden: `appid:`, nivel 0, niveles 1–2 juntos, nivel 3, nivel 4. */
function group(t: Tier): number {
  if (t <= Tier.exact) return t + 1;
  if (t <= Tier.words) return 2;
  return t;
}

/**
 * Orden de la §8.4: nivel 0 primero; los niveles 1 y 2 juntos por `pop + 6` / `pop + 0` y, a
 * igualdad, por fila; después el 3. En cada grupo los retirados van detrás de los vivos.
 */
function ordered(keys: KeyData, acc: Collector): number[] {
  const { rows, tiers } = acc;
  const pop = keys.cat.pop;
  const score = (i: number): number =>
    (pop[rows[i] as number] as number) + (tiers[i] === Tier.title ? TITLE_BONUS : 0);
  const idx = rows.map((_, i) => i);
  idx.sort((a, b) => {
    const ga = group(tiers[a] as Tier);
    const gb = group(tiers[b] as Tier);
    if (ga !== gb) return ga - gb;
    const ra = rows[a] as number;
    const rb = rows[b] as number;
    const retired = Number(isRetired(keys, ra)) - Number(isRetired(keys, rb));
    if (retired !== 0) return retired;
    if (ga === 2) {
      const s = score(b) - score(a);
      if (s !== 0) return s;
    }
    return ra - rb;
  });
  return idx;
}

function mergeSorted(a: readonly number[], b: readonly number[]): number[] {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const x = i < a.length ? (a[i] as number) : Number.POSITIVE_INFINITY;
    const y = j < b.length ? (b[j] as number) : Number.POSITIVE_INFINITY;
    const v = Math.min(x, y);
    if (x === v) i++;
    if (y === v) j++;
    if (out.length === 0 || out[out.length - 1] !== v) out.push(v);
  }
  return out;
}

function matchesCompact(keys: KeyData, g: number, qc: string): boolean {
  if (compact(keys.kBase[g] as string).includes(qc)) return true;
  const e = keys.kEs.get(g);
  return e !== undefined && compact(e).includes(qc);
}

/** Monta el buscador público sobre un motor. */
export function createSearcher(engine: LevelEngine): Searcher {
  const keys = engine.keys;
  // Caché del nivel 3: si la nueva clave contiene la anterior, se filtra el resultado previo.
  let subCache: { qc: string; rows: number[]; complete: boolean } | null = null;

  function substringRows(qc: string): number[] {
    let rows: number[];
    if (subCache?.complete && qc.includes(subCache.qc)) {
      rows = subCache.rows.filter((g) => matchesCompact(keys, g, qc));
    } else {
      rows = rowsContaining(keys.haystack, qc, SUBSTRING_CAP);
    }
    subCache = { qc, rows, complete: rows.length < SUBSTRING_CAP };
    return rows;
  }

  function query(q: string, options: QueryOptions = {}): QueryResult {
    const limit = Math.max(1, Math.floor(options.limit ?? PALETTE_LIMIT));
    const acc = new Collector(keys, options.showAdult ?? false);
    const ctx = makeContext(q);
    if (ctx.qn) {
      const m = RE_APPID.exec(q.trim());
      if (m) {
        const g = rowOfAppid(keys, Number(m[1]));
        if (g >= 0) acc.push(g, Tier.link);
      } else {
        const alias = keys.aliasExact.get(ctx.qc) ?? [];
        for (const g of mergeSorted(engine.exactRows(ctx), alias)) acc.push(g, Tier.exact);
        if (acc.size < limit) engine.titleAndWords(ctx, acc, limit);
        if (acc.size < SUBSTRING_MIN && ctx.qc.length >= 3) {
          let taken = 0;
          for (const g of substringRows(ctx.qc)) {
            if (acc.size >= limit || taken >= SUBSTRING_ROWS) break;
            if (acc.push(g, Tier.substring)) taken++;
          }
        }
      }
    }
    let strong = 0;
    for (const t of acc.tiers) if (t <= Tier.words) strong++;
    const items = ordered(keys, acc)
      .slice(0, limit)
      .map((i) => searchItem(keys, acc.rows[i] as number, acc.tiers[i] as Tier));
    return { items, strong };
  }

  function browse(q: string, filter: BrowseFilter = {}): BrowseResult {
    const flags = keys.cat.flags;
    const all = filter.flagsAll ?? 0;
    const none = filter.flagsNone ?? 0;
    const showAdult = filter.showAdult ?? false;
    const keep = (g: number): boolean => {
      const f = flags[g] as number;
      return (f & all) === all && (f & none) === 0 && !hiddenAdult(keys, g, showAdult);
    };
    const ctx = makeContext(q);
    let picked: Uint32Array;
    if (!ctx.qn) {
      const tmp = new Uint32Array(keys.n);
      let k = 0;
      for (let g = 0; g < keys.n; g++) if (keep(g)) tmp[k++] = g;
      picked = tmp.slice(0, k);
    } else {
      const m = RE_APPID.exec(q.trim());
      let rows: number[];
      if (m) {
        const g = rowOfAppid(keys, Number(m[1]));
        rows = g >= 0 ? [g] : [];
      } else {
        const alias = keys.aliasExact.get(ctx.qc) ?? [];
        rows = mergeSorted(mergeSorted(engine.exactRows(ctx), alias), engine.wordRows(ctx));
      }
      picked = Uint32Array.from(rows.filter(keep));
    }
    return {
      count: picked.length,
      slice(from: number, to: number): CatalogItem[] {
        const a = Math.max(0, Math.floor(from));
        const b = Math.min(picked.length, Math.floor(to), a + BROWSE_WINDOW);
        const out: CatalogItem[] = [];
        for (let i = a; i < b; i++) out.push(catalogItem(keys, picked[i] as number));
        return out;
      },
    };
  }

  return {
    state: engine.state,
    version: keys.cat.version,
    count: keys.n,
    query,
    suggest(q: string, fuzzy: FuzzyMatcher, options: SuggestOptions = {}): SuggestTask {
      return suggestTask(keys, q, fuzzy, options);
    },
    matchExact(title: string): number[] {
      const ctx = makeContext(title);
      if (!ctx.qn) return [];
      return engine.exactRows(ctx).map((g) => keys.cat.appid[g] as number);
    },
    game(appid: number): CatalogItem | null {
      const g = rowOfAppid(keys, appid);
      return g < 0 ? null : catalogItem(keys, g);
    },
    lookup(appids: readonly number[]) {
      const found: CatalogItem[] = [];
      const missing: number[] = [];
      for (const a of appids) {
        const g = rowOfAppid(keys, a);
        if (g < 0) missing.push(a);
        else found.push(catalogItem(keys, g));
      }
      return { found, missing };
    },
    browse,
    reset(): void {
      subCache = null;
    },
  };
}
