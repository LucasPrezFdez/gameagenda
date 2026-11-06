// Credencial de dispositivo (§11.4): cookie `__Host-ga_device` `HttpOnly` `Secure` `SameSite=Lax`
// con 256 bits; D1 solo guarda su SHA-256. Va con el indicio `__Host-ga_sync=1`, sin secreto, que la
// app sí puede leer (ver `SYNC_HINT_COOKIE` en core).

import {
  DEVICE_COOKIE,
  DEVICE_COOKIE_MAX_AGE_S,
  type DeviceKind,
  SYNC_HINT_COOKIE,
} from '@gameagenda/core/api';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { newDeviceToken, sha256Hex } from './crypto.ts';
import type { AppEnv, DeviceAuth } from './env.ts';
import { apiError, iso } from './http.ts';

/** Una credencial de verdad tiene 43 caracteres: lo que sea mucho más largo ni se calcula. */
const MAX_TOKEN_LENGTH = 64;

export function setDeviceCookies(c: Context<AppEnv>, token: string): void {
  const common = { prefix: 'host', path: '/', secure: true, sameSite: 'Lax' } as const;
  setCookie(c, DEVICE_COOKIE, token, {
    ...common,
    httpOnly: true,
    maxAge: DEVICE_COOKIE_MAX_AGE_S,
  });
  setCookie(c, SYNC_HINT_COOKIE, '1', { ...common, maxAge: DEVICE_COOKIE_MAX_AGE_S });
}

export function clearDeviceCookies(c: Context<AppEnv>): void {
  const common = { prefix: 'host', path: '/', secure: true, sameSite: 'Lax' } as const;
  deleteCookie(c, DEVICE_COOKIE, { ...common, httpOnly: true });
  deleteCookie(c, SYNC_HINT_COOKIE, common);
}

function hasDeviceCookies(c: Context<AppEnv>): boolean {
  return (
    getCookie(c, DEVICE_COOKIE, 'host') !== undefined ||
    getCookie(c, SYNC_HINT_COOKIE, 'host') !== undefined
  );
}

/** El dispositivo `app` de la cookie, o `null` si no hay cookie o ya no vale. */
export async function readDevice(c: Context<AppEnv>): Promise<DeviceAuth | null> {
  const token = getCookie(c, DEVICE_COOKIE, 'host');
  if (token === undefined || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
  const row = await c.env.DB.prepare(
    "SELECT id, agenda_id, last_seen_at FROM device WHERE token_hash = ?1 AND kind = 'app'",
  )
    .bind(await sha256Hex(token))
    .first<{ id: string; agenda_id: string; last_seen_at: string }>();
  return row === null
    ? null
    : { deviceId: row.id, agendaId: row.agenda_id, token, lastSeenAt: row.last_seen_at };
}

/** Rutas con cookie: sin un dispositivo válido, 401 y fuera las cookies, para que la app lo sepa. */
export const requireDevice: MiddlewareHandler<AppEnv> = async (c, next) => {
  const device = await readDevice(c);
  if (device === null) {
    // Antes de crear la respuesta: `c.json()` copia las cabeceras que haya en ese momento.
    if (hasDeviceCookies(c)) clearDeviceCookies(c);
    return apiError(c, 'unauthorized');
  }
  c.set('device', device);
  return next();
};

/** Da de alta un dispositivo en la agenda y, si es de la app, le pone la cookie. */
export async function addDevice(
  c: Context<AppEnv>,
  agendaId: string,
  kind: DeviceKind,
  label: string,
  nowMs: number,
): Promise<{ deviceId: string; token: string }> {
  const deviceId = crypto.randomUUID();
  const token = newDeviceToken();
  const at = iso(nowMs);
  await c.env.DB.prepare(
    `INSERT INTO device (id, agenda_id, kind, label, token_hash, created_at, last_seen_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)`,
  )
    .bind(deviceId, agendaId, kind, label, await sha256Hex(token), at)
    .run();
  if (kind === 'app') setDeviceCookies(c, token);
  return { deviceId, token };
}
