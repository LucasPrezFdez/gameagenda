import { describe, expect, it } from 'vitest';
import type { CatalogInfo } from '../search-client/protocol.ts';
import { MemoryCacheStorage } from '../search-worker/test-helpers.ts';
import { createDetailsSource, type DetailsSource } from './details-source.ts';
import { createDetailsStore } from './details-store.ts';
import { detailsServer, gameDetails, publishDetails } from './test-helpers.ts';

const BASE = 'http://127.0.0.1/catalog-dev/';
const GAMES = {
  36: gameDetails(36),
  100: gameDetails(100),
  730: gameDetails(730),
  570: gameDetails(570),
};

/** Tareas programadas que la prueba ejecuta cuando quiere. */
function manualTasks() {
  const queue: Array<() => void> = [];
  return {
    schedule: (task: () => void) => queue.push(task),
    async drain(): Promise<void> {
      for (let i = 0; i < 50; i++) {
        const task = queue.shift();
        if (task) task();
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
    },
  };
}

async function setup(options: { now?: () => number } = {}) {
  const server = detailsServer(BASE);
  const published = await publishDetails(GAMES);
  server.serve(published);
  const caches = new MemoryCacheStorage();
  const loads: number[][] = [];
  let sources = 0;
  const tasks = manualTasks();
  const evictions: string[] = [];
  const store = createDetailsStore({
    loadSource: async () => {
      sources += 1;
      const real = createDetailsSource({
        fetch: server.fetch,
        caches: caches.asCacheStorage(),
        subtle: crypto.subtle,
        baseUrl: BASE,
        yieldToMain: () => Promise.resolve(),
      });
      const wrapped: DetailsSource = {
        load: (ref, appids, onShard) => {
          loads.push([...appids]);
          return real.load(ref, appids, onShard);
        },
        evict: (ref) => {
          evictions.push(ref.path);
          return real.evict(ref);
        },
        clearMemory: () => real.clearMemory(),
      };
      return wrapped;
    },
    schedule: tasks.schedule,
    idle: (task) => tasks.schedule(task),
    now: options.now,
    retryMs: 1000,
  });
  return {
    server,
    published,
    store,
    tasks,
    loads,
    evictions,
    sourcesLoaded: () => sources,
  };
}

describe('createDetailsStore', () => {
  it('junta las peticiones de un pintado y no carga la fuente hasta que hace falta', async () => {
    const t = await setup();
    expect(t.store.get(730)).toEqual({ kind: 'loading' });
    // Sin catálogo aún: se apuntan y esperan.
    t.store.request([730]);
    t.store.request([36, 100]);
    await t.tasks.drain();
    expect(t.sourcesLoaded()).toBe(0);

    t.store.setCatalog(t.published.catalog);
    expect(t.store.getAvailability()).toBe('available');
    await t.tasks.drain();
    expect(t.loads).toEqual([[730, 36, 100]]);
    expect(t.store.get(730)).toMatchObject({ kind: 'ready', details: { deck: 3 } });
    expect(t.store.get(36).kind).toBe('ready');
    // Lo ya cargado no se vuelve a pedir; 570 sí.
    t.store.request([730, 570]);
    await t.tasks.drain();
    expect(t.loads).toEqual([[730, 36, 100], [570]]);
    expect(t.evictions).toEqual([t.published.index.path]);
  });

  it('avisa a quien mira cada `appid` y, una vez por tarea, a las listas', async () => {
    const t = await setup();
    t.store.setCatalog(t.published.catalog);
    const seen: string[] = [];
    let all = 0;
    t.store.subscribe(730, () => seen.push(t.store.get(730).kind));
    t.store.subscribeAll(() => {
      all += 1;
    });
    const before = t.store.getVersion();
    t.store.request([730, 36]);
    await t.tasks.drain();
    expect(seen).toEqual(['ready']);
    expect(t.store.getVersion()).toBeGreaterThan(before);
    expect(all).toBeGreaterThanOrEqual(1);
    // El estado es el mismo objeto mientras no cambia (`useSyncExternalStore`).
    expect(t.store.get(730)).toBe(t.store.get(730));
  });

  it('sin índice de *shards* o con el *kill switch* `details`, no pide nada', async () => {
    const t = await setup();
    t.store.setCatalog({ ...t.published.catalog, detailsIndex: null });
    t.store.request([730]);
    await t.tasks.drain();
    expect(t.store.get(730)).toEqual({ kind: 'unavailable' });
    expect(t.sourcesLoaded()).toBe(0);

    t.store.setCatalog({
      ...t.published.catalog,
      killSwitches: { covers: false, details: true },
    });
    t.store.request([730]);
    await t.tasks.drain();
    expect(t.store.get(730)).toEqual({ kind: 'unavailable' });
    expect(t.sourcesLoaded()).toBe(0);
    expect(t.store.coversAvailable()).toBe(false);

    // Sin catálogo y con la carga fallida, tampoco.
    t.store.setCatalog(null, true);
    expect(t.store.getAvailability()).toBe('unavailable');
  });

  it('el *kill switch* `covers` apaga las portadas sin tocar los detalles', async () => {
    const t = await setup();
    t.store.setCatalog(t.published.catalog);
    expect(t.store.coversAvailable()).toBe(true);
    const killed: CatalogInfo = {
      ...t.published.catalog,
      killSwitches: { covers: true, details: false },
    };
    t.store.setCatalog(killed);
    expect(t.store.coversAvailable()).toBe(false);
    t.store.request([730]);
    await t.tasks.drain();
    expect(t.store.get(730).kind).toBe('ready');
  });

  it('con un índice nuevo vuelve a pedir lo pedido y, mientras, enseña lo de antes', async () => {
    const t = await setup();
    t.store.setCatalog(t.published.catalog);
    t.store.request([730]);
    await t.tasks.drain();
    const v2 = await publishDetails(
      { ...GAMES, 730: gameDetails(730, { capsule: null }) },
      '20261029.1',
    );
    t.server.serve(v2);
    t.store.setCatalog(v2.catalog);
    expect(t.store.get(730)).toMatchObject({
      kind: 'ready',
      details: { capsule: 'library_600x900.jpg' },
    });
    await t.tasks.drain();
    expect(t.store.get(730)).toMatchObject({ kind: 'ready', details: { capsule: null } });
    expect(t.loads).toEqual([[730], [730]]);
  });

  it('sin red: no disponible y no lo vuelve a pedir hasta pasado un rato', async () => {
    let clock = 0;
    const t = await setup({ now: () => clock });
    t.server.state.offline = true;
    t.store.setCatalog(t.published.catalog);
    t.store.request([730]);
    await t.tasks.drain();
    expect(t.store.get(730)).toEqual({ kind: 'unavailable' });
    t.store.request([730]);
    await t.tasks.drain();
    expect(t.loads).toHaveLength(1);
    clock = 1000;
    t.server.state.offline = false;
    t.store.request([730]);
    await t.tasks.drain();
    expect(t.store.get(730).kind).toBe('ready');
  });

  it('cuenta las portadas que esperan al aviso de primera capa', async () => {
    const t = await setup();
    let calls = 0;
    t.store.subscribeAll(() => {
      calls += 1;
    });
    const release = t.store.wantCover();
    const other = t.store.wantCover();
    expect(t.store.hasCoverDemand()).toBe(true);
    release();
    release();
    expect(t.store.hasCoverDemand()).toBe(true);
    other();
    expect(t.store.hasCoverDemand()).toBe(false);
    await t.tasks.drain();
    expect(calls).toBeGreaterThanOrEqual(1);
  });

  it('`clear()` olvida lo leído y vuelve a pedir lo que se está mirando', async () => {
    const t = await setup();
    t.store.setCatalog(t.published.catalog);
    t.store.subscribe(730, () => undefined);
    t.store.request([730, 570]);
    await t.tasks.drain();
    t.store.clear();
    expect(t.store.get(570)).toEqual({ kind: 'loading' });
    await t.tasks.drain();
    expect(t.store.get(730).kind).toBe('ready');
    expect(t.loads.at(-1)).toEqual([730]);
  });
});
