import { describe, expect, it } from 'vitest';
import { createApiClient, type FetchLike } from './api-client.ts';
import { SyncError } from './types.ts';

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  };
  return { fetch, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(SyncError);
    return (error as SyncError).code;
  }
  throw new Error('no ha fallado');
}

describe('cliente de la micro-API', () => {
  it('manda JSON al mismo origen, con la cookie, y valida la respuesta', async () => {
    const { fetch, calls } = fakeFetch(() => json({ deviceId: 'd', recoveryCode: 'XXXX' }, 201));
    const api = createApiClient({ fetch });
    expect(await api.createAgenda({ minAge: 14, label: 'Chrome en Windows' })).toEqual({
      deviceId: 'd',
      recoveryCode: 'XXXX',
    });
    const [call] = calls;
    expect(call?.url).toBe('/api/v1/agenda');
    expect(call?.init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(call?.init.referrerPolicy).toBe('no-referrer');
    expect(JSON.parse(String(call?.init.body))).toEqual({
      ageConfirmed: true,
      minAge: 14,
      label: 'Chrome en Windows',
    });
  });

  it('las rutas sin datos llevan {} y la lista es un GET sin cuerpo', async () => {
    const { fetch, calls } = fakeFetch(({ url }) => {
      if (url.endsWith('/pairing')) return json({ code: 'C', expiresAt: 'E' }, 201);
      if (url.endsWith('/recovery')) return json({ recoveryCode: 'R' }, 201);
      if (url.endsWith('/devices')) return json({ devices: [] });
      return json({ ok: true });
    });
    const api = createApiClient({ fetch });
    await api.createPairing();
    await api.createRecovery();
    await api.devices();
    await api.revokeDevice('a/b c');
    await api.deleteAgenda();
    expect(calls.map((c) => [c.init.method, c.url, c.init.body ?? null])).toEqual([
      ['POST', '/api/v1/pairing', '{}'],
      ['POST', '/api/v1/recovery', '{}'],
      ['GET', '/api/v1/devices', null],
      ['POST', '/api/v1/devices/a%2Fb%20c/revoke', '{}'],
      ['POST', '/api/v1/agenda/delete', '{"confirm":true}'],
    ]);
    // Ninguna manda en `Referer` la ruta ni la consulta de la página (lo buscado, los filtros).
    expect(calls.map((c) => c.init.referrerPolicy)).toEqual(Array(5).fill('no-referrer'));
  });

  it('sync lleva el cursor, el purgedSeq y las operaciones', async () => {
    const response = {
      cursor: 4,
      purgedSeq: 0,
      epoch: 'a1b2c3d4e5f60718',
      reset: false,
      more: false,
      serverTime: 1,
      changes: [
        {
          entryId: 'steam:1',
          field: 'status',
          value: 'playing',
          hlc: '1793178900000-0000-k3x9p2qa',
        },
      ],
      accepted: ['x'],
      rejected: [],
      inbox: [],
      // Un campo nuevo del servidor no rompe a un cliente antiguo.
      later: [],
    };
    const { fetch, calls } = fakeFetch(() => json(response));
    const api = createApiClient({ fetch });
    const out = await api.sync({ cursor: 3, purgedSeq: 0, ops: [] });
    expect(out.changes).toHaveLength(1);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ cursor: 3, purgedSeq: 0, ops: [] });
  });

  it('errores tipados: los de la micro-API, la red y las respuestas raras', async () => {
    const respond: Array<() => Response> = [
      () => json({ error: 'invalid_code' }, 400),
      () => json({ error: 'busy' }, 503),
      () => json({ error: 'otra cosa' }, 500),
      () => new Response('<html>', { status: 502 }),
      () => json({ deviceId: 5 }, 201),
      () => new Response('no es JSON', { status: 200 }),
    ];
    let i = 0;
    const { fetch } = fakeFetch(() => (respond[i++] as () => Response)());
    const api = createApiClient({ fetch });
    const redeem = () => api.redeemPairing({ code: 'X', label: 'L' });
    expect(await codeOf(redeem())).toBe('invalid_code');
    expect(await codeOf(redeem())).toBe('busy');
    expect(await codeOf(redeem())).toBe('bad_response');
    expect(await codeOf(redeem())).toBe('bad_response');
    expect(await codeOf(redeem())).toBe('bad_response');
    expect(await codeOf(redeem())).toBe('bad_response');
    const offline = createApiClient({
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    expect(await codeOf(offline.devices())).toBe('network');
  });

  it('guarda el estado HTTP en el error', async () => {
    const { fetch } = fakeFetch(() => json({ error: 'rate_limited' }, 429));
    const api = createApiClient({ fetch });
    const error = await api.redeemRecovery({ code: 'X', label: 'L' }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'rate_limited', status: 429 });
  });
});
