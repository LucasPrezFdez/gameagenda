// `GET /api/v1/resolve/<appid>` (§5.2 y §7.3; CA4.5): el nombre de un juego que no está en el
// catálogo local (recién publicado, o que el pipeline aún no ha recogido), para el juego
// provisional que se apuntó con un enlace. Pregunta a `IStoreBrowseService/GetItems/v1` de Steam,
// sin clave, en español y para España (y para EE. UU. si allí está bloqueado), y lo guarda en
// `resolve_cache` de D1: nombres públicos del catálogo, ningún dato de usuarios.
//
// - Sin credencial y con límite por IP (`RL_RESOLVE`). La app la llama sin cookies.
// - Nunca es un *proxy* abierto (§11.4): la URL de Steam sale del `appid` validado.
// - Un nombre vale 30 días en la caché, y «Steam no lo conoce» (200 con `name: null`), 1 día. Si
//   Steam no contesta, vale lo que haya en la caché, aunque sea viejo; sin nada, 502
//   `steam_unavailable`. Un `appid` mal formado da 404.
// - Es un GET que escribe en la caché: nada que cambie lo de un usuario (§11.4).

import {
  RESOLVE_MISS_TTL_MS,
  RESOLVE_NAME_MAX,
  RESOLVE_TTL_MS,
  steamItemsResponseSchema,
} from '@gameagenda/core/api';
import type { Context, Hono } from 'hono';
import type { AppEnv, Deps, SteamFetch } from '../env.ts';
import { apiError, iso, rateLimited } from '../http.ts';

const STEAM_API = 'https://api.steampowered.com/IStoreBrowseService/GetItems/v1/';
/** Steam suele contestar en ≈0,3 s; la app espera el nombre como mucho 1,5 s (CA4.5). */
export const STEAM_TIMEOUT_MS = 2000;
/** Una respuesta de un solo juego pesa ≈1 KB; lo que pase de esto no se lee. */
const MAX_STEAM_BYTES = 64 * 1024;
/** `appid` de 1 a 10 cifras sin ceros a la izquierda, como en `steam:<appid>`, y de 32 bits. */
const APPID = /^[1-9][0-9]{0,9}$/;
const MAX_APPID = 0xffff_ffff;

/** El nombre limpio: sin caracteres de control, con los espacios juntos y sin pasar del tope. */
export function cleanName(raw: string): string {
  const text = raw
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= RESOLVE_NAME_MAX) return text;
  const cut = text.slice(0, RESOLVE_NAME_MAX);
  const last = cut.charCodeAt(cut.length - 1);
  return (last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut).trimEnd();
}

export function steamUrl(appid: number, country: 'ES' | 'US'): string {
  const input = { ids: [{ appid }], context: { language: 'spanish', country_code: country } };
  return `${STEAM_API}?input_json=${encodeURIComponent(JSON.stringify(input))}`;
}

type Lookup =
  /** Lo conoce (`name`), no lo conoce (`null`) o está bloqueado en ese país. */
  { readonly name: string | null; readonly blocked: boolean } | 'failed';

async function askSteam(appid: number, country: 'ES' | 'US', fetch: SteamFetch): Promise<Lookup> {
  let text: string;
  try {
    const response = await fetch(steamUrl(appid, country), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(STEAM_TIMEOUT_MS),
    });
    if (!response.ok) return 'failed';
    text = await response.text();
  } catch {
    return 'failed';
  }
  if (text.length > MAX_STEAM_BYTES) return 'failed';
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return 'failed';
  }
  const parsed = steamItemsResponseSchema.safeParse(json);
  if (!parsed.success) return 'failed';
  const item = parsed.data.response.store_items[0];
  if (item === undefined) return { name: null, blocked: false };
  const name = item.success === 1 ? cleanName(item.name ?? '') : '';
  if (name !== '') return { name, blocked: false };
  return { name: null, blocked: item.unvailable_for_country_restriction === true };
}

/** El nombre en España o, si allí está bloqueado, en EE. UU.; `null` si Steam no lo conoce. */
async function steamName(appid: number, fetch: SteamFetch): Promise<string | null | 'failed'> {
  const es = await askSteam(appid, 'ES', fetch);
  if (es === 'failed' || es.name !== null || !es.blocked) return es === 'failed' ? es : es.name;
  const us = await askSteam(appid, 'US', fetch);
  return us === 'failed' ? us : us.name;
}

function answer(c: Context<AppEnv>, appid: number, name: string): Response {
  return c.json({ appid, name: name === '' ? null : name });
}

export function resolveRoutes(api: Hono<AppEnv>, deps: Deps): void {
  api.get('/resolve/:appid', async (c) => {
    const raw = c.req.param('appid');
    if (!APPID.test(raw) || Number(raw) > MAX_APPID) return apiError(c, 'not_found');
    const limited = await rateLimited(c, c.env.RL_RESOLVE);
    if (limited) return limited;
    const appid = Number(raw);
    const db = c.env.DB;
    const now = deps.now();

    const cached = await db
      .prepare('SELECT name, fetched_at FROM resolve_cache WHERE appid = ?1')
      .bind(appid)
      .first<{ name: string; fetched_at: string }>();
    if (cached !== null) {
      const age = now - Date.parse(cached.fetched_at);
      const ttl = cached.name === '' ? RESOLVE_MISS_TTL_MS : RESOLVE_TTL_MS;
      if (age >= 0 && age < ttl) return answer(c, appid, cached.name);
    }

    const name = await steamName(appid, deps.steamFetch ?? ((url, init) => fetch(url, init)));
    if (name === 'failed') {
      return cached === null ? apiError(c, 'steam_unavailable') : answer(c, appid, cached.name);
    }
    await db
      .prepare(
        `INSERT INTO resolve_cache (appid, name, fetched_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (appid) DO UPDATE SET name = excluded.name, fetched_at = excluded.fetched_at`,
      )
      .bind(appid, name ?? '', iso(now))
      .run();
    return answer(c, appid, name ?? '');
  });
}
