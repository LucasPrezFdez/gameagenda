// Los logros de una cuenta de Steam, para `POST /api/v1/steam/achievements` (Fase 2, parte 3;
// §10.1 de prototipe.md; ADR-012): ¿tiene un juego todos sus logros (Platinado)? Solo con el pase
// de un login verificado (`steam-token.ts`).
//
// - `ISteamUserStats/GetPlayerAchievements/v1`, con la clave en `x-webapi-key`: la única que
//   sirve con clave. `IPlayerService/GetAchievementsProgress` (varios juegos por llamada) pide la
//   sesión del usuario (401), y `GetTopAchievementsForGames` no dice cuántos tiene (20-11-2026).
// - Un juego por llamada, `ACHIEVEMENTS_CONCURRENCY` a la vez. La app solo pregunta por los jugados
//   con `has_community_visible_stats` (en la prueba con una cuenta real, ninguno con logros iba sin
//   esa marca).
// - A la app solo le llega lo necesario: si los tiene todos (y la fecha del último), si no, si el
//   juego no tiene logros, si Steam no los enseña o si no ha contestado. Ni los nombres de los
//   logros ni cuántos.

import type { SteamAchievementsResult } from '@gameagenda/core/api';
import type { SteamFetch } from './env.ts';
import { readCapped } from './http.ts';

const ACHIEVEMENTS_API = 'https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/';
/** Llamadas a Steam a la vez: 40 en serie serían ≈12 s, y todas a la vez, un 429 seguro. */
export const ACHIEVEMENTS_CONCURRENCY = 8;
export const ACHIEVEMENTS_TIMEOUT_MS = 8000;
/** Un juego con 5 000 logros son ≈350 KB; leer más no tiene sentido. */
export const ACHIEVEMENTS_MAX_BYTES = 1024 * 1024;

export function achievementsUrl(steamId: string, appid: number): string {
  return `${ACHIEVEMENTS_API}?${new URLSearchParams({ steamid: steamId, appid: String(appid) })}`;
}

interface PlayerAchievement {
  achieved?: unknown;
  unlocktime?: unknown;
}

/** Lo que dice de un juego la respuesta de `GetPlayerAchievements` (ya leída). */
export function achievementsOf(
  appid: number,
  status: number,
  json: unknown,
): SteamAchievementsResult {
  const stats = (json as { playerstats?: { success?: unknown; achievements?: unknown } } | null)
    ?.playerstats;
  // Con «Detalles de juegos» privado, o un juego que Steam no enseña: 403 «Profile is not public»,
  // en JSON. Un 403 sin él (una clave revocada) no dice nada del juego.
  if (status === 403 && stats?.success === false) return { appid, result: 'hidden' };
  // Un juego sin estadísticas: 400 «Requested app has no stats».
  if (status === 400 && stats?.success === false) return { appid, result: 'none' };
  if (status !== 200 || stats?.success !== true) return { appid, result: 'unavailable' };
  // Con estadísticas pero sin logros, Steam no manda `achievements`.
  if (stats.achievements === undefined) return { appid, result: 'none' };
  if (!Array.isArray(stats.achievements)) return { appid, result: 'unavailable' };
  const list = stats.achievements as PlayerAchievement[];
  if (list.length === 0) return { appid, result: 'none' };
  let last = 0;
  for (const achievement of list) {
    if (achievement?.achieved !== 1) return { appid, result: 'incomplete' };
    const at = achievement.unlocktime;
    if (typeof at === 'number' && Number.isInteger(at) && at > last) last = at;
  }
  return { appid, result: 'complete', at: last === 0 ? null : last };
}

async function one(
  steamId: string,
  appid: number,
  key: string,
  fetch: SteamFetch,
): Promise<SteamAchievementsResult> {
  try {
    const response = await fetch(achievementsUrl(steamId, appid), {
      headers: { Accept: 'application/json', 'x-webapi-key': key },
      signal: AbortSignal.timeout(ACHIEVEMENTS_TIMEOUT_MS),
    });
    const type = response.headers.get('Content-Type') ?? '';
    if (!/^application\/json\s*(?:;|$)/i.test(type)) {
      await response.body?.cancel();
      return achievementsOf(appid, response.status, null);
    }
    const bytes = await readCapped(response, ACHIEVEMENTS_MAX_BYTES);
    if (bytes === null) return { appid, result: 'unavailable' };
    let json: unknown = null;
    try {
      json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      return { appid, result: 'unavailable' };
    }
    return achievementsOf(appid, response.status, json);
  } catch {
    return { appid, result: 'unavailable' };
  }
}

/** Los logros de `appids`, en su orden, con `ACHIEVEMENTS_CONCURRENCY` llamadas a la vez. */
export async function fetchAchievements(
  steamId: string,
  appids: readonly number[],
  key: string,
  fetch: SteamFetch,
): Promise<SteamAchievementsResult[]> {
  const out: SteamAchievementsResult[] = new Array(appids.length);
  let next = 0;
  const worker = async () => {
    while (next < appids.length) {
      const index = next++;
      out[index] = await one(steamId, appids[index] as number, key, fetch);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(ACHIEVEMENTS_CONCURRENCY, appids.length) }, worker),
  );
  return out;
}
