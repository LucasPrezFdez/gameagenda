// Reglas de petición de la micro-API (§11.4): cabeceras propias (a lo que genera el *script* no le
// llega `_headers`), interruptor general, nada cambia por GET, JSON y `Origin` propio en lo demás,
// cuerpos con tamaño máximo y validados con Zod, y límites por IP en las rutas sin autenticar.

import { API_ERRORS, type ApiErrorCode } from '@gameagenda/core/api';
import type { Context, MiddlewareHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { sha256Hex } from './crypto.ts';
import type { AppEnv, RateLimit } from './env.ts';

/** Ruta del buzón del Atajo de iOS: no envía `Origin` y no usa la cookie, solo su *token* (§11.4). */
export const INBOX_PATH = '/api/v1/inbox';

/**
 * Lo que enseña el Atajo de iOS, que no tiene la app para traducir los códigos: toda respuesta de
 * `INBOX_PATH` lleva `message`, también las de error que salen antes de la ruta (el interruptor, el
 * tipo de contenido, el tamaño o un cuerpo que no vale).
 */
export const INBOX_MESSAGES: Readonly<Partial<Record<ApiErrorCode | 'queued', string>>> = {
  queued: 'Hecho. Lo apuntaremos en GameAgenda en cuanto se sincronice.',
  unauthorized:
    'Este atajo ya no vale. Crea un token nuevo en GameAgenda, en Ajustes › Sincronización.',
  invalid_link: 'Eso no es un enlace de un juego de Steam.',
  inbox_full:
    'Hay demasiados juegos esperando. Abre GameAgenda para que se apunten y vuelve a probar.',
  rate_limited: 'Demasiados envíos seguidos. Vuelve a probar dentro de un minuto.',
  sync_disabled: 'GameAgenda no puede apuntar juegos así ahora mismo. Vuelve a probar más tarde.',
  unsupported_media_type:
    'El atajo no está bien hecho: el cuerpo de la solicitud tiene que ser JSON. Revisa los pasos en Ajustes › Sincronización.',
  invalid_body:
    'El atajo no está bien hecho: el JSON tiene que llevar solo el campo url. Revisa los pasos en Ajustes › Sincronización.',
  payload_too_large: 'Lo que manda el atajo es demasiado largo: comparte solo el enlace del juego.',
  internal: 'Algo ha fallado en GameAgenda. Vuelve a probar dentro de un rato.',
};

const API_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
};

export function apiError(c: Context<AppEnv>, code: ApiErrorCode): Response {
  const message = c.req.path === INBOX_PATH ? INBOX_MESSAGES[code] : undefined;
  return c.json(
    message === undefined ? { error: code } : { error: code, message },
    API_ERRORS[code] as ContentfulStatusCode,
  );
}

/** Cabeceras de toda respuesta de `/api/*`, también la de un error. */
export const apiHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  for (const [name, value] of Object.entries(API_HEADERS)) c.res.headers.set(name, value);
};

/** Mientras `SYNC_ENABLED` no valga `'1'`, la micro-API no hace nada (CA4.7). */
export const killSwitch: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.env.SYNC_ENABLED !== '1') return apiError(c, 'sync_disabled');
  return next();
};

/**
 * Nada cambia por GET (las rutas GET no escriben); el resto exige `Origin` propio y
 * `Content-Type: application/json`. Con la cookie `SameSite=Lax`, eso cierra el paso a
 * peticiones de otros sitios. El buzón no comprueba `Origin`: solo acepta su *token*.
 */
export const requestRules: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method;
  if (method === 'GET' || method === 'HEAD') return next();
  if (c.req.path !== INBOX_PATH && c.req.header('Origin') !== new URL(c.req.url).origin) {
    return apiError(c, 'bad_origin');
  }
  if (!/^application\/json\s*(?:;|$)/i.test(c.req.header('Content-Type') ?? '')) {
    return apiError(c, 'unsupported_media_type');
  }
  return next();
};

/** Lo que necesita `parseBody` de un esquema de Zod. */
export interface Schema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

/**
 * Lee el cuerpo de una petición (o de una respuesta, la de Steam en `resolve`) sin pasar de
 * `maxBytes`, aunque no venga `Content-Length`: deja de leer en cuanto se pasa.
 */
export async function readCapped(
  message: Pick<Request, 'headers' | 'body'>,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const declared = Number(message.headers.get('Content-Length'));
  if (declared > maxBytes) return null;
  const body = message.body;
  if (body === null) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Cuerpo JSON validado, o la respuesta de error (413 o 400) que hay que devolver. */
export async function parseBody<T>(
  c: Context<AppEnv>,
  schema: Schema<T>,
  maxBytes: number,
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  const bytes = await readCapped(c.req.raw, maxBytes);
  if (bytes === null) return { ok: false, response: apiError(c, 'payload_too_large') };
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return { ok: false, response: apiError(c, 'invalid_body') };
  }
  const result = schema.safeParse(json);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, response: apiError(c, 'invalid_body') };
}

/**
 * Límite por IP de una ruta sin autenticar (§11.4). Al *binding* le llega el SHA-256 de la IP,
 * no la IP. Devuelve el 429 si se ha pasado, o `null`.
 */
export async function rateLimited(
  c: Context<AppEnv>,
  limiter: RateLimit,
): Promise<Response | null> {
  const ip = c.req.header('CF-Connecting-IP') ?? 'sin-ip';
  const { success } = await limiter.limit({ key: await sha256Hex(ip) });
  return success ? null : apiError(c, 'rate_limited');
}

/** Instante ISO 8601 UTC, como se guardan en D1. */
export function iso(ms: number): string {
  return new Date(ms).toISOString();
}
