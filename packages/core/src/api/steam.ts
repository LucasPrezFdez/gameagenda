// Contrato de la importación de Steam (Fase 2; §10 de prototipe.md; ADR-012): las peticiones de la
// app a `/api/v1/steam/*` (objetos estrictos, como el resto de la micro-API) y lo que trae
// `redeem`. La biblioteca y la lista de deseados llegan tal como las da Steam, en *streaming*: el
// Worker no las lee (no le llegaría la CPU con miles de juegos), así que las valida la app con
// estos esquemas. Cada juego se valida aparte (`steamOwnedGameSchema`): uno raro no tira el resto.

import '../zod-config.ts';
import * as z from 'zod';
import { STEAM_LIST_MAX, STEAM_SECRET_PATTERN } from './constants.ts';

const secretSchema = z.string().regex(STEAM_SECRET_PATTERN);
const appidSchema = z.int().min(1).max(0xffff_ffff);
/** Instantes de Steam: segundos Unix; 0 si no hay. */
const unixSchema = z.int().min(0);

// --- Peticiones ---

/** `POST /api/v1/steam/start`: el `challenge` del canje tipo PKCE (`S256`). */
export const steamStartRequestSchema = z.strictObject({ challenge: secretSchema });
export type SteamStartRequest = z.input<typeof steamStartRequestSchema>;

/** `POST /api/v1/steam/redeem`: el ticket de `start` y el verificador del `challenge`. */
export const steamRedeemRequestSchema = z.strictObject({
  ticket: secretSchema,
  verifier: secretSchema,
});
export type SteamRedeemRequest = z.input<typeof steamRedeemRequestSchema>;

// --- Respuestas ---

export const steamStartResponseSchema = z.object({
  /** Solo lo tienen la app y la URL de vuelta de Steam; sin el verificador no sirve de nada. */
  ticket: secretSchema,
  /** La de OpenID 2.0 de Steam, que la app abre aparte. */
  url: z.string(),
  /** Instante ISO 8601 UTC. */
  expiresAt: z.string(),
});
export type SteamStartResponse = z.output<typeof steamStartResponseSchema>;

/** `redeem` con 202: aún no se ha iniciado sesión en Steam con este ticket. */
export const steamPendingResponseSchema = z.object({ status: z.literal('pending') });

/**
 * Un juego de `IPlayerService/GetOwnedGames/v1` con `include_appinfo`. Steam manda más campos
 * (`img_icon_url`, las horas por sistema…), que se ignoran. Con «Detalles de juegos» privado, la
 * respuesta llega sin `games` ni `game_count` (§10.1).
 */
export const steamOwnedGameSchema = z.object({
  appid: appidSchema,
  name: z.string().optional(),
  /** Minutos jugados en total. */
  playtime_forever: z.int().min(0).optional(),
  rtime_last_played: unixSchema.optional(),
});
export type SteamOwnedGame = z.output<typeof steamOwnedGameSchema>;

export const steamOwnedGamesSchema = z.object({
  response: z.object({
    game_count: z.int().min(0).optional(),
    games: z.array(z.unknown()).max(STEAM_LIST_MAX).optional(),
  }),
});
export type SteamOwnedGames = z.output<typeof steamOwnedGamesSchema>;

/** Un juego de `IWishlistService/GetWishlist/v1`. */
export const steamWishlistItemSchema = z.object({
  appid: appidSchema,
  priority: z.int().min(0).optional(),
  date_added: unixSchema.optional(),
});
export type SteamWishlistItem = z.output<typeof steamWishlistItemSchema>;

export const steamWishlistSchema = z.object({
  response: z.object({ items: z.array(z.unknown()).max(STEAM_LIST_MAX).optional() }),
});
export type SteamWishlist = z.output<typeof steamWishlistSchema>;

/**
 * `redeem` con 200: `{"owned": …, "wishlist": …}` con los dos cuerpos de Steam tal cual.
 * `wishlist` es `null` si Steam no la ha dado (la biblioteca sí: sin ella, `redeem` da 502).
 */
export const steamImportResponseSchema = z.object({
  owned: steamOwnedGamesSchema,
  wishlist: steamWishlistSchema.nullable(),
});
export type SteamImportResponse = z.output<typeof steamImportResponseSchema>;
