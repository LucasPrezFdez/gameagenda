// URL de los tres endpoints del pipeline (§4.4 y §4.5). La clave nunca va en la URL: viaja en la
// cabecera `x-webapi-key`, así que las URL (y los *fixtures*) son iguales con clave y sin ella.

export const API_ORIGIN = 'https://api.steampowered.com';

/** Idioma y país de la petición (`context`). */
export interface StoreContext {
  readonly language: string;
  readonly country: string;
}

export const ES: StoreContext = { language: 'spanish', country: 'ES' };
export const US: StoreContext = { language: 'spanish', country: 'US' };
/** Nombre base en el plan B sin clave (el de `GetAppList` está en inglés). */
export const ENGLISH_ES: StoreContext = { language: 'english', country: 'ES' };

/**
 * `data_request` del pipeline (§4.5 y DECISIONES §10.4): sin `include_basic_info` (pesa ≈2,6× y
 * el núcleo no usa sus campos) y sin precios.
 */
export const DATA_REQUEST = {
  include_release: true,
  include_assets: true,
  include_reviews: true,
  include_platforms: true,
  include_best_purchase_option: false,
} as const;

/** `GetItems` admite ≤200 `appid` por petición (URL ≤≈8 KB). */
export const GET_ITEMS_BATCH = 200;
/** `GetAppList` devuelve como mucho 50 000 por página. */
export const APP_LIST_PAGE = 50_000;

function withInput(path: string, input: unknown): string {
  return `${API_ORIGIN}${path}?input_json=${encodeURIComponent(JSON.stringify(input))}`;
}

/** Página de Query ordenada por `appid` (`sort: 2`), solo juegos. */
export function queryUrl(start: number, count: number, ctx: StoreContext = ES): string {
  return withInput('/IStoreQueryService/Query/v1/', {
    query: { start, count, sort: 2, filters: { type_filters: { include_games: true } } },
    context: { language: ctx.language, country_code: ctx.country },
    data_request: DATA_REQUEST,
  });
}

/** Lote de `GetItems` (≤200 `appid`), con el mismo `data_request` que Query. */
export function getItemsUrl(appids: readonly number[], ctx: StoreContext = ES): string {
  if (appids.length === 0 || appids.length > GET_ITEMS_BATCH) {
    throw new RangeError(`GetItems admite de 1 a ${GET_ITEMS_BATCH} appid (${appids.length})`);
  }
  return withInput('/IStoreBrowseService/GetItems/v1/', {
    ids: appids.map((appid) => ({ appid })),
    context: { language: ctx.language, country_code: ctx.country },
    data_request: DATA_REQUEST,
  });
}

/** Página de `GetAppList` (con clave, en la cabecera): juegos a partir de `lastAppid`. */
export function appListUrl(lastAppid: number, maxResults = APP_LIST_PAGE): string {
  const q = new URLSearchParams({
    include_games: 'true',
    include_dlc: 'false',
    include_software: 'false',
    include_videos: 'false',
    include_hardware: 'false',
    max_results: String(maxResults),
  });
  if (lastAppid > 0) q.set('last_appid', String(lastAppid));
  return `${API_ORIGIN}/IStoreService/GetAppList/v1/?${q}`;
}

/**
 * `true` si la petición lleva la clave: solo `GetAppList` (§4.4). Query y `GetItems` van sin ella
 * aunque el pipeline la tenga, así que las llamadas con clave son ≈4 al día (CA2.1: ≤10).
 */
export function needsKey(url: string): boolean {
  return endpointOf(url) === 'getapplist';
}

/** Endpoint de una URL de la API, para los registros y los nombres de los ficheros. */
export function endpointOf(url: string): 'query' | 'getitems' | 'getapplist' | 'other' {
  if (url.includes('/IStoreQueryService/Query/')) return 'query';
  if (url.includes('/IStoreBrowseService/GetItems/')) return 'getitems';
  if (url.includes('/IStoreService/GetAppList/')) return 'getapplist';
  return 'other';
}
