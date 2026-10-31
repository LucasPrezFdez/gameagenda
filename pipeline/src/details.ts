// Detalles por juego en *shards* (§7.6): de lo que ya trae Query (o `GetItems`) con `include_assets`,
// `include_release`, `include_reviews` e `include_platforms`, sin peticiones de más. Cada juego da
// `[fmt, capsule, header, [t, p], [score, reviews, pct], plat, deck]`, y los 1 024 *shards* y su
// índice se escriben con los esquemas de `core/catalog-format`.

import { createHash } from 'node:crypto';
import {
  DETAIL_SHARDS,
  DeckSupport,
  DetailPlatform,
  type DetailsIndex,
  detailShardOf,
  detailShardPath,
  type GameDetails,
  type ReleasePrecision,
} from '@gameagenda/core/catalog-format';
import type { StoreItem } from '../steam/schemas.ts';

/**
 * Fichero de una portada tal como lo da Steam: `header.jpg`, `portrait.png`,
 * `<sha1>/library_capsule_spanish.jpg`… El 29-10-2026, los 414 000 de la pasada cumplen esta forma
 * salvo uno con `../` (4115900): una ruta así no se publica (§11.3: rutas validadas).
 */
const RE_ASSET_FILE = /^(?:[0-9a-f]{40}\/)?[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp|gif)$/;

/** `asset_url_format` válido para `appid`: `steam/apps/<appid>/${FILENAME}` y, si lo trae, `?t=`. */
export function isAssetUrlFormat(fmt: string, appid: number): boolean {
  return (
    fmt === `steam/apps/${appid}/\${FILENAME}` ||
    new RegExp(`^steam/apps/${appid}/\\$\\{FILENAME\\}\\?t=\\d{1,12}$`).test(fmt)
  );
}

/** El fichero de una portada si tiene forma de fichero de imagen; si no, `null`. */
export function assetFile(name: string | undefined): string | null {
  return name !== undefined && RE_ASSET_FILE.test(name) ? name : null;
}

/** Precisión de cada `coming_soon_display` con fecha (§4.9 y §7.6). */
const PRECISION: Readonly<Record<string, ReleasePrecision>> = {
  date_full: 'day',
  date_month: 'month',
  date_quarter: 'quarter',
  date_year: 'year',
};

/**
 * `[t, p]` (§7.6): los publicados, `day` con su fecha (o `null` si Steam no da ninguna). Los
 * «próximamente», con la precisión de `coming_soon_display`; sin fecha que mostrar
 * (`text_comingsoon` → `soon`; `text_tba`, ningún `coming_soon_display` o ninguna fecha → `tba`),
 * con `t = null`, como el bit 32 del núcleo, que deja `year` vacío. Un valor desconocido con fecha,
 * `year`: el núcleo enseña su año.
 */
export function releaseOf(it: StoreItem): [number | null, ReleasePrecision] {
  const r = it.release ?? {};
  const soon = Boolean(it.is_coming_soon || r.is_coming_soon);
  const ts = r.steam_release_date || r.original_release_date || 0;
  if (!soon) return [ts || null, 'day'];
  const display = r.coming_soon_display;
  if (display === 'text_comingsoon') return [null, 'soon'];
  if (display === undefined || display === 'text_tba' || !ts) return [null, 'tba'];
  return [ts, PRECISION[display] ?? 'year'];
}

const clamp = (v: number | undefined, max: number): number =>
  v === undefined || !Number.isInteger(v) || v < 0 ? 0 : Math.min(v, max);

/**
 * Detalles de un juego, o `null` si Steam no da un `asset_url_format` válido (10 de 207 402 el
 * 29-10-2026): sin él no se puede construir ninguna URL de portada (§4.10; CA2.6) y el esquema de
 * `core` lo exige.
 */
export function detailsOf(appid: number, it: StoreItem): GameDetails | null {
  const fmt = it.assets?.asset_url_format;
  if (!fmt || !isAssetUrlFormat(fmt, appid)) return null;
  const rv = it.reviews?.summary_filtered;
  const p = it.platforms;
  let plat = 0;
  if (p?.windows) plat |= DetailPlatform.windows;
  if (p?.mac) plat |= DetailPlatform.mac;
  if (p?.steamos_linux) plat |= DetailPlatform.linux;
  const deck = p?.steam_deck_compat_category ?? DeckSupport.unknown;
  return [
    fmt,
    assetFile(it.assets?.library_capsule),
    assetFile(it.assets?.header),
    releaseOf(it),
    [
      clamp(rv?.review_score, 9),
      clamp(rv?.review_count, Number.MAX_SAFE_INTEGER),
      clamp(rv?.percent_positive, 100),
    ],
    plat,
    deck <= DeckSupport.verified ? deck : DeckSupport.unknown,
  ];
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export interface DetailFiles {
  /** `details/index.<hash>.json` y su texto. */
  readonly indexPath: string;
  readonly indexText: string;
  readonly index: DetailsIndex;
  /** Ruta publicada → texto de cada *shard* con juegos. */
  readonly shards: ReadonlyMap<string, string>;
  /** Juegos con detalles. */
  readonly games: number;
}

/**
 * Los 1 024 *shards* y su índice. Un *shard* es un objeto `appid → detalles` en JSON compacto; las
 * claves enteras salen siempre en orden ascendente (`JSON.stringify`), así que el texto (y su
 * *hash*) solo depende de los juegos: un *shard* que no cambia conserva su nombre entre versiones.
 */
export function buildDetailFiles(
  games: Iterable<{ readonly appid: number; readonly details?: GameDetails | undefined }>,
  version: string,
): DetailFiles {
  const byShard: Array<Record<string, GameDetails>> = Array.from(
    { length: DETAIL_SHARDS },
    () => ({}),
  );
  let count = 0;
  for (const g of games) {
    if (!g.details) continue;
    (byShard[detailShardOf(g.appid)] as Record<string, GameDetails>)[String(g.appid)] = g.details;
    count++;
  }
  const shards = new Map<string, string>();
  const hashes: Array<string | null> = byShard.map((shard, n) => {
    if (Object.keys(shard).length === 0) return null;
    const text = JSON.stringify(shard);
    const hash = sha256(text).slice(0, 16);
    shards.set(detailShardPath(n, hash), text);
    return hash;
  });
  const index: DetailsIndex = { format: 'gacat-details-index', v: 1, version, shards: hashes };
  const indexText = JSON.stringify(index);
  return {
    indexPath: `details/index.${sha256(indexText).slice(0, 16)}.json`,
    indexText,
    index,
    shards,
    games: count,
  };
}
