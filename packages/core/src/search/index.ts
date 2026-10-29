// Búsqueda instantánea (§8): índice y ranking por niveles 0–4, puente de escaneo y Catálogo.
// API pura para el Worker de búsqueda: sin E/S y con el reloj como parámetro.

export { type BuildOptions, buildSearcher, createIndexBuilder } from './builder.ts';
export { canSuggest, FUZZY_BLOCK, loadFuzzy, SUGGEST_LIMIT, withSuggestions } from './fuzzy.ts';
export { PALETTE_LIMIT } from './searcher.ts';
export {
  type BrowseFilter,
  type BrowseResult,
  type CatalogItem,
  type FuzzyMatcher,
  type IndexBuilder,
  type QueryOptions,
  type QueryResult,
  type Searcher,
  type SearchItem,
  type SearchState,
  type SuggestOptions,
  type SuggestTask,
  Tier,
} from './types.ts';
