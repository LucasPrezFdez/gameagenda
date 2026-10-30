// Detalles por juego en *shards* (§7.6): `details/<nnnn>.<hash>.json`, con `nnnn` = FNV-1a de 32
// bits de `String(appid)` mod 1024, y el índice `details/index.<hash>.json`, que da el *hash* de
// cada *shard*. Lo genera el pipeline (M2); el cliente pide solo los *shards* que necesita y
// comprueba que el SHA-256 de cada uno empieza por el *hash* de su nombre.

import '../zod-config.ts';
import { z } from 'zod';

export const DETAIL_SHARDS = 1024;

/** *Shard* de un juego: FNV-1a de 32 bits de `String(appid)` mod 1024 (`730` → 765). */
export function detailShardOf(appid: number): number {
  const s = String(appid);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0) % DETAIL_SHARDS;
}

/** Ruta publicada de un *shard*: `details/0765.<hash>.json`. */
export function detailShardPath(shard: number, hash: string): string {
  return `details/${String(shard).padStart(4, '0')}.${hash}.json`;
}

const RE_HASH16 = /^[0-9a-f]{16}$/;

/**
 * Índice de *shards*: el *hash* (16 dígitos hexadecimales del SHA-256) de cada uno, por número de
 * *shard*, o `null` si no tiene ningún juego (pasa con el mini-catálogo de las pruebas).
 */
export const detailsIndexSchema = z.object({
  format: z.literal('gacat-details-index'),
  v: z.literal(1),
  version: z.string().regex(/^\d{8}\.[1-9]\d*$/),
  shards: z.array(z.string().regex(RE_HASH16).nullable()).length(DETAIL_SHARDS),
});

/** Precisión de la fecha según `coming_soon_display`; `soon` y `tba` se muestran «Por confirmar». */
export const RELEASE_PRECISIONS = ['day', 'month', 'quarter', 'year', 'soon', 'tba'] as const;
export type ReleasePrecision = (typeof RELEASE_PRECISIONS)[number];

/** Bits de `plat` (§7.6). */
export const DetailPlatform = { windows: 1, mac: 2, linux: 4 } as const;
/** `deck` (§7.6): 0 desconocido, 1 no compatible, 2 jugable, 3 verificado. */
export const DeckSupport = { unknown: 0, unsupported: 1, playable: 2, verified: 3 } as const;

const count = z.int().nonnegative();

/**
 * Detalles de un juego: `[fmt, capsule, header, release, [score, reviews, pct], plat, deck]`.
 * `fmt` es el `asset_url_format` de Steam y `capsule` y `header`, los ficheros de `library_capsule`
 * y `header` tal cual, o `null` si no los hay. La URL de una portada solo se construye con `fmt`
 * (§4.10; CA2.6). `release` = `[t, p]`, con `t` en segundos Unix o `null`.
 */
export const gameDetailsSchema = z.tuple([
  z.string().min(1),
  z.string().min(1).nullable(),
  z.string().min(1).nullable(),
  z.tuple([z.int().nullable(), z.enum(RELEASE_PRECISIONS)]),
  z.tuple([z.int().min(0).max(9), count, z.int().min(0).max(100)]),
  z.int().min(0).max(7),
  z.int().min(0).max(3),
]);

/** Un *shard*: detalles por `appid` (en decimal, como clave del objeto). */
export const detailShardSchema = z.record(z.string().regex(/^[1-9]\d*$/), gameDetailsSchema);

export type DetailsIndex = z.infer<typeof detailsIndexSchema>;
export type GameDetails = z.infer<typeof gameDetailsSchema>;
export type DetailShard = z.infer<typeof detailShardSchema>;

/** Los detalles de `appid` en forma de objeto, para la interfaz. */
export interface GameDetailsView {
  readonly assetUrlFormat: string;
  readonly capsule: string | null;
  readonly header: string | null;
  readonly releaseTime: number | null;
  readonly releasePrecision: ReleasePrecision;
  readonly reviewScore: number;
  readonly reviewCount: number;
  readonly reviewPercent: number;
  readonly platforms: number;
  readonly deck: number;
}

export function viewDetails(d: GameDetails): GameDetailsView {
  const [
    assetUrlFormat,
    capsule,
    header,
    [releaseTime, releasePrecision],
    review,
    platforms,
    deck,
  ] = d;
  return {
    assetUrlFormat,
    capsule,
    header,
    releaseTime,
    releasePrecision,
    reviewScore: review[0],
    reviewCount: review[1],
    reviewPercent: review[2],
    platforms,
    deck,
  };
}
