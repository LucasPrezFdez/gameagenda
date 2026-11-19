// Apoyo de las pruebas de la importación de Steam (ADR-012): el verificador y el `challenge` como
// los hace la app, y un Steam OpenID falso que firma sus aserciones (`fixtures/steam/openid/`) y
// contesta `check_authentication` como el de verdad: recalcula la firma de los campos de
// `openid.signed` y dice `is_valid:true` solo si coincide.

import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sha256Base64url, sha256Hex } from '../crypto.ts';
import type { Client, Harness } from './harness.ts';

const FIXTURES = new URL('../../../../fixtures/steam/openid/', import.meta.url);
const ID_RES = JSON.parse(readFileSync(new URL('id-res.json', FIXTURES), 'utf8')) as Record<
  string,
  string
>;
const CHECK_VALID = readFileSync(new URL('check-authentication-valid.txt', FIXTURES), 'utf8');
const CHECK_INVALID = readFileSync(new URL('check-authentication-invalid.txt', FIXTURES), 'utf8');

/** Un SteamID64 inventado (cuenta individual del universo público), nunca uno real. */
export const STEAM_ID = '76561198000000042';
export const OTHER_STEAM_ID = '76561198000000777';

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

/** Un verificador aleatorio de 256 bits y su `challenge` (`S256`), como los genera la app. */
export async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  return { verifier, challenge: await sha256Base64url(verifier) };
}

export interface AssertionOptions {
  steamId?: string;
  /** La lista de `openid.signed` (por defecto, la de Steam): lo que cubre la firma. */
  signed?: readonly string[];
  /** Campos que pone Steam antes de firmar (p. ej., otro `claimed_id` u otro `op_endpoint`). */
  fields?: Readonly<Record<string, string>>;
}

export class FakeSteamOpenId {
  private readonly key = randomBytes(32);
  /** Los cuerpos de cada `check_authentication` recibido. */
  readonly checks: URLSearchParams[] = [];
  fail: 'network' | 'status' | null = null;

  /** Una vuelta de Steam (`id_res`) como la de `id-res.json`, firmada por este Steam. */
  assertion(returnTo: string, options: AssertionOptions = {}): URLSearchParams {
    const steamId = options.steamId ?? STEAM_ID;
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(ID_RES)) {
      params.set(name, value.replace('{steamId}', steamId).replace('{returnTo}', returnTo));
    }
    if (options.signed !== undefined) params.set('openid.signed', options.signed.join(','));
    for (const [name, value] of Object.entries(options.fields ?? {})) params.set(name, value);
    params.set('openid.sig', this.sign(params));
    return params;
  }

  /** La firma de OpenID 2.0: HMAC de los campos firmados en forma clave-valor. */
  private sign(params: URLSearchParams): string {
    const signed = (params.get('openid.signed') ?? '').split(',');
    const form = signed
      .map((field) => `${field}:${params.get(`openid.${field}`) ?? ''}\n`)
      .join('');
    return createHmac('sha256', this.key).update(form).digest('base64');
  }

  /** `check_authentication`: `is_valid:true` solo si la firma es de este Steam. */
  check(body: URLSearchParams): Response {
    this.checks.push(body);
    if (this.fail === 'network') throw new TypeError('fetch failed');
    if (this.fail === 'status') return new Response('Bad gateway', { status: 502 });
    const valid =
      body.get('openid.mode') === 'check_authentication' &&
      body.get('openid.sig') === this.sign(body);
    return new Response(valid ? CHECK_VALID : CHECK_INVALID, {
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    });
  }
}

/** Empieza un login como lo haría la app: el ticket, su verificador y la vuelta que espera. */
export async function begin(client: Client, base?: string) {
  const { verifier, challenge } = await pkce();
  const response = await client.post(
    '/api/v1/steam/start',
    { challenge },
    base === undefined ? {} : { base },
  );
  if (response.status !== 201) throw new Error(`start: ${response.status}`);
  const ticket = response.json.ticket as string;
  const returnTo = new URL(response.json.url).searchParams.get('openid.return_to') ?? '';
  return { ticket, verifier, challenge, returnTo };
}

/** La vuelta de Steam: `return_to` (con el ticket) y la aserción detrás, como hace Steam. */
export function callback(
  client: Client,
  ticket: string,
  assertion: URLSearchParams,
  base?: string,
) {
  return client.get(
    `/api/v1/steam/callback?t=${ticket}&${assertion}`,
    base === undefined ? {} : { base },
  );
}

/** El SteamID64 del ticket en D1: `null` sin login, `undefined` si no está. */
export async function steamIdOf(h: Harness, ticket: string): Promise<string | null | undefined> {
  const hash = await sha256Hex(ticket);
  return h.db.rows<{ steam_id: string | null }>(
    `SELECT steam_id FROM steam_ticket WHERE ticket_hash = '${hash}'`,
  )[0]?.steam_id;
}

/** El POST de `check_authentication` que haría la micro-API, para preguntar al Steam falso. */
export function checkRequest(assertion: URLSearchParams): RequestInit {
  const body = new URLSearchParams(assertion);
  body.set('openid.mode', 'check_authentication');
  return { method: 'POST', body: body.toString() };
}

