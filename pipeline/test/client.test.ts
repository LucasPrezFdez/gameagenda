// Política HTTP de la §4.7 con reloj falso: ritmo, 429, 5xx, 400, 403, X-eresult, contrato y
// modo *fixtures*, sin esperas ni red.

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  type CachedResponse,
  MAX_429_IN_A_ROW,
  type ResponseCache,
  SteamClient,
  SteamError,
  type Transport,
  TransportError,
} from '../steam/client.ts';
import { queryUrl } from '../steam/endpoints.ts';
import { queryResponseSchema } from '../steam/schemas.ts';
import { fixtureTransport } from '../steam/transports.ts';
import { fakeRuntime, scripted, syntheticFixtures } from './helpers.ts';

const ok = z.object({ ok: z.literal(true) });
const OK = { status: 200, body: '{"ok":true}' };
const URL_A = 'https://api.steampowered.com/IStoreQueryService/Query/v1/?input_json=a';
const URL_LIST = 'https://api.steampowered.com/IStoreService/GetAppList/v1/?include_games=true';

function client(
  transport: Transport,
  extra: Partial<ConstructorParameters<typeof SteamClient>[0]> = {},
) {
  const rt = fakeRuntime();
  return { c: new SteamClient({ transport, ...rt, key: null, ...extra }), rt };
}

/** Diferencias entre instantes consecutivos. */
const gaps = (xs: readonly number[]): number[] => xs.slice(1).map((x, i) => x - (xs[i] ?? 0));

async function failure(p: Promise<unknown>): Promise<SteamError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof SteamError) return e;
    throw e;
  }
  throw new Error('no falló');
}

describe('ritmo', () => {
  it('una petición cada 3 s, en un único worker', async () => {
    const rt = fakeRuntime();
    const starts: number[] = [];
    let inflight = 0;
    let maxInflight = 0;
    const transport: Transport = async () => {
      starts.push(rt.now());
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      await Promise.resolve();
      inflight--;
      return { status: 200, header: () => null, body: '{"ok":true}', wireBytes: 0 };
    };
    const c = new SteamClient({ transport, ...rt, key: null });
    await Promise.all([c.get(URL_A, ok, 'a'), c.get(URL_A, ok, 'b'), c.get(URL_A, ok, 'c')]);
    expect(gaps(starts)).toEqual([3000, 3000]);
    expect(maxInflight).toBe(1);
  });

  it('nunca más de 0,4/s aunque se pida otro intervalo', async () => {
    const { transport } = scripted([OK]);
    const rt = fakeRuntime();
    const c = new SteamClient({ transport, ...rt, key: null, intervalMs: 500 });
    await c.get(URL_A, ok, 'a');
    await c.get(URL_A, ok, 'b');
    expect(rt.sleeps).toEqual([2500]);
  });

  it('gzip, tiempo máximo y la clave solo en la cabecera y solo para GetAppList', async () => {
    const { transport, calls } = scripted([OK]);
    const { c } = client(transport, { key: 'CLAVE-DE-PRUEBA', timeoutMs: 1234 });
    await c.get(URL_LIST, ok, 'a');
    await c.get(URL_A, ok, 'b');
    expect(calls[0]?.headers['Accept-Encoding']).toBe('gzip');
    expect(calls[0]?.headers['x-webapi-key']).toBe('CLAVE-DE-PRUEBA');
    expect(calls[0]?.timeoutMs).toBe(1234);
    expect(calls[0]?.url).not.toContain('CLAVE');
    // Query (y GetItems) van sin clave (§4.4; CA2.1: ≤10 llamadas con clave).
    expect(calls[1]?.headers).not.toHaveProperty('x-webapi-key');
    expect(c.records.map((r) => r.keyed)).toEqual([true, false]);
    const sinClave = scripted([OK]);
    await client(sinClave.transport).c.get(URL_LIST, ok, 'a');
    expect(sinClave.calls[0]?.headers).not.toHaveProperty('x-webapi-key');
  });
});

describe('429', () => {
  it('respeta Retry-After (fixture sintético) y sigue', async () => {
    const { c, rt } = client(fixtureTransport(syntheticFixtures()));
    const r = await c.get(queryUrl(990000, 1000), queryResponseSchema, 'q');
    expect(r.response.store_items).toHaveLength(2);
    expect(rt.sleeps).toEqual([120_000]);
  });

  it('backoff exponencial de 60 s a 15 min y aborta tras 5 seguidos (sin Retry-After)', async () => {
    const fx = syntheticFixtures();
    let calls = 0;
    const t = fixtureTransport(fx);
    const { c, rt } = client(async (req) => {
      calls++;
      return t(req);
    });
    const e = await failure(c.get(queryUrl(991000, 1000), queryResponseSchema, 'q'));
    expect(e.kind).toBe('rate-limited');
    expect(calls).toBe(MAX_429_IN_A_ROW);
    // 60 s · 2^(n−1) con +12,5 % de jitter (azar 0,5), en pausa global.
    expect(rt.sleeps).toEqual([67_500, 135_000, 270_000, 540_000]);
  });

  it('la pausa es global y el contador se reinicia tras una respuesta correcta', async () => {
    const { transport, calls } = scripted([{ status: 429 }, OK, { status: 429 }, OK]);
    const rt = fakeRuntime();
    const starts: number[] = [];
    const c = new SteamClient({
      transport: (req) => {
        starts.push(rt.now());
        return transport(req);
      },
      ...rt,
      key: null,
    });
    await c.get(URL_A, ok, 'a');
    await c.get(URL_A, ok, 'b');
    expect(calls).toHaveLength(4);
    expect(gaps(starts)[0]).toBe(67_500);
    // El segundo 429 vuelve a ser el primero de su racha.
    expect(gaps(starts)[2]).toBe(67_500);
  });

  it('X-eresult 84 cuenta como un 429', async () => {
    const { transport } = scripted([{ status: 200, headers: { 'X-eresult': '84' }, body: '' }, OK]);
    const { c, rt } = client(transport);
    await c.get(URL_A, ok, 'a');
    expect(rt.sleeps).toEqual([67_500]);
  });

  it('un Retry-After de más de 15 min aborta', async () => {
    const { transport } = scripted([{ status: 429, headers: { 'Retry-After': '3600' } }]);
    const e = await failure(client(transport).c.get(URL_A, ok, 'a'));
    expect(e.kind).toBe('rate-limited');
  });
});

