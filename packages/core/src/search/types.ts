// Tipos públicos de la búsqueda (§8.4 y §8.7 de prototipe.md).

import type { CooperativeTask } from '../catalog-format/cooperative.ts';

/** Niveles de *ranking* (§8.4); `link` es un `appid:` explícito (§8.6). */
export const Tier = {
  link: -1,
  exact: 0,
  title: 1,
  words: 2,
  substring: 3,
  fuzzy: 4,
} as const;
export type Tier = (typeof Tier)[keyof typeof Tier];

/** Estado del Worker de búsqueda (§8.8); `boot` llega en M3. */
export type SearchState = 'none' | 'scan' | 'full';

/** Fila del núcleo tal como la ve la interfaz. */
export interface CatalogItem {
  readonly appid: number;
  readonly name: string;
  readonly nameEs: string | null;
  readonly year: number | null;
  readonly flags: number;
}

/** Resultado de una consulta, con el nivel por el que entró. */
export interface SearchItem extends CatalogItem {
  readonly tier: Tier;
}

export interface QueryOptions {
  /** Filas pedidas; la paleta pide 8 (§8.4). */
  readonly limit?: number;
  /** Mostrar +18 (Ajustes); si no, se filtran antes de contar para `limit`. */
  readonly showAdult?: boolean;
}

export interface QueryResult {
  /** Niveles 0–3 ordenados según la §8.4, como mucho `limit`. */
  readonly items: SearchItem[];
  /**
   * Filas de los niveles 0–2 reunidas antes de recortar a `limit` (puede pasar de `limit`); con
   * <5 se ofrece el nivel 4 (`canSuggest`).
   */
  readonly strong: number;
}

/** Filtro del Catálogo: texto (niveles 0–2, sin límite) y bits de `flags`. */
export interface BrowseFilter {
  readonly showAdult?: boolean;
  /** Bits que deben estar todos. */
  readonly flagsAll?: number;
  /** Bits que no debe tener ninguno. */
  readonly flagsNone?: number;
}

export interface BrowseResult {
  /** Filas que cumplen el filtro. */
  readonly count: number;
  /** Ventana `[from, to)` en el orden del núcleo; como mucho 200 filas (§8.7). */
  slice(from: number, to: number): CatalogItem[];
}

/** Lo que el nivel 4 necesita de uFuzzy (lo da `loadFuzzy()`; en pruebas se puede simular). */
export interface FuzzyMatcher {
  filter(haystack: string[], needle: string): number[] | null;
}

export interface SuggestOptions {
  /** Sugerencias como mucho (3 en la paleta). */
  readonly limit?: number;
  readonly showAdult?: boolean;
  /** `appid` ya presentes en los resultados, que no se repiten. */
  readonly exclude?: readonly number[];
}

/** Nivel 4 cooperativo: cada `step()` recorre un bloque de 20 000 nombres (§8.7). */
export interface SuggestTask {
  /** Procesa el siguiente bloque; `true` al terminar. Para cancelar, basta con no seguir. */
  step(): boolean;
  /** Sugerencias reunidas hasta ahora (tier 4), en orden de filas. */
  readonly items: SearchItem[];
}

/** Buscador sobre el catálogo: el puente de escaneo (`scan`) o el índice completo (`full`). */
export interface Searcher {
  readonly state: 'scan' | 'full';
  /** Versión del núcleo indexado. */
  readonly version: string;
  /** Juegos en el núcleo (con +18). */
  readonly count: number;
  /** Consulta de la paleta: niveles 0–3 (§8.3–§8.6). */
  query(q: string, options?: QueryOptions): QueryResult;
  /** Nivel 4 diferido; el Worker cede el turno entre `step()` y abandona si llega otro `seq`. */
  suggest(q: string, fuzzy: FuzzyMatcher, options?: SuggestOptions): SuggestTask;
  /** `appid` con la misma clave exacta que `title`, sin alias ni filtro de +18 («Vincular»). */
  matchExact(title: string): number[];
  /** Fila de un `appid`, o `null` si no está en el núcleo. */
  game(appid: number): CatalogItem | null;
  /** Filas de varios `appid` (juegos provisionales). */
  lookup(appids: readonly number[]): { found: CatalogItem[]; missing: number[] };
  /** Vista del Catálogo: recuento y ventanas de filas en el orden del núcleo. */
  browse(q: string, filter?: BrowseFilter): BrowseResult;
  /** Olvida la caché del nivel 3 entre pulsaciones (no cambia los resultados). */
  reset(): void;
}

/** Construcción cooperativa: `none` → `scan` → `full`; `result` es el buscador completo. */
export interface IndexBuilder extends CooperativeTask<Searcher> {
  readonly state: SearchState;
  /** Buscador vigente: `null` en `none`, el de escaneo en `scan` y el completo en `full`. */
  readonly searcher: Searcher | null;
}
