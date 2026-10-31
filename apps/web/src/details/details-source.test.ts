import { detailShardOf } from '@gameagenda/core/catalog-format';
import { describe, expect, it } from 'vitest';
import { MemoryCacheStorage } from '../search-worker/test-helpers.ts';
import { createDetailsSource, DETAILS_CACHE, type ShardResult } from './details-source.ts';
import { detailsServer, gameDetails, publishDetails } from './test-helpers.ts';

const BASE = 'http://127.0.0.1/catalog-dev/';

// 36 y 100 comparten *shard* (156); 730 va en el 765 y 570 en el 911.
const GAMES = {
  36: gameDetails(36),
  100: gameDetails(100),
  730: gameDetails(730),
  570: gameDetails(570),
};

function setup(caches = new MemoryCacheStorage()) {
  const server = detailsServer(BASE);
  const source = createDetailsSource({
    fetch: server.fetch,
    caches: caches.asCacheStorage(),
    subtle: crypto.subtle,
    baseUrl: BASE,
    yieldToMain: () => Promise.resolve(),
  });
  return { server, caches, source };
}

async function loadAll(
  source: ReturnType<typeof setup>['source'],
  index: Parameters<ReturnType<typeof setup>['source']['load']>[0],
  appids: number[],
) {
  const results: ShardResult[] = [];
  const outcome = await source.load(index, appids, (result) => results.push(result));
  const merged = new Map(results.flatMap((result) => [...result]));
  return { outcome, results, merged };
}

