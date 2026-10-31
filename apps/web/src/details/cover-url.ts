// URL de las portadas (§4.10): `https://shared.akamai.steamstatic.com/store_item_assets/` +
// `asset_url_format` con `${FILENAME}` sustituido por el fichero de `library_capsule` o de
// `header`. Ninguna URL se construye fuera de `asset_url_format` (CA2.6): ni rutas adivinadas sin
// *hash* ni otro CDN. Lo que no cumple el formato no se pide y queda la portada generada.
//
// Sin dependencias (ni Zod ni el formato del catálogo): va en el *chunk* inicial.

/** El CDN de imágenes que admite la CSP (`img-src`, §11.3). */
export const STEAM_ASSETS_ORIGIN = 'https://shared.akamai.steamstatic.com';
export const STEAM_ASSETS_BASE = `${STEAM_ASSETS_ORIGIN}/store_item_assets/`;

const FILENAME = `\${FILENAME}`;
/** Segmentos de ruta de Steam: `steam/apps/730/`, sin `..`, barras dobles ni esquema. */
const RE_PATH = /^(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*$/;
/** Lo que va tras `${FILENAME}`: nada o una consulta como `?t=1793054556`. */
const RE_QUERY = /^(?:\?[A-Za-z0-9._=&-]*)?$/;
/** Fichero: `library_600x900.jpg`, `portrait.png` o `<sha1>/library_capsule.jpg`. */
const RE_FILE = /^(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

function safeSegments(path: string): boolean {
  return path.split('/').every((segment) => segment !== '.' && segment !== '..');
}

/** URL de un fichero de portada, o `null` si `format` o `file` no tienen la forma esperada. */
export function coverUrl(format: string, file: string): string | null {
  const at = format.indexOf(FILENAME);
  if (at < 0 || format.indexOf(FILENAME, at + 1) >= 0) return null;
  const before = format.slice(0, at);
  const after = format.slice(at + FILENAME.length);
  if (!RE_PATH.test(before) || !RE_QUERY.test(after) || !safeSegments(before)) return null;
  if (!RE_FILE.test(file) || !safeSegments(file)) return null;
  const url = new URL(`${STEAM_ASSETS_BASE}${before}${file}${after}`);
  // Cinturón y tirantes: el resultado sigue en el CDN y bajo `store_item_assets/`.
  if (url.origin !== STEAM_ASSETS_ORIGIN || !url.pathname.startsWith('/store_item_assets/')) {
    return null;
  }
  return url.href;
}

/** Lo que hace falta de los detalles de un juego para su portada (§7.6). */
export interface CoverAssets {
  readonly assetUrlFormat: string;
  readonly capsule: string | null;
  readonly header: string | null;
}

/** Portadas en orden de preferencia (§9.5, regla 5): `library_capsule` y después `header`. */
export function coverCandidates(assets: CoverAssets): string[] {
  const urls: string[] = [];
  for (const file of [assets.capsule, assets.header]) {
    if (file === null) continue;
    const url = coverUrl(assets.assetUrlFormat, file);
    if (url !== null && !urls.includes(url)) urls.push(url);
  }
  return urls;
}
