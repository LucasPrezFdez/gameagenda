// «Iniciar sesión con Steam» con OpenID 2.0 (§10.2 de prototipe.md; ADR-012): la URL a la que la app
// manda al usuario, con `realm` y `return_to` sacados del origen de la petición (el túnel de las
// pruebas a mano tiene otro *host*, y OpenID 2.0 exige el mismo esquema, *host* y puerto).

import { API_BASE } from '@gameagenda/core/api';

/** La URL fija del proveedor: el login y `check_authentication`, nunca el `op_endpoint` recibido. */
export const STEAM_OPENID = 'https://steamcommunity.com/openid/login';
export const OPENID_NS = 'http://specs.openid.net/auth/2.0';
const IDENTIFIER_SELECT = 'http://specs.openid.net/auth/2.0/identifier_select';
export const CALLBACK_PATH = `${API_BASE}/steam/callback`;

/** La vuelta de Steam, con el ticket: tiene que volver idéntica en `openid.return_to`. */
export function steamReturnTo(origin: string, ticket: string): string {
  return `${origin}${CALLBACK_PATH}?t=${ticket}`;
}

/** `checkid_setup` con `identifier_select`: Steam pregunta la cuenta y vuelve a `return_to`. */
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
