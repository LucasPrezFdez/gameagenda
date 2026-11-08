// Cliente de `resolve` (M4; CA4.5): la petición, sin cookies ni `Referer`, y cada respuesta.
import { describe, expect, it } from 'vitest';
import {
  createResolveName,
  type FetchLike,
  RETRY_AFTER_MS,
  RETRY_DISABLED_MS,
} from './resolve-client.ts';

function fetchReturning(make: () => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return make();
  };
  return { fetch, calls };
}

describe('createResolveName', () => {
  it('pide `/api/v1/resolve/<appid>` sin cookies, sin caché y sin `Referer`', async () => {
    const { fetch, calls } = fetchReturning(() =>
      Response.json({ appid: 4000001, name: '  Juego Nuevo ' }),
    );
    const resolve = createResolveName(fetch);
    expect(await resolve(4000001)).toEqual({ kind: 'name', name: 'Juego Nuevo' });
    expect(calls[0]?.url).toBe('/api/v1/resolve/4000001');
    expect(calls[0]?.init).toMatchObject({
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  });

  it('`name: null`: Steam no lo conoce; lo demás, más tarde', async () => {
    const cases: Array<[() => Response | Promise<Response>, unknown]> = [
      [() => Response.json({ appid: 7, name: null }), { kind: 'unknown' }],
      // Una micro-API sin la ruta (un Worker anterior), como un fallo.
      [
        () => Response.json({ error: 'not_found' }, { status: 404 }),
        { kind: 'later', retryAfterMs: RETRY_AFTER_MS, scope: 'all' },
      ],
      [
        () => Response.json({ error: 'sync_disabled' }, { status: 503 }),
        { kind: 'later', retryAfterMs: RETRY_DISABLED_MS, scope: 'all' },
      ],
      [
        () => Response.json({ error: 'rate_limited' }, { status: 429 }),
        { kind: 'later', retryAfterMs: RETRY_AFTER_MS, scope: 'all' },
      ],
      // Steam no ha contestado bien por este juego: espera él solo.
      [
        () => Response.json({ error: 'steam_unavailable' }, { status: 502 }),
        { kind: 'later', retryAfterMs: RETRY_AFTER_MS, scope: 'one' },
      ],
      // El *fallback* de la SPA (sin micro-API), otro `appid` o un nombre vacío.
      [
        () => new Response('<!doctype html>'),
        { kind: 'later', retryAfterMs: RETRY_AFTER_MS, scope: 'all' },
      ],
      [
        () => Response.json({ appid: 1, name: 'Otro' }),
        { kind: 'later', retryAfterMs: RETRY_AFTER_MS, scope: 'all' },
      ],
      [
        () => Response.json({ appid: 7, name: '  ' }),
        { kind: 'later', retryAfterMs: RETRY_AFTER_MS, scope: 'all' },
      ],
      [
        () => Promise.reject(new TypeError('Failed to fetch')),
        { kind: 'later', retryAfterMs: RETRY_AFTER_MS, scope: 'all' },
      ],
    ];
    for (const [make, expected] of cases) {
      const { fetch } = fetchReturning(make);
      expect(await createResolveName(fetch)(7)).toEqual(expected);
    }
  });
});