describe('5xx, tiempo agotado y errores sin reintento', () => {
  it('reintenta los 5xx con 2 y 4 s + jitter (fixture sintético)', async () => {
    const { c, rt } = client(fixtureTransport(syntheticFixtures()));
    const r = await c.get(queryUrl(992000, 1000), queryResponseSchema, 'q');
    expect(r.response.store_items[0]?.appid).toBe(9920001);
    // Tras los 2,5 s de espera, el ritmo de 3 s entre peticiones añade 0,5 s.
    expect(rt.sleeps).toEqual([2500, 500, 4500]);
  });

  it('tras 5 reintentos (2/4/8/16/32 s) falla la etapa', async () => {
    const { transport, calls } = scripted([{ status: 503 }]);
    const { c, rt } = client(transport);
    const e = await failure(c.get(URL_A, ok, 'a'));
    expect(e.kind).toBe('server');
    expect(calls).toHaveLength(6);
    expect(rt.sleeps.filter((s) => s !== 3000 && s > 1000)).toEqual([
      2500, 4500, 8500, 16_500, 32_500,
    ]);
  });

  it('el tiempo agotado se reintenta como un 5xx', async () => {
    const { transport, calls } = scripted([new TransportError('lento', true), OK]);
    await client(transport).c.get(URL_A, ok, 'a');
    expect(calls).toHaveLength(2);
  });

  it.each([
    [400, 'bad-request'],
    [404, 'http'],
  ])('HTTP %i no se reintenta', async (status, kind) => {
    const { transport, calls } = scripted([{ status }]);
    const e = await failure(client(transport).c.get(URL_A, ok, 'a'));
    expect(e.kind).toBe(kind);
    expect(calls).toHaveLength(1);
  });

  it('403 con clave para (clave revocada); sin clave, el endpoint pide clave', async () => {
    const a = scripted([{ status: 403 }]);
    expect((await failure(client(a.transport, { key: 'K' }).c.get(URL_LIST, ok, 'a'))).kind).toBe(
      'key-rejected',
    );
    const b = scripted([{ status: 403 }]);
    expect((await failure(client(b.transport).c.get(URL_A, ok, 'a'))).kind).toBe('forbidden');
    expect(a.calls).toHaveLength(1);
    // Query va sin clave aunque el cliente la tenga: su 403 es que el endpoint la pide.
    const c = scripted([{ status: 403 }]);
    expect((await failure(client(c.transport, { key: 'K' }).c.get(URL_A, ok, 'a'))).kind).toBe(
      'forbidden',
    );
  });

  it('X-eresult distinto de 1 falla', async () => {
    const { transport } = scripted([
      { status: 200, headers: { 'X-eresult': '2' }, body: '{"ok":true}' },
    ]);
    expect((await failure(client(transport).c.get(URL_A, ok, 'a'))).kind).toBe('eresult');
  });
});

describe('contrato y fixtures', () => {
  it('JSON roto y contrato roto fallan la etapa (fixtures sintéticos)', async () => {
    const { c } = client(fixtureTransport(syntheticFixtures()));
    const broken = await failure(c.get(queryUrl(993000, 1000), queryResponseSchema, 'q'));
    expect(broken.kind).toBe('contract');
    const noAppid = await failure(c.get(queryUrl(994000, 1000), queryResponseSchema, 'q'));
    expect(noAppid.kind).toBe('contract');
    expect(noAppid.message).toContain('appid');
  });

  it('STEAM_MODE=fixtures: una petición sin fixture falla sin reintentos ni red', async () => {
    const { c, rt } = client(fixtureTransport(syntheticFixtures()));
    const e = await failure(c.get(queryUrl(123, 1000), queryResponseSchema, 'q'));
    expect(e.kind).toBe('missing-fixture');
    expect(rt.sleeps).toEqual([]);
  });

  it('con la caché de páginas crudas no sale a la red; sin red, falla si falta', async () => {
    const stored = new Map<string, CachedResponse>([
      ['a', { body: '{"ok":true}', wireBytes: 7, ms: 9 }],
    ]);
    const cache: ResponseCache = {
      get: (name) => stored.get(name) ?? null,
      put: (name, _url, r) => stored.set(name, r),
    };
    const { transport, calls } = scripted([OK]);
    const { c } = client(transport, { cache, offline: true });
    await c.get(URL_A, ok, 'a');
    expect(calls).toHaveLength(0);
    expect(c.records[0]).toMatchObject({ cached: true, wireBytes: 7, ms: 9 });
    expect((await failure(c.get(URL_A, ok, 'b'))).kind).toBe('missing-fixture');
    // En línea, lo que llega se guarda.
    const live = client(transport, { cache });
    await live.c.get(URL_A, ok, 'c');
    expect(stored.has('c')).toBe(true);
  });
});
