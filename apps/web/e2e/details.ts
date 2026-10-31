// Detalles del catálogo y portadas en los E2E (M2): el índice de *shards* y los *kill switches*
// del catálogo en uso, los *shards* (con el *hash* en el nombre, como los publica el pipeline;
// §7.6) y las portadas, servidos con `context.route`. Ninguna petición llega al CDN de Valve.
import { createHash } from 'node:crypto';
import type { BrowserContext, Request } from '@playwright/test';

declare global {
  var __GA_DETAILS_TEST__: unknown;
}

export type Precision = 'day' | 'month' | 'quarter' | 'year' | 'soon' | 'tba';

export interface GameFixture {
  readonly capsule?: string | null;
  readonly header?: string | null;
  /** `[t, p]`, con `t` en segundos Unix. */
  readonly release?: readonly [number | null, Precision];
  /** `[score, reviews, pct]`. */
  readonly reviews?: readonly [number, number, number];
  readonly platforms?: number;
  readonly deck?: number;
  /** `asset_url_format`; por defecto, el de Steam con `?t=`. */
  readonly format?: string;
}

const SHARDS = 1024;
const PLACEHOLDER = '$' + '{FILENAME}';

/** FNV-1a de 32 bits de `String(appid)` mod 1024 (§7.6; como `detailShardOf` de core). */
export function shardOf(appid: number): number {
  const s = String(appid);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0) % SHARDS;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Segundos Unix de un día (a las 17:00 UTC, la hora habitual de Steam). */
export function day(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d, 17) / 1000;
}

export function steamAssetsFormat(appid: number): string {
  return `steam/apps/${appid}/${PLACEHOLDER}?t=1700000000`;
}

export function coverUrl(appid: number, file: string): string {
  return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/${file}?t=1700000000`;
}

export interface ServedDetails {
  /** Rutas de `details/…` pedidas. */
  readonly requests: string[];
  shardPath(appid: number): string;
}

/** Da al catálogo en uso el índice de *shards* de `games` y `killSwitches`, y los sirve. */
export async function serveDetails(
  context: BrowserContext,
  games: Readonly<Record<number, GameFixture>>,
  killSwitches = { covers: false, details: false },
): Promise<ServedDetails> {
  const byShard = new Map<number, Record<string, unknown>>();
  for (const [key, game] of Object.entries(games)) {
    const appid = Number(key);
    const shard = shardOf(appid);
    const data = byShard.get(shard) ?? {};
    data[key] = [
      game.format ?? steamAssetsFormat(appid),
      game.capsule === undefined ? 'library_600x900_spanish.jpg' : game.capsule,
      game.header === undefined ? 'header.jpg' : game.header,
      game.release ?? [day(2020, 1, 1), 'day'],
      game.reviews ?? [8, 1234, 90],
      game.platforms ?? 1,
      game.deck ?? 0,
    ];
    byShard.set(shard, data);
  }
  const files = new Map<string, string>();
  const paths = new Map<number, string>();
  const hashes: Array<string | null> = Array.from({ length: SHARDS }, () => null);
  for (const [shard, data] of byShard) {
    const text = JSON.stringify(data);
    const hash = sha256(text).slice(0, 16);
    hashes[shard] = hash;
    const path = `details/${String(shard).padStart(4, '0')}.${hash}.json`;
    files.set(path, text);
    paths.set(shard, path);
  }
  const indexText = JSON.stringify({
    format: 'gacat-details-index',
    v: 1,
    version: '20261028.1',
    shards: hashes,
  });
  const indexHash = sha256(indexText);
  const index = {
    path: `details/index.${indexHash.slice(0, 16)}.json`,
    sha256: indexHash,
    bytes: Buffer.byteLength(indexText),
  };
  files.set(index.path, indexText);

  // El índice y los *kill switches* entran por el gancho del *build* `e2e`
  // (`src/details/e2e-hooks.ts`), no cambiando el *manifest*: el WebKit de Playwright no intercepta
  // las peticiones del Worker y el *manifest* de M2 va firmado. Tampoco las que pasan por el
  // Service Worker, así que estas pruebas no lo registran (su registro se queda esperando, sin
  // errores; las pruebas de la PWA lo cubren aparte).
  await context.addInitScript(
    (options) => {
      globalThis.__GA_DETAILS_TEST__ = options;
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register = () => new Promise<ServiceWorkerRegistration>(() => {});
      }
    },
    { detailsIndex: index, killSwitches },
  );
  const requests: string[] = [];
  await context.route('**/catalog-dev/details/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/catalog-dev\//, '');
    const text = files.get(path);
    // Lo que no es de la prueba (p. ej., el índice del mini-catálogo, que el Worker de búsqueda
    // descarga con el catálogo) sigue hasta la vista previa.
    if (text === undefined) return route.fallback();
    requests.push(path);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
      body: text,
    });
  });
  return {
    requests,
    shardPath: (appid) => paths.get(shardOf(appid)) ?? '',
  };
}

/** PNG de 1 × 1 px. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

export interface CoverRequest {
  readonly url: string;
  /** ¿Estaba a la vista el aviso de primera capa cuando salió la petición? */
  readonly noticeVisible: boolean;
}

/**
 * Portadas del CDN de Valve servidas en local: las URL de `broken` responden con algo que no es
 * una imagen (la portada cae a la siguiente). Toda petición a `*.steamstatic.com` se anota.
 */
export async function serveCovers(
  context: BrowserContext,
  options: { broken?: readonly string[] } = {},
): Promise<CoverRequest[]> {
  const requests: CoverRequest[] = [];
  await context.route(/^https?:\/\/([^/]+\.)?steamstatic\.com\//, async (route) => {
    const request = route.request();
    const frame = request.frame();
    const noticeVisible = await frame
      .page()
      .getByRole('region', { name: 'Aviso sobre las portadas' })
      .isVisible()
      .catch(() => false);
    requests.push({ url: request.url(), noticeVisible });
    const broken = options.broken?.some((part) => request.url().includes(part)) ?? false;
    return route.fulfill({
      status: 200,
      contentType: broken ? 'text/plain' : 'image/png',
      headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
      body: broken ? 'no es una imagen' : PNG,
    });
  });
  return requests;
}

/** Peticiones a `*.steamstatic.com` vistas por la página (aunque nadie las sirva). */
export function watchSteamRequests(context: BrowserContext): Request[] {
  const seen: Request[] = [];
  context.on('request', (request) => {
    if (/^https?:\/\/([^/]+\.)?steamstatic\.com\//.test(request.url())) seen.push(request);
  });
  return seen;
}
