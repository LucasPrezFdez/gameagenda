// Lo que trae `POST /api/v1/steam/redeem` (Fase 2, parte 2; §10.1; ADR-012), leído y validado en
// el dispositivo: el Worker lo pasa tal cual porque leer una biblioteca de miles de juegos no le
// cabe en la CPU. Va en su propio *chunk* (con Zod), que la importación pide al recibir la
// respuesta.
//
// - Cada juego se valida aparte: uno raro no tira el resto (se cuenta en `skipped`).
// - Con «Detalles de juegos» privado, Steam responde sin `games` ni `game_count` (§10.1): es
//   `private`, no una biblioteca vacía.
// - Los nombres, como texto limpio (sin caracteres de control y 200 caracteres como mucho).
// - Validar miles de juegos se hace a trozos, cediendo el turno entre uno y otro (§9.5).

import {
  STEAM_IMPORT_MAX_BYTES,
  steamImportResponseSchema,
  steamOwnedGameSchema,
  steamWishlistItemSchema,
} from '@gameagenda/core/api';
import { yieldToMain } from '../lib/yield.ts';

export interface SteamOwnedGame {
  readonly appid: number;
  /** El de Steam, si lo trae: sirve para los que no están en el catálogo. */
  readonly name: string | null;
  /** Minutos jugados en total. */
  readonly minutes: number;
  /** Última partida, en ms UTC; `null` si nunca. */
  readonly lastPlayedAt: number | null;
}

export interface SteamWish {
  readonly appid: number;
  /** El orden de la lista de deseados en Steam (0: sin orden). */
  readonly priority: number;
  /** Cuándo se añadió, en ms UTC; `null` si Steam no lo dice. */
  readonly addedAt: number | null;
}

export interface SteamLibrary {
  /** `private`: «Detalles de juegos» no es público, y Steam no da la biblioteca. */
  readonly visibility: 'public' | 'private';
  readonly owned: readonly SteamOwnedGame[];
  /** `null` si Steam no la ha dado (el Worker la deja en `null`). */
  readonly wishlist: readonly SteamWish[] | null;
  /** Juegos que no pasan el esquema (o repetidos): no se cuentan. */
  readonly skipped: number;
}

/** Juegos que se validan seguidos antes de ceder el turno. */
export const VALIDATE_BATCH = 500;
const NAME_MAX = 200;

/** Un nombre de Steam como texto limpio, o `null` si no queda nada. */
export function cleanSteamName(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const text = raw
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text === '') return null;
  if (text.length <= NAME_MAX) return text;
  const cut = text.slice(0, NAME_MAX);
  const last = cut.charCodeAt(cut.length - 1);
  return (last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut).trimEnd();
}

const unixToMs = (seconds: number | undefined): number | null =>
  seconds === undefined || seconds === 0 ? null : seconds * 1000;

/**
 * El cuerpo de `redeem`, ya leído como texto. `null` si no es lo que manda el Worker (JSON roto,
 * un *stream* cortado o algo que no pasa el esquema).
 */
export async function readSteamImport(text: string): Promise<SteamLibrary | null> {
  if (text.length > STEAM_IMPORT_MAX_BYTES) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = steamImportResponseSchema.safeParse(json);
  if (!parsed.success) return null;
  const { owned: ownedBody, wishlist: wishBody } = parsed.data;
  const games = ownedBody.response.games;
  const visibility =
    games === undefined && ownedBody.response.game_count === undefined ? 'private' : 'public';

  let skipped = 0;
  const seen = new Set<number>();
  const owned: SteamOwnedGame[] = [];
  for (let i = 0; i < (games?.length ?? 0); i++) {
    if (i > 0 && i % VALIDATE_BATCH === 0) await yieldToMain();
    const game = steamOwnedGameSchema.safeParse(games?.[i]);
    if (!game.success || seen.has(game.data.appid)) {
      skipped++;
      continue;
    }
    seen.add(game.data.appid);
    owned.push({
      appid: game.data.appid,
      name: cleanSteamName(game.data.name),
      minutes: game.data.playtime_forever ?? 0,
      lastPlayedAt: unixToMs(game.data.rtime_last_played),
    });
  }

  let wishlist: SteamWish[] | null = null;
  if (wishBody !== null) {
    wishlist = [];
    const wished = new Set<number>();
    for (const raw of wishBody.response.items ?? []) {
      const item = steamWishlistItemSchema.safeParse(raw);
      if (!item.success || wished.has(item.data.appid)) {
        skipped++;
        continue;
      }
      wished.add(item.data.appid);
      wishlist.push({
        appid: item.data.appid,
        priority: item.data.priority ?? 0,
        addedAt: unixToMs(item.data.date_added),
      });
    }
  }
  return { visibility, owned, wishlist, skipped };
}
