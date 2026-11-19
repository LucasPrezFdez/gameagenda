// «Iniciar sesión con Steam» con OpenID 2.0 (§10.2 de prototipe.md; ADR-012): la URL a la que la app
// manda al usuario y la comprobación de la aserción con la que vuelve.
//
// `checkAssertion()` y `checkAuthentication()` portan `verifyLogin` de `steam-signin` 1.0.5
// (https://github.com/DoctorMcKay/node-steam-signin) a `fetch`, sin `nodejs_compat`, y le añaden lo
// que le falta: `return_to` idéntico al emitido (allí solo se compara el *host*), `claimed_id` con
// 17 cifras (allí, `\d+`), el `op_endpoint`, los parámetros repetidos, un tiempo de espera y el
// `fetch` inyectable de las pruebas. Su aviso de licencia:
//
//   The MIT License (MIT). Copyright (c) 2023 Alex Corn.
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this software
//   and associated documentation files (the "Software"), to deal in the Software without
//   restriction, including without limitation the rights to use, copy, modify, merge, publish,
//   distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
//   Software is furnished to do so, subject to the following conditions: The above copyright
//   notice and this permission notice shall be included in all copies or substantial portions of
//   the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
//   PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
//   LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
//   OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
//   IN THE SOFTWARE.

import { API_BASE } from '@gameagenda/core/api';
import type { SteamFetch } from './env.ts';
import { readCapped } from './http.ts';

/** La URL fija del proveedor: el login y `check_authentication`, nunca el `op_endpoint` recibido. */
export const STEAM_OPENID = 'https://steamcommunity.com/openid/login';
export const OPENID_NS = 'http://specs.openid.net/auth/2.0';
const IDENTIFIER_SELECT = 'http://specs.openid.net/auth/2.0/identifier_select';
export const CALLBACK_PATH = `${API_BASE}/steam/callback`;
/** Comprobación 4 de la §10.2: el SteamID64, de 17 cifras. */
const CLAIMED_ID = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})\/?$/;
/**
 * Comprobación 2: sin estos campos firmados, se podría cambiar la cuenta (`claimed_id`), colar el
 * login de otra web (`return_to`) o repetir uno bueno (`response_nonce`).
 */
export const REQUIRED_SIGNED = ['claimed_id', 'return_to', 'response_nonce'] as const;
/** Steam contesta `check_authentication` en ≈0,3 s. */
export const OPENID_TIMEOUT_MS = 5000;
/** La respuesta de `check_authentication` son dos líneas (`ns:` e `is_valid:`). */
const MAX_CHECK_BYTES = 4096;

/** La vuelta de Steam, con el ticket: tiene que volver idéntica en `openid.return_to`. */
export function steamReturnTo(origin: string, ticket: string): string {
  return `${origin}${CALLBACK_PATH}?t=${ticket}`;
}

/**
 * `checkid_setup` con `identifier_select`: Steam pregunta la cuenta y vuelve a `return_to`. `realm`
 * y `return_to` salen del origen de la petición (el túnel de las pruebas a mano tiene otro *host*,
 * y OpenID 2.0 exige el mismo esquema, *host* y puerto).
 */
export function steamLoginUrl(origin: string, ticket: string): string {
  const query = new URLSearchParams({
    'openid.ns': OPENID_NS,
    'openid.mode': 'checkid_setup',
    'openid.claimed_id': IDENTIFIER_SELECT,
    'openid.identity': IDENTIFIER_SELECT,
    'openid.realm': origin,
    'openid.return_to': steamReturnTo(origin, ticket),
  });
  return `${STEAM_OPENID}?${query}`;
}

export type AssertionCheck =
  | { readonly ok: true; readonly steamId: string }
  | { readonly ok: false; readonly reason: 'cancel' | 'invalid' };

/** Algún parámetro va dos veces: lo que se comprueba aquí y lo que lee Steam podrían no coincidir. */
export function hasRepeatedParams(query: URLSearchParams): boolean {
  const seen = new Set<string>();
  for (const name of query.keys()) {
    if (seen.has(name)) return true;
    seen.add(name);
  }
  return false;
}

/**
 * Lo que se comprueba antes de preguntar a Steam (comprobaciones 2, 3 y 4 de la §10.2): una
 * aserción que no pasa esto no llega a `check_authentication`. `query` no lleva parámetros
 * repetidos (`hasRepeatedParams`).
 */
export function checkAssertion(query: URLSearchParams, expectedReturnTo: string): AssertionCheck {
  const invalid = { ok: false, reason: 'invalid' } as const;
  const mode = query.get('openid.mode');
  if (mode === 'cancel') return { ok: false, reason: 'cancel' };
  if (mode !== 'id_res' || query.get('openid.ns') !== OPENID_NS) return invalid;
  if (query.get('openid.op_endpoint') !== STEAM_OPENID) return invalid;
  if (!query.has('openid.sig') || !query.has('openid.assoc_handle')) return invalid;
  const signed = (query.get('openid.signed') ?? '').split(',');
  if (!REQUIRED_SIGNED.every((field) => signed.includes(field))) return invalid;
  if (!signed.every((field) => query.has(`openid.${field}`))) return invalid;
  if (query.get('openid.return_to') !== expectedReturnTo) return invalid;
  const claimed = CLAIMED_ID.exec(query.get('openid.claimed_id') ?? '');
  if (claimed === null) return invalid;
  return { ok: true, steamId: claimed[1] as string };
}

/**
 * `check_authentication` (comprobación 1): por POST a la URL **fija** de Steam, nunca al
 * `op_endpoint` recibido, con todos los `openid.*` de la aserción y `openid.mode` cambiado. Vale
 * solo con una línea `is_valid:true`. `failed` si Steam no contesta (o no como se espera).
 */
export async function checkAuthentication(
  query: URLSearchParams,
  fetch: SteamFetch,
): Promise<'valid' | 'invalid' | 'failed'> {
  const body = new URLSearchParams();
  for (const [name, value] of query) if (name.startsWith('openid.')) body.append(name, value);
  body.set('openid.mode', 'check_authentication');
  try {
    const response = await fetch(STEAM_OPENID, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/plain' },
      body: body.toString(),
      signal: AbortSignal.timeout(OPENID_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return 'failed';
    }
    const bytes = await readCapped(response, MAX_CHECK_BYTES);
    if (bytes === null) return 'failed';
    const lines = new TextDecoder().decode(bytes).split(/\r?\n/);
    return lines.includes('is_valid:true') ? 'valid' : 'invalid';
  } catch {
    return 'failed';
  }
}