describe('createDetailsSource', () => {
  it('pide el índice y solo los *shards* de lo pedido, agrupados', async () => {
    expect(detailShardOf(36)).toBe(detailShardOf(100));
    const { server, source } = setup();
    const published = await publishDetails(GAMES);
    server.serve(published);
    const { outcome, results, merged } = await loadAll(source, published.index, [36, 100, 730, 36]);
    expect(outcome.failed).toEqual([]);
    // Un aviso por *shard*: 36 y 100 llegan juntos.
    expect(results.map((result) => [...result.keys()].sort((a, b) => a - b))).toEqual([
      [36, 100],
      [730],
    ]);
    expect(merged.get(730)).toMatchObject({
      assetUrlFormat: `steam/apps/730/\${FILENAME}?t=1700000000`,
      capsule: 'library_600x900.jpg',
      header: 'header.jpg',
      releaseTime: 1700000000,
      releasePrecision: 'day',
      reviewScore: 8,
      reviewCount: 1234,
      reviewPercent: 93,
      platforms: 3,
      deck: 3,
    });
    expect(server.state.requests).toEqual([
      published.index.path,
      published.shardPaths.get(156),
      published.shardPaths.get(765),
    ]);
  });

  it('un juego que no está en su *shard*, o un *shard* vacío, da `null` sin pedir nada', async () => {
    const { server, source } = setup();
    const published = await publishDetails({ 36: gameDetails(36) });
    server.serve(published);
    // 100 está en el *shard* de 36 pero no tiene detalles; el de 730 no existe (null).
    const { merged } = await loadAll(source, published.index, [100, 730]);
    expect(merged.get(100)).toBeNull();
    expect(merged.get(730)).toBeNull();
    expect(server.state.requests).toEqual([published.index.path, published.shardPaths.get(156)]);
  });

  it('guarda en `gacat-details` y, sin red, sirve lo de la caché', async () => {
    const caches = new MemoryCacheStorage();
    const first = setup(caches);
    const published = await publishDetails(GAMES);
    first.server.serve(published);
    await loadAll(first.source, published.index, [730]);
    expect(await caches.keys()).toEqual([DETAILS_CACHE]);
    expect([...(caches.stores.get(DETAILS_CACHE)?.keys() ?? [])]).toEqual([
      `${BASE}${published.index.path}`,
      `${BASE}${published.shardPaths.get(765)}`,
    ]);

    // Otra sesión, sin red: el índice y el *shard* salen de la caché; el que no está, falla.
    const second = setup(caches);
    second.server.state.offline = true;
    const { outcome, merged } = await loadAll(second.source, published.index, [730, 570]);
    expect(merged.get(730)?.deck).toBe(3);
    expect(outcome.failed).toEqual([570]);
  });

  it('rechaza un *shard* que no coincide con el *hash* de su nombre y no lo guarda', async () => {
    const caches = new MemoryCacheStorage();
    const { server, source } = setup(caches);
    const published = await publishDetails(GAMES);
    const path = published.shardPaths.get(765) as string;
    server.serve(published, {
      [path]: JSON.stringify({ 730: gameDetails(730, { capsule: 'x.jpg' }) }),
    });
    const { outcome, merged } = await loadAll(source, published.index, [730, 570]);
    expect(outcome.failed).toEqual([730]);
    expect(merged.get(570)).not.toBeNull();
    expect(caches.stores.get(DETAILS_CACHE)?.has(`${BASE}${path}`)).toBe(false);
  });

  it('rechaza un *shard* que no cumple el esquema', async () => {
    const { server, source } = setup();
    const bad = await publishDetails({ 730: ['', null, null, [null, 'day'], [0, 0, 0], 0, 0] });
    server.serve(bad);
    const { outcome } = await loadAll(source, bad.index, [730]);
    expect(outcome.failed).toEqual([730]);
  });

  it('rechaza el índice si no coincide con el `sha256` del *manifest*', async () => {
    const { server, source } = setup();
    const published = await publishDetails(GAMES);
    server.serve(published);
    const wrong = { ...published.index, sha256: '0'.repeat(64) };
    await expect(source.load(wrong, [730], () => undefined)).rejects.toThrow(/hash/);
    // Un fallo no se queda en memoria: con el índice bueno vuelve a funcionar.
    const { merged } = await loadAll(source, published.index, [730]);
    expect(merged.get(730)).not.toBeNull();
  });

  it('ante un 404, lo vuelve a pedir sin la caché HTTP', async () => {
    const { server } = setup();
    const published = await publishDetails(GAMES);
    const inits: Array<RequestInit | undefined> = [];
    let first = true;
    const fetchFn = server.fetch;
    const flaky = createDetailsSource({
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        inits.push(init);
        if (first) {
          first = false;
          return new Response('', { status: 404 });
        }
        return fetchFn(input, init);
      }) as typeof fetch,
      caches: null,
      subtle: crypto.subtle,
      baseUrl: BASE,
    });
    server.serve(published);
    const { merged } = await loadAll(flaky, published.index, [730]);
    expect(merged.get(730)).not.toBeNull();
    expect(inits[1]).toEqual({ cache: 'reload' });
  });

  it('al cambiar el índice, borra de la caché lo de versiones anteriores', async () => {
    const caches = new MemoryCacheStorage();
    const { server, source } = setup(caches);
    const v1 = await publishDetails(GAMES, '20261028.1');
    server.serve(v1);
    await loadAll(source, v1.index, [36, 730, 570]);
    // En la v2 cambia el 730; el *shard* de 36 y 100 y el de 570 siguen iguales.
    const v2 = await publishDetails(
      { ...GAMES, 730: gameDetails(730, { capsule: null }) },
      '20261029.1',
    );
    server.serve(v2);
    const { merged } = await loadAll(source, v2.index, [730]);
    expect(merged.get(730)?.capsule).toBeNull();
    expect(await source.evict(v2.index)).toBe(2);
    expect([...(caches.stores.get(DETAILS_CACHE)?.keys() ?? [])].sort()).toEqual(
      [
        `${BASE}${v2.index.path}`,
        `${BASE}${v2.shardPaths.get(156)}`,
        `${BASE}${v2.shardPaths.get(911)}`,
        `${BASE}${v2.shardPaths.get(765)}`,
      ].sort(),
    );
  });

  it('pide como mucho `concurrency` *shards* a la vez y cede entre uno y otro', async () => {
    const server = detailsServer(BASE);
    const published = await publishDetails(GAMES);
    server.serve(published);
    let active = 0;
    let peak = 0;
    let yields = 0;
    const source = createDetailsSource({
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return server.fetch(input, init);
      }) as typeof fetch,
      caches: null,
      subtle: crypto.subtle,
      baseUrl: BASE,
      concurrency: 2,
      yieldToMain: async () => {
        yields += 1;
      },
    });
    await loadAll(source, published.index, [36, 730, 570]);
    expect(peak).toBeLessThanOrEqual(2);
    expect(yields).toBeGreaterThanOrEqual(3);
  });
});
