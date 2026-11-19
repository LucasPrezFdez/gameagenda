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