const WEBAPI_FIXTURES = new URL('../../../../fixtures/steam/webapi/', import.meta.url);
const webapiFixture = (name: string) => readFileSync(new URL(name, WEBAPI_FIXTURES), 'utf8');
export const OWNED_FIXTURE = webapiFixture('get-owned-games.json');
export const OWNED_PRIVATE_FIXTURE = webapiFixture('get-owned-games-private.json');
export const OWNED_EMPTY_FIXTURE = webapiFixture('get-owned-games-empty.json');
export const WISHLIST_FIXTURE = webapiFixture('get-wishlist.json');
export const WISHLIST_PRIVATE_FIXTURE = webapiFixture('get-wishlist-private.json');

/** El tope de `redeem` en las pruebas (en producción, `STEAM_IMPORT_MAX_BYTES`, 16 MiB). */
export const TEST_IMPORT_MAX_BYTES = 1024 * 1024;

/** Una clave inventada para las pruebas (32 cifras hexadecimales, como las de Steam). */
export const TEST_STEAM_KEY = '0123456789ABCDEF0123456789ABCDEF';
export const OWNED_API_PREFIX = 'https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?';
export const WISHLIST_API_PREFIX = 'https://api.steampowered.com/IWishlistService/GetWishlist/v1/?';

export type WebApiFail =
  | 'network'
  | 'status'
  | 'unauthorized'
  | 'rate_limited'
  | 'html'
  | 'garbage'
  | 'huge';

/** Un cuerpo en trozos de 16 KiB, sin `Content-Length`, como llega por la red. */
export function chunked(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.subarray(offset, offset + 16 * 1024));
      offset += 16 * 1024;
    },
  });
}

/** `bytes` bytes de espacios, en trozos de 1 MiB que se generan al leerlos. */
function endless(bytes: number): ReadableStream<Uint8Array> {
  const chunk = new Uint8Array(1024 * 1024).fill(0x20);
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= bytes) controller.close();
      else {
        controller.enqueue(chunk);
        sent += chunk.byteLength;
      }
    },
  });
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

/** La Web API de Steam falsa: `GetOwnedGames` y `GetWishlist`, con lo que digan sus campos. */
export class FakeSteamWebApi {
  owned = OWNED_FIXTURE;
  wishlist = WISHLIST_FIXTURE;
  ownedFail: WebApiFail | null = null;
  wishlistFail: WebApiFail | null = null;
  /** Cada petición, con sus cabeceras (para ver por dónde va la clave). */
  readonly requests: { url: string; headers: Headers }[] = [];

  async fetch(url: string, init: RequestInit): Promise<Response> {
    this.requests.push({ url, headers: new Headers(init.headers) });
    const owned = url.startsWith(OWNED_API_PREFIX);
    const fail = owned ? this.ownedFail : this.wishlistFail;
    if (fail === 'network') throw new TypeError('fetch failed');
    if (fail === 'status') return new Response('Internal Server Error', { status: 500 });
    if (fail === 'unauthorized') {
      return new Response('<html><body>Forbidden</body></html>', {
        status: 403,
        headers: { 'Content-Type': 'text/html' },
      });
    }
    if (fail === 'rate_limited') return new Response('Too Many Requests', { status: 429 });
    if (fail === 'html') {
      return new Response('<html><body>Steam</body></html>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    if (fail === 'garbage')
      return new Response(chunked('{"response":{"items":['), { headers: JSON_HEADERS });
    // El doble del tope de las pruebas: también pasa del de la lista de deseados (1 MiB).
    if (fail === 'huge') {
      return new Response(endless(2 * TEST_IMPORT_MAX_BYTES), { headers: JSON_HEADERS });
    }
    return new Response(chunked(owned ? this.owned : this.wishlist), { headers: JSON_HEADERS });
  }
}

/**
 * Una biblioteca de `games` juegos como la de `GetOwnedGames` con `include_appinfo`, con los campos
 * de `get-owned-games.json` (con 5 000, ≈1,7 MB). Siempre la misma para el mismo número.
 */
export function bigLibrary(games: number): string {
  let seed = 42;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const words = ['Shadow', 'Legends', 'of', 'the', 'Fallen', 'Kingdom', 'Ñandú', 'Racing'];
  const list = [];
  for (let i = 0; i < games; i++) {
    const played = random() < 0.6;
    const minutes = played ? Math.floor(random() * 20000) : 0;
    const name = Array.from({ length: 2 + Math.floor(random() * 5) }, () => {
      return words[Math.floor(random() * words.length)];
    }).join(' ');
    list.push({
      appid: 10 + i * 37,
      name,
      playtime_forever: minutes,
      img_icon_url: Math.floor(random() * 2 ** 52)
        .toString(16)
        .padStart(40, '0'),
      has_community_visible_stats: random() < 0.7,
      playtime_windows_forever: minutes,
      playtime_mac_forever: 0,
      playtime_linux_forever: 0,
      playtime_deck_forever: 0,
      rtime_last_played: played ? 1500000000 + Math.floor(random() * 290000000) : 0,
      ...(random() < 0.3 ? { content_descriptorids: [2, 5] } : {}),
      playtime_disconnected: 0,
    });
  }
  return JSON.stringify({ response: { game_count: games, games: list } });
}
