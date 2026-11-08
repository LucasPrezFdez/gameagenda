// `GET /api/v1/resolve/<appid>` (M4; §5.2 y §7.3; CA4.5): el nombre de un juego que no está en el
// catálogo local, para el juego provisional apuntado con un enlace. Sin cookies (`credentials:
// 'omit'`: la micro-API no las necesita y así la petición no se puede asociar a la agenda), sin
// `Referer` y sin Zod: va en el *chunk* inicial, y la respuesta se comprueba a mano.
import { API_BASE, RESOLVE_NAME_MAX } from '@gameagenda/core/api';

export type ResolveResult =
  | { readonly kind: 'name'; readonly name: string }
  /** Steam no conoce ese `appid` (`name: null`): se queda provisional. */
  | { readonly kind: 'unknown' }
  /** Sin respuesta útil (sin red, límite, interruptor apagado, Steam caído): más tarde. */
  | { readonly kind: 'later'; readonly retryAfterMs: number };

export type ResolveName = (appid: number) => Promise<ResolveResult>;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Lo que se espera a la micro-API (que espera a Steam como mucho 2 s). */
export const RESOLVE_TIMEOUT_MS = 5000;
/** Tras un fallo, un minuto; con la micro-API apagada (503 `sync_disabled`), una hora. */
export const RETRY_AFTER_MS = 60_000;
export const RETRY_DISABLED_MS = 3_600_000;

/** El nombre (`null`: Steam no lo conoce), o `undefined` si la respuesta no es la esperada. */
function validName(json: unknown, appid: number): string | null | undefined {
  if (typeof json !== 'object' || json === null) return undefined;
  const { appid: got, name } = json as { appid?: unknown; name?: unknown };
  if (got !== appid) return undefined;
  if (name === null) return null;
  if (typeof name !== 'string') return undefined;
  const trimmed = name.trim();
  return trimmed === '' || trimmed.length > RESOLVE_NAME_MAX ? undefined : trimmed;
}

export function createResolveName(fetchImpl?: FetchLike): ResolveName {
  const doFetch: FetchLike = fetchImpl ?? ((input, init) => fetch(input, init));
  return async (appid) => {
    const init: RequestInit = {
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    };
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      init.signal = AbortSignal.timeout(RESOLVE_TIMEOUT_MS);
    }
    let response: Response;
    try {
      response = await doFetch(`${API_BASE}/resolve/${appid}`, init);
    } catch {
      return { kind: 'later', retryAfterMs: RETRY_AFTER_MS };
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      json = undefined;
    }
    if (response.ok) {
      const name = validName(json, appid);
      if (name === undefined) return { kind: 'later', retryAfterMs: RETRY_AFTER_MS };
      return name === null ? { kind: 'unknown' } : { kind: 'name', name };
    }
    const disabled = (json as { error?: unknown } | undefined)?.error === 'sync_disabled';
    return { kind: 'later', retryAfterMs: disabled ? RETRY_DISABLED_MS : RETRY_AFTER_MS };
  };
}
