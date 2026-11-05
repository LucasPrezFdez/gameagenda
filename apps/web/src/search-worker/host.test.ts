import { serializeCore } from '@gameagenda/core/catalog-format';
import { loadFuzzy } from '@gameagenda/core/search';
import { describe, expect, it } from 'vitest';
import type {
  CatalogState,
  ReplyMessage,
  ResultsMessage,
  StatusMessage,
  SuggestionsMessage,
  UiToWorkerMessage,
  WorkerToUiMessage,
} from '../search-client/protocol.ts';
import type { CatalogMeta, CatalogMetaStore } from './catalog-meta.ts';
import { createCatalogStore, signingKeysForMode } from './catalog-store.ts';
import { CHECK_INTERVAL_MS, createSearchHost, type HostTestHooks, RETRY_MIN_MS } from './host.ts';
import type { SearchIndexStore } from './search-index-store.ts';
import {
  catalogServer,
  MemoryCacheStorage,
  manualScheduler,
  manualTimers,
  publish,
  ROWS,
  subtleWithoutEd25519,
} from './test-helpers.ts';

const BASE = 'http://127.0.0.1/catalog-dev/';
const ADULTS = 1;

type Reply = Extract<WorkerToUiMessage, { reqId: number }>;

interface SetupOptions {
  readonly hooks?: HostTestHooks;
  readonly caches?: MemoryCacheStorage;
  /** Reloj falso: con uno que avanza en cada lectura, la construcción se reparte en bloques. */
  readonly now?: () => number;
  /** WebCrypto (por defecto, el de Node, con Ed25519). */
  readonly subtle?: SubtleCrypto;
  /** `fetch` sobre el del servidor en memoria (para fallos puntuales). */
  readonly wrapFetch?: (inner: typeof fetch) => typeof fetch;
  /** `meta.catalog`: sin él, el *manifest* se comprueba en cada arranque. */
  readonly catalogMeta?: CatalogMetaStore;
  /** Reloj de pared (ms desde 1970). */
  readonly wallClock?: () => number;
  /** `meta.searchIndex` (M3): sin él, el índice se construye en cada arranque. */
  readonly searchIndex?: SearchIndexStore;
  readonly indexBuild?: string;
}

function setup(options: SetupOptions = {}) {
  const server = catalogServer(BASE);
  const caches = options.caches ?? new MemoryCacheStorage();
  const scheduler = manualScheduler();
  const timers = manualTimers();
  const out: WorkerToUiMessage[] = [];
  const host = createSearchHost({
    post: (message) => out.push(structuredClone(message)),
    now: options.now ?? (() => performance.now()),
    schedule: scheduler.schedule,
    setTimer: timers.setTimer,
    store: createCatalogStore({
      fetch: options.wrapFetch ? options.wrapFetch(server.fetch) : server.fetch,
      caches: caches.asCacheStorage(),
      subtle: options.subtle ?? crypto.subtle,
      baseUrl: BASE,
      appVersion: '0.1.0',
      signingKeys: signingKeysForMode('e2e'),
    }),
    loadFuzzy,
    progressIntervalMs: 0,
    testHooks: options.hooks ?? null,
    catalogMeta: options.catalogMeta,
    wallClock: options.wallClock,
    searchIndex: options.searchIndex,
    indexBuild: options.indexBuild,
    loadIndexCodec: () => import('@gameagenda/core/search-persist'),
  });
  let reqId = 0;
  const send = (message: UiToWorkerMessage) => host.handle(structuredClone(message));
  const statuses = () => out.filter((m): m is StatusMessage => m.type === 'status');
  const lastStatus = () => statuses().at(-1);
  return {
    server,
    scheduler,
    timers,
    host,
    send,
    statuses,
    lastStatus,
    messages: () => out,
    results: (seq: number) =>
      out.find((m): m is ResultsMessage => m.type === 'results' && m.seq === seq),
    suggestions: (seq: number) =>
      out.find((m): m is SuggestionsMessage => m.type === 'suggestions' && m.seq === seq),
    /** Espera a que el último `status` llegue a `state` (y, si se da, a `version`). */
    reach: (state: CatalogState, version?: string) =>
      scheduler.runUntil(() => {
        const s = lastStatus();
        return s?.state === state && (version === undefined || s.version === version);
      }),
    /** Envía una petición con `reqId` y devuelve una función que busca su respuesta. */
    request(type: ReplyMessage['type'], payload: Record<string, unknown>): () => Reply | undefined {
      reqId += 1;
      const id = reqId;
      send({ type, reqId: id, ...payload } as UiToWorkerMessage);
      return () => out.find((m): m is Reply => 'reqId' in m && m.reqId === id);
    },
  };
}

async function ready(t: ReturnType<typeof setup>, showAdult = false) {
  t.server.serve(await publish('20261028.1'));
  t.send({ type: 'init', catalogVersion: null, showAdult });
  await t.reach('full');
}

/** Reloj que avanza 2 ms en cada lectura: cada bloque de 6 ms son unos pocos trozos de trabajo. */
function steppingClock(): () => number {
  let clock = 0;
  return () => {
    clock += 2;
    return clock;
  };
}

describe('createSearchHost', () => {
  it('pasa de `none` a `scan` y a `full` en bloques que ceden el turno', async () => {
    const t = setup({ now: steppingClock() });
    await ready(t);
    const states = t.statuses().map((s) => s.state);
    expect(states[0]).toBe('none');
    expect(states.indexOf('scan')).toBeGreaterThan(0);
    expect(states.indexOf('full')).toBeGreaterThan(states.indexOf('scan'));
    expect(t.scheduler.ran).toBeGreaterThan(1);
    const progress = t.statuses().map((s) => s.progress);
    const none = t
      .statuses()
      .filter((s) => s.state === 'none')
      .map((s) => s.progress);
    expect(none).toEqual([...none].sort((a, b) => a - b));
    expect(progress.at(-1)).toBe(1);
  });

  it('cuenta los juegos sin +18 salvo que se muestren', async () => {
    const t = setup();
    await ready(t);
    expect(t.lastStatus()).toMatchObject({
      state: 'full',
      version: '20261028.1',
      count: ROWS.length - ADULTS,
      error: null,
    });
    const options = t.request('options', { showAdult: true });
    expect(options()).toMatchObject({ type: 'options' });
    expect(t.lastStatus()?.count).toBe(ROWS.length);
  });

  it('responde a `query` con su `seq`, por niveles y sin +18', async () => {
    const t = setup();
    await ready(t);
    t.send({ type: 'query', seq: 7, q: 'celeste', limit: 8 });
    const r = t.results(7);
    expect(r?.items.map((i) => [i.appid, i.tier])).toEqual([
      [504230, 0],
      [3779560, 1],
    ]);
    expect(r?.strong).toBe(2);
    t.send({ type: 'query', seq: 8, q: 'bg3', limit: 8 });
    expect(t.results(8)?.items[0]?.appid).toBe(1086940);
    t.send({ type: 'query', seq: 9, q: 'appid:730', limit: 8 });
    expect(t.results(9)?.items[0]).toMatchObject({ appid: 730, tier: -1 });
    // Los retirados van detrás de los vivos de su grupo.
    t.send({ type: 'query', seq: 10, q: 'spec ops', limit: 8 });
    expect(t.results(10)?.items[0]?.appid).toBe(50300);
  });

  it('sin catálogo, `query` da una lista vacía y las peticiones esperan a `scan`', async () => {
    const t = setup();
    t.server.serve(await publish('20261028.1'));
    t.send({ type: 'query', seq: 1, q: 'hades', limit: 8 });
    expect(t.results(1)).toMatchObject({ items: [], strong: 0 });
    const game = t.request('game', { appid: 1145350 });
    t.send({ type: 'init', catalogVersion: null, showAdult: false });
    expect(game()).toBeUndefined();
    await t.scheduler.runUntil(() => game() !== undefined);
    expect(game()).toMatchObject({ game: { appid: 1145350, name: 'Hades II', year: 2025 } });
  });

  it('se para en `scan` con el gancho y busca igual que con el índice (CA1.11)', async () => {
    let hold: 'none' | 'scan' | null = 'scan';
    const t = setup({ hooks: { hold: () => hold, beforeLoad: () => undefined } });
    t.server.serve(await publish('20261028.1'));
    t.send({ type: 'init', catalogVersion: null, showAdult: false });
    await t.reach('scan');
    const queries = ['hollow', 'hades', 'the line', 'elden', 'celeste luna', 'cs2', 'hk'];
    const scan = queries.map((q, i) => {
      t.send({ type: 'query', seq: 100 + i, q, limit: 8 });
      return t.results(100 + i)?.items;
    });
    // Una petición del Catálogo hecha en `scan` sigue valiendo en `full`.
    const browse = t.request('browse', { viewId: 'v', q: 'hollow', filters: {} });
    expect(browse()).toMatchObject({ count: 2 });
    hold = null;
    t.host.resume();
    await t.reach('full');
    const full = queries.map((q, i) => {
      t.send({ type: 'query', seq: 200 + i, q, limit: 8 });
      return t.results(200 + i)?.items;
    });
    expect(scan).toEqual(full);
    const rows = t.request('rows', { viewId: 'v', from: 0, to: 10 });
    expect((rows() as { items: readonly { appid: number }[] }).items.map((i) => i.appid)).toEqual([
      367520, 1030300,
    ]);
  });

  it('con el gancho en `none`, no lee el núcleo hasta que se suelta', async () => {
    let hold: 'none' | 'scan' | null = 'none';
    const t = setup({ hooks: { hold: () => hold, beforeLoad: () => undefined } });
    t.server.serve(await publish('20261028.1'));
    t.send({ type: 'init', catalogVersion: null, showAdult: false });
    await t.scheduler.runUntil(() => (t.lastStatus()?.progress ?? 0) >= 0.5);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(t.lastStatus()?.state).toBe('none');
    hold = null;
    t.host.resume();
    await t.reach('full');
  });

  it('`browse` y `rows`: recuento, ventanas de ≤200 filas y filtros por `flags`', async () => {
    const t = setup();
    await ready(t, true);
    const all = t.request('browse', { viewId: 'v', q: '', filters: {} });
    expect(all()).toMatchObject({ count: ROWS.length });
    const rows = t.request('rows', { viewId: 'v', from: 0, to: 1000 });
    const items = (rows() as { items: readonly { appid: number }[] }).items;
    expect(items).toHaveLength(ROWS.length);
    expect(items.at(-1)?.appid).toBe(50300);
    const soon = t.request('browse', { viewId: 'v', q: '', filters: { flagsAll: 1 } });
    expect(soon()).toMatchObject({ count: 1 });
    const text = t.request('browse', { viewId: 'v', q: 'hades', filters: {} });
    expect(text()).toMatchObject({ count: 2 });
    const missing = t.request('rows', { viewId: 'otra', from: 0, to: 10 });
    expect(missing()).toMatchObject({ type: 'error', code: 'unknown-view' });
  });

  it('`lookup`, `game` y `matchExact` sobre el núcleo', async () => {
    const t = setup();
    await ready(t);
    const lookup = t.request('lookup', { appids: [730, 999999] });
    expect(lookup()).toMatchObject({ found: [{ appid: 730 }], missing: [999999] });
    const game = t.request('game', { appid: 999999 });
    expect(game()).toMatchObject({ game: null });
    const exact = t.request('matchExact', { title: 'hades ii' });
    expect(exact()).toMatchObject({ appids: [1145350] });
  });

  it('el nivel 4 sugiere tras la consulta y se abandona si llega otra', async () => {
    const t = setup();
    await ready(t);
    t.send({ type: 'query', seq: 1, q: 'hollow knigth', limit: 8 });
    expect(t.results(1)?.strong).toBe(0);
    t.send({ type: 'suggest', seq: 1 });
    await t.scheduler.runUntil(() => t.suggestions(1) !== undefined);
    expect(t.suggestions(1)?.items.map((i) => [i.appid, i.tier])).toEqual([
      [367520, 4],
      [1030300, 4],
    ]);
    t.send({ type: 'query', seq: 2, q: 'hollow knigth', limit: 8 });
    t.send({ type: 'suggest', seq: 2 });
    t.send({ type: 'query', seq: 3, q: 'hollow knigt', limit: 8 });
    t.send({ type: 'suggest', seq: 3 });
    await t.scheduler.runUntil(() => t.suggestions(3) !== undefined);
    expect(t.suggestions(2)).toBeUndefined();
    // Con niveles 0–2 de sobra no se ejecuta uFuzzy: llega una lista vacía.
    t.send({ type: 'query', seq: 4, q: 'h', limit: 8 });
    t.send({ type: 'suggest', seq: 4 });
    expect(t.suggestions(4)).toMatchObject({ items: [] });
  });

  it('sin red y sin caché, avisa con un error reintentable; `retry` carga el catálogo', async () => {
    const t = setup();
    t.server.serve(await publish('20261028.1'));
    t.server.state.offline = true;
    const game = t.request('game', { appid: 730 });
    t.send({ type: 'init', catalogVersion: null, showAdult: false });
    await t.scheduler.runUntil(() => t.lastStatus()?.error != null);
    expect(t.lastStatus()).toMatchObject({
      state: 'none',
      error: { code: 'network', retryable: true },
    });
    expect(game()).toMatchObject({ game: null });
    t.server.state.offline = false;
    t.request('retry', {});
    await t.reach('full');
    expect(t.lastStatus()?.error).toBeNull();
  });

  it('el gancho `beforeLoad` simula el primer fallo y «Reintentar» lo supera', async () => {
    let fail = true;
    const t = setup({
      hooks: {
        hold: () => null,
        beforeLoad() {
          if (!fail) return;
          fail = false;
          throw new TypeError('Failed to fetch');
        },
      },
    });
    t.server.serve(await publish('20261028.1'));
    t.send({ type: 'init', catalogVersion: null, showAdult: false });
    await t.scheduler.runUntil(() => t.lastStatus()?.error != null);
    t.request('retry', {});
    await t.reach('full');
  });

  it('al volver con caché arranca sin red y, con red, cambia a una versión más nueva', async () => {
    const caches = new MemoryCacheStorage();
    const first = setup({ caches });
    await ready(first);

    const offline = setup({ caches });
    offline.server.state.offline = true;
    offline.send({ type: 'init', catalogVersion: null, showAdult: false });
    await offline.reach('full', '20261028.1');

    // Vuelve la red con una versión nueva: se indexa en segundo plano y sustituye a la vigente.
    const newer = [
      { appid: 413150, name: 'Stardew Valley', year: 2016, pop: 39 },
      ...ROWS.slice(1),
    ];
    const before = offline.statuses().length;
    // Stardew Valley es un alta: llega en `recent` (el núcleo local, de 1 día, sigue valiendo).
    offline.server.serve(
      await publish('20261029.1', newer, undefined, { recent: newer.slice(0, 1) }),
    );
    offline.server.state.offline = false;
    offline.host.online();
    await offline.reach('full', '20261029.1');
    // Mientras se indexa la nueva, sigue respondiendo la vigente: nunca se vuelve a `none`.
    expect(
      offline
        .statuses()
        .slice(before)
        .every((s) => s.state === 'full'),
    ).toBe(true);
    offline.send({ type: 'query', seq: 1, q: 'stardew', limit: 8 });
    expect(offline.results(1)?.items[0]?.appid).toBe(413150);
    const refresh = offline.request('refresh', {});
    await offline.scheduler.runUntil(() => refresh() !== undefined);
    expect(refresh()).toMatchObject({ type: 'refresh' });
  });

  it('rechaza un manifest con una versión anterior a la vigente', async () => {
    const caches = new MemoryCacheStorage();
    const first = setup({ caches });
    first.server.serve(await publish('20261029.1'));
    first.send({ type: 'init', catalogVersion: null, showAdult: false });
    await first.reach('full');

    const again = setup({ caches });
    again.server.serve(await publish('20261028.1'));
    again.send({ type: 'init', catalogVersion: null, showAdult: false });
    await again.reach('full', '20261029.1');
    const refresh = again.request('refresh', {});
    await again.scheduler.runUntil(() => refresh() !== undefined);
    expect(again.statuses().every((s) => s.version !== '20261028.1')).toBe(true);
  });
});

/** Otra versión del catálogo, con un juego nuevo en cabeza (otro núcleo). */
const NEWER_ROWS = [{ appid: 413150, name: 'Stardew Valley', year: 2016, pop: 39 }, ...ROWS];
/** Un alta de `recent`: `pop` 38, así que va detrás de los de 39 y delante de los de 37. */
const BALATRO = { appid: 2379780, name: 'Balatro', year: 2024, pop: 38 };

/** Un host que ya tiene en la caché el catálogo 20261028.1 (y otro sobre la misma caché). */
async function withCache(options: Omit<SetupOptions, 'caches'> = {}) {
  const caches = new MemoryCacheStorage();
  await ready(setup({ caches }));
  return setup({ ...options, caches });
}

const init = { type: 'init', catalogVersion: null, showAdult: false } as const;

describe('createSearchHost · catálogo vivo (M2)', () => {
  it('aplica `recent` al núcleo antes del índice: altas en su hueco y renombrados en su sitio', async () => {
    const t = setup();
    const renamed = { appid: 1145360, name: 'Hades: edición renombrada', year: 2020, pop: 36 };
    t.server.serve(await publish('20261028.1', ROWS, undefined, { recent: [renamed, BALATRO] }));
    t.send(init);
    await t.reach('full');
    expect(t.lastStatus()?.count).toBe(ROWS.length + 1 - ADULTS);
    t.send({ type: 'query', seq: 1, q: 'balatro', limit: 8 });
    expect(t.results(1)?.items[0]?.appid).toBe(BALATRO.appid);
    t.send({ type: 'query', seq: 2, q: 'edicion renombrada', limit: 8 });
    expect(t.results(2)?.items[0]).toMatchObject({ appid: 1145360, name: renamed.name });
    const all = t.request('browse', { viewId: 'v', q: '', filters: {} });
    expect(all()).toMatchObject({ count: ROWS.length + 1 - ADULTS });
    const rows = t.request('rows', { viewId: 'v', from: 0, to: 6 });
    expect((rows() as { items: readonly { appid: number }[] }).items.map((i) => i.appid)).toEqual([
      730,
      1245620,
      1086940,
      BALATRO.appid,
      367520,
      1030300,
    ]);
  });

  it('un manifest mal firmado no sustituye al catálogo vigente: lo anuncia y reintenta (CA2.3)', async () => {
    const t = await withCache();
    const v2 = await publish('20261029.1', NEWER_ROWS, undefined, { recent: [BALATRO] });
    t.server.serve({ ...v2, manifest: { ...v2.manifest, enrichmentAgeDays: 9 } });
    t.send(init);
    await t.scheduler.runUntil(() => t.lastStatus()?.error != null);
    expect(t.lastStatus()).toMatchObject({
      state: 'full',
      version: '20261028.1',
      error: { code: 'signature', retryable: true },
    });
    t.send({ type: 'query', seq: 1, q: 'hollow', limit: 8 });
    expect(t.results(1)?.items[0]?.appid).toBe(367520);
    expect(t.timers.pending).toEqual([RETRY_MIN_MS]);

    // Más tarde ya está el bueno: el reintento lo adopta y el aviso desaparece.
    t.server.serve(v2);
    t.timers.fire();
    await t.reach('full', '20261029.1');
    expect(t.lastStatus()?.error).toBeNull();
    t.send({ type: 'query', seq: 2, q: 'balatro', limit: 8 });
    expect(t.results(2)?.items[0]?.appid).toBe(BALATRO.appid);
  });

  it('sin Ed25519: con caché sigue buscando y pide otro navegador; sin caché, no hay catálogo (RNF-12)', async () => {
    const t = await withCache({ subtle: subtleWithoutEd25519() });
    t.server.serve(await publish('20261029.1', NEWER_ROWS));
    t.send(init);
    await t.scheduler.runUntil(() => t.lastStatus()?.error != null);
    expect(t.lastStatus()).toMatchObject({
      state: 'full',
      version: '20261028.1',
      error: { code: 'browser-too-old', retryable: false },
    });
    t.send({ type: 'query', seq: 1, q: 'celeste', limit: 8 });
    expect(t.results(1)?.items[0]?.appid).toBe(504230);
    // Reintentar no lo arregla: ni temporizador.
    expect(t.timers.pending).toEqual([]);

    const fresh = setup({ subtle: subtleWithoutEd25519() });
    fresh.server.serve(await publish('20261028.1'));
    const game = fresh.request('game', { appid: 730 });
    fresh.send(init);
    await fresh.scheduler.runUntil(() => fresh.lastStatus()?.error != null);
    expect(fresh.lastStatus()).toMatchObject({
      state: 'none',
      error: { code: 'browser-too-old', retryable: false },
      catalog: null,
    });
    expect(game()).toMatchObject({ game: null });
  });

  it('regla de los 7 días: al día siguiente solo baja el manifest y `recent` (CA2.4)', async () => {
    const t = await withCache();
    // Otro núcleo (con Stardew Valley) y otros recientes; los alias y el índice, iguales.
    const v2 = await publish('20261029.1', NEWER_ROWS, undefined, {
      recent: [BALATRO],
      fileVersion: '20261028.1',
    });
    t.server.serve(v2);
    t.server.reset();
    t.send(init);
    await t.reach('full', '20261029.1');
    expect(t.server.state.requests).toEqual([
      `${BASE}manifest.json`,
      `${BASE}${v2.manifest.files.recent?.path}`,
    ]);
    const manifestBytes = new TextEncoder().encode(JSON.stringify(v2.manifest)).byteLength;
    expect(t.server.state.bytes).toBe(manifestBytes + (v2.manifest.files.recent?.bytes ?? 0));
    expect(t.lastStatus()?.catalog?.version).toBe('20261029.1');
    // El índice es el núcleo local con los recientes nuevos: Balatro sí; Stardew, aún no.
    t.send({ type: 'query', seq: 1, q: 'balatro', limit: 8 });
    expect(t.results(1)?.items[0]?.appid).toBe(BALATRO.appid);
    t.send({ type: 'query', seq: 2, q: 'stardew', limit: 8 });
    expect(t.results(2)?.items).toEqual([]);

    // «Actualizar catálogo» baja el núcleo nuevo aunque el local tenga ≤7 días.
    const refresh = t.request('refresh', {});
    await t.scheduler.runUntil(
      () => refresh() !== undefined && t.lastStatus()?.count === NEWER_ROWS.length + 1 - ADULTS,
    );
    expect(refresh()).toMatchObject({ type: 'refresh' });
    expect(t.server.state.requests).toContain(`${BASE}${v2.manifest.files.core.path}`);
    t.send({ type: 'query', seq: 3, q: 'stardew', limit: 8 });
    expect(t.results(3)?.items[0]?.appid).toBe(413150);
  });

  it('una versión con el mismo índice (un kill switch) se adopta sin reconstruir (CA2.3)', async () => {
    // El *manifest* espera a que el catálogo de la caché esté en `full`.
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const t = await withCache({
      wrapFetch: (inner) =>
        (async (input: RequestInfo | URL, init?: RequestInit) => {
          if (String(input).endsWith('manifest.json')) await gate;
          return inner(input, init);
        }) as typeof fetch,
    });
    t.server.serve(
      await publish('20261029.1', ROWS, undefined, {
        fileVersion: '20261028.1',
        killSwitches: { covers: true, details: false },
      }),
    );
    t.send(init);
    await t.reach('full', '20261028.1');
    const ran = t.scheduler.ran;
    release();
    await t.scheduler.runUntil(() => t.lastStatus()?.version === '20261029.1');
    expect(t.lastStatus()?.catalog?.killSwitches).toEqual({ covers: true, details: false });
    expect(t.scheduler.ran).toBe(ran);
  });

  it('un 404 al bajar un fichero hace releer el manifest y seguir con la versión vigente (§5.4)', async () => {
    const v1 = await publish('20261028.1');
    const v2 = await publish('20261029.1', NEWER_ROWS);
    let manifests = 0;
    // El primer *manifest* que llega es el de antes del despliegue; sus ficheros ya no están.
    const t = setup({
      wrapFetch: (inner) =>
        (async (input: RequestInfo | URL, init?: RequestInit) => {
          if (String(input).endsWith('manifest.json') && manifests++ === 0) {
            return Response.json(v1.manifest);
          }
          return inner(input, init);
        }) as typeof fetch,
    });
    t.server.serve(v2);
    t.send(init);
    await t.reach('full', '20261029.1');
    expect(manifests).toBe(2);
    expect(t.lastStatus()?.error).toBeNull();
  });

  it('si un fichero de la versión nueva sigue dando 404, sigue con la vigente y reintenta con espera creciente', async () => {
    const t = await withCache();
    const v2 = await publish('20261029.1', NEWER_ROWS, undefined, { recent: [BALATRO] });
    t.server.serve(v2);
    t.server.state.missing.add(v2.manifest.files.recent?.path as string);
    t.send(init);
    await t.reach('full', '20261028.1');
    await t.scheduler.runUntil(() => t.timers.pending.length === 1);
    expect(t.lastStatus()).toMatchObject({ state: 'full', version: '20261028.1', error: null });
    for (const factor of [2, 4]) {
      t.timers.fire();
      await t.scheduler.runUntil(() => t.timers.pending.length === 1);
      expect(t.timers.pending).toEqual([RETRY_MIN_MS * factor]);
    }
    expect(t.lastStatus()?.version).toBe('20261028.1');
    t.send({ type: 'query', seq: 1, q: 'hades', limit: 8 });
    expect(t.results(1)?.items.length).toBeGreaterThan(0);

    // Llega el fichero: el siguiente reintento pasa a la versión nueva.
    t.server.state.missing.clear();
    t.timers.fire();
    await t.reach('full', '20261029.1');
    expect(t.timers.delays).toEqual([RETRY_MIN_MS, RETRY_MIN_MS * 2, RETRY_MIN_MS * 4]);
  });

  it('un fallo de red al bajar un fichero no relee el manifest al momento: lo relee el reintento', async () => {
    let cut = true;
    const t = await withCache({
      wrapFetch: (inner) =>
        (async (input: RequestInfo | URL, init?: RequestInit) => {
          if (cut && String(input).includes('/recent.')) throw new TypeError('Load cancelled');
          return inner(input, init);
        }) as typeof fetch,
    });
    t.server.serve(await publish('20261029.1', NEWER_ROWS, undefined, { recent: [BALATRO] }));
    t.server.reset();
    t.send(init);
    // La caché carga a la vez que se comprueba el *manifest*: en una máquina lenta, el reintento
    // se programa antes de que el catálogo local esté en `full`.
    await t.reach('full', '20261028.1');
    await t.scheduler.runUntil(() => t.timers.pending.length === 1);
    expect(t.server.state.requests.filter((url) => url.endsWith('manifest.json'))).toHaveLength(1);
    expect(t.lastStatus()).toMatchObject({ version: '20261028.1', error: null });
    cut = false;
    t.timers.fire();
    await t.reach('full', '20261029.1');
  });

  it('sin red al comprobar el manifest no programa reintentos: los trae `online()`', async () => {
    const t = await withCache();
    t.server.state.offline = true;
    t.send(init);
    await t.reach('full', '20261028.1');
    await t.scheduler.runUntil(() => t.server.state.requests.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(t.timers.pending).toEqual([]);
    expect(t.lastStatus()?.error).toBeNull();
  });
});

/** `meta.catalog` en memoria, con lo escrito en orden. */
function memoryMeta(initial: CatalogMeta | null = null) {
  let value = initial;
  const writes: CatalogMeta[] = [];
  const store: CatalogMetaStore = {
    read: async () => value,
    async write(meta) {
      value = meta;
      writes.push(meta);
    },
  };
  return {
    store,
    writes,
    get value() {
      return value;
    },
  };
}

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 31, 12);

/** Peticiones de `manifest.json` desde el último `server.reset()`. */
const manifestRequests = (t: ReturnType<typeof setup>) =>
  t.server.state.requests.filter((url) => url.endsWith('manifest.json')).length;

/** Vuelve a abrir la app con `20261028.1` en la caché y `meta` como se diga. */
async function restart(
  meta: ReturnType<typeof memoryMeta>,
  options: Omit<SetupOptions, 'caches' | 'catalogMeta' | 'wallClock'> = {},
) {
  const caches = new MemoryCacheStorage();
  await ready(setup({ caches }));
  return setup({ ...options, caches, catalogMeta: meta.store, wallClock: () => NOW });
}

describe('createSearchHost · comprobación del manifest cada 12 h (meta.catalog)', () => {
  it('la primera visita apunta la comprobación y programa la siguiente a las 12 h', async () => {
    const meta = memoryMeta();
    const t = setup({ catalogMeta: meta.store, wallClock: () => NOW });
    t.server.serve(await publish('20261028.1'));
    t.send(init);
    await t.reach('full', '20261028.1');
    expect(meta.writes).toEqual([{ version: '20261028.1', checkedAt: NOW }]);
    expect(t.timers.pending).toEqual([CHECK_INTERVAL_MS]);
  });

  it('antes de 12 h, el arranque no pide el manifest: lo comprueba cuando toca', async () => {
    const meta = memoryMeta({ version: '20261028.1', checkedAt: NOW - HOUR });
    const t = await restart(meta);
    t.server.serve(await publish('20261029.1', NEWER_ROWS));
    t.server.reset();
    t.send(init);
    await t.reach('full', '20261028.1');
    await t.scheduler.runUntil(() => t.timers.pending.length === 1);
    expect(t.timers.pending).toEqual([CHECK_INTERVAL_MS - HOUR]);
    expect(manifestRequests(t)).toBe(0);

    // Llega la hora con la app abierta: la versión nueva se adopta y se apunta.
    t.timers.fire();
    await t.reach('full', '20261029.1');
    expect(manifestRequests(t)).toBe(1);
    expect(meta.value).toEqual({ version: '20261029.1', checkedAt: NOW });
    expect(t.timers.pending).toEqual([CHECK_INTERVAL_MS]);
  });

  it.each([
    ['de hace 12 h o más', { version: '20261028.1', checkedAt: NOW - 13 * HOUR }],
    ['de otra versión', { version: '20261027.1', checkedAt: NOW - HOUR }],
    ['del futuro (el reloj ha ido hacia atrás)', { version: '20261028.1', checkedAt: NOW + HOUR }],
  ])('con una comprobación %s, el arranque pide el manifest y la apunta', async (_, last) => {
    const meta = memoryMeta(last);
    const t = await restart(meta);
    t.server.serve(await publish('20261028.1'));
    t.server.reset();
    t.send(init);
    await t.reach('full', '20261028.1');
    await t.scheduler.runUntil(() => meta.writes.length === 1);
    expect(manifestRequests(t)).toBe(1);
    expect(meta.value).toEqual({ version: '20261028.1', checkedAt: NOW });
    expect(t.timers.pending).toEqual([CHECK_INTERVAL_MS]);
  });

  it('la vuelta de la red y «Actualizar catálogo» comprueban aunque no hayan pasado 12 h', async () => {
    const meta = memoryMeta({ version: '20261028.1', checkedAt: NOW - HOUR });
    const t = await restart(meta);
    t.server.serve(await publish('20261028.1'));
    t.server.reset();
    t.send(init);
    await t.reach('full', '20261028.1');
    await t.scheduler.runUntil(() => t.timers.pending.length === 1);
    expect(manifestRequests(t)).toBe(0);

    t.host.online();
    await t.scheduler.runUntil(() => meta.writes.length === 1);
    expect(manifestRequests(t)).toBe(1);
    const refresh = t.request('refresh', {});
    await t.scheduler.runUntil(() => refresh() !== undefined);
    expect(refresh()).toMatchObject({ type: 'refresh' });
    expect(manifestRequests(t)).toBe(2);
    expect(meta.writes).toHaveLength(2);
  });

  it('una comprobación fallida no se apunta: se reintenta y el próximo arranque vuelve a comprobar', async () => {
    const meta = memoryMeta({ version: '20261028.1', checkedAt: NOW - 13 * HOUR });
    const t = await restart(meta);
    const v2 = await publish('20261029.1', NEWER_ROWS);
    t.server.serve({ ...v2, manifest: { ...v2.manifest, enrichmentAgeDays: 9 } });
    t.server.reset();
    t.send(init);
    await t.scheduler.runUntil(() => t.lastStatus()?.error != null);
    expect(t.lastStatus()?.error).toMatchObject({ code: 'signature' });
    expect(meta.writes).toEqual([]);
    expect(t.timers.pending).toEqual([RETRY_MIN_MS]);
  });

  it('el gancho `checkEveryStart` de los E2E comprueba en cada arranque y no programa nada', async () => {
    const meta = memoryMeta({ version: '20261028.1', checkedAt: NOW - HOUR });
    const hooks: HostTestHooks = {
      hold: () => null,
      beforeLoad() {},
      checkEveryStart: () => true,
    };
    const t = await restart(meta, { hooks });
    t.server.serve(await publish('20261028.1'));
    t.server.reset();
    t.send(init);
    await t.reach('full', '20261028.1');
    await t.scheduler.runUntil(() => meta.writes.length === 1);
    expect(manifestRequests(t)).toBe(1);
    expect(t.timers.pending).toEqual([]);
  });
});

/** `meta.searchIndex` en memoria, con el clon estructurado de IndexedDB. */
function memoryIndex() {
  const store = {
    key: null as string | null,
    value: null as unknown,
    haystack: null as unknown,
    reads: 0,
    writes: [] as string[],
    failReads: false,
    async read(key: string): Promise<unknown> {
      store.reads++;
      if (store.failReads) throw new Error('IndexedDB no responde');
      return store.key === key ? structuredClone(store.value) : null;
    },
    async readHaystack(key: string): Promise<unknown> {
      return store.key === key ? structuredClone(store.haystack) : null;
    },
    async write(key: string, main: unknown, haystack: unknown): Promise<void> {
      store.key = key;
      store.value = structuredClone(main);
      store.haystack = structuredClone(haystack);
      store.writes.push(key);
    },
  };
  return store;
}

describe('createSearchHost · índice persistido (meta.searchIndex, CA3.2)', () => {
  const init = { type: 'init', catalogVersion: null, showAdult: false } as const;
  const QUERIES = ['hollow', 'hades', 'the line', 'elden', 'celeste luna', 'cs2', 'hk', 'spec ops'];

  function answers(t: ReturnType<typeof setup>, base: number) {
    return QUERIES.map((q, i) => {
      t.send({ type: 'query', seq: base + i, q, limit: 8 });
      return t.results(base + i)?.items;
    });
  }

  /** Primera visita con `idx`: construye, guarda y devuelve lo que responde. */
  async function firstVisit(idx: ReturnType<typeof memoryIndex>, caches: MemoryCacheStorage) {
    const t = setup({ caches, searchIndex: idx, indexBuild: 'build-a' });
    const published = await publish('20261028.1');
    t.server.serve(published);
    t.send(init);
    await t.reach('full');
    await t.scheduler.runUntil(() => idx.writes.length === 1);
    return { t, published, built: answers(t, 1000) };
  }

  it('la primera visita construye el índice y lo guarda después de `full`, con su clave', async () => {
    const idx = memoryIndex();
    const { t, published } = await firstVisit(idx, new MemoryCacheStorage());
    const files = published.manifest.files;
    expect(idx.writes[0]).toBe(
      `2|build-a|${files.core.sha256}|${files.recent?.sha256}|${files.aliases.sha256}`,
    );
    expect(t.messages().some((m) => m.type === 'restored')).toBe(false);
  });

  it('el reinicio con el mismo catálogo lo restaura: de `none` a `full` sin construir, y busca igual', async () => {
    const idx = memoryIndex();
    const caches = new MemoryCacheStorage();
    const { built } = await firstVisit(idx, caches);

    const again = setup({ caches, searchIndex: idx, indexBuild: 'build-a' });
    again.server.serve(await publish('20261028.1'));
    again.server.state.offline = true;
    again.send(init);
    await again.reach('full', '20261028.1');
    expect(again.statuses().map((s) => s.state)).toEqual(['none', 'full']);
    expect(again.messages().find((m) => m.type === 'restored')).toMatchObject({
      ms: expect.any(Number),
    });
    expect(again.lastStatus()).toMatchObject({ count: ROWS.length - ADULTS, error: null });
    // Con el pajar (la segunda fase), también el nivel 3.
    await again.scheduler.runUntil(() => {
      again.send({ type: 'query', seq: 1999, q: 'ollow kni', limit: 8 });
      return (again.results(1999)?.items.length ?? 0) > 0;
    });
    expect(answers(again, 2000)).toEqual(built);
    // El Catálogo y la ficha también, y no lo vuelve a guardar.
    expect(again.request('browse', { viewId: 'v', q: 'hollow', filters: {} })()).toMatchObject({
      count: 2,
    });
    expect(again.request('game', { appid: 1145350 })()).toMatchObject({
      game: { appid: 1145350, name: 'Hades II' },
    });
    expect(idx.writes).toHaveLength(1);
  });

  it('otro código, un índice que no cuadra o IndexedDB que falla: se construye como siempre', async () => {
    const idx = memoryIndex();
    const caches = new MemoryCacheStorage();
    const { built } = await firstVisit(idx, caches);

    // Otro *chunk* del Worker (otra versión de la app): no vale, se construye y se guarda el nuevo.
    const other = setup({ caches, searchIndex: idx, indexBuild: 'build-b' });
    other.server.serve(await publish('20261028.1'));
    other.send(init);
    await other.reach('full');
    expect(other.messages().some((m) => m.type === 'restored')).toBe(false);
    await other.scheduler.runUntil(() => idx.writes.length === 2);
    expect(idx.writes[1]).toContain('|build-b|');

    // Con su clave, pero de otro formato.
    idx.value = { format: 99 };
    const broken = setup({ caches, searchIndex: idx, indexBuild: 'build-b' });
    broken.server.serve(await publish('20261028.1'));
    broken.send(init);
    await broken.reach('full');
    expect(broken.messages().some((m) => m.type === 'restored')).toBe(false);
    expect(answers(broken, 3000)).toEqual(built);

    idx.failReads = true;
    const failing = setup({ caches, searchIndex: idx, indexBuild: 'build-b' });
    failing.server.serve(await publish('20261028.1'));
    failing.send(init);
    await failing.reach('full');
    expect(failing.messages().some((m) => m.type === 'restored')).toBe(false);
    expect(answers(failing, 4000)).toEqual(built);
  });

  it('sin el pajar guardado, busca con los niveles 0–2 y lo reconstruye en segundo plano', async () => {
    const idx = memoryIndex();
    const caches = new MemoryCacheStorage();
    const { built } = await firstVisit(idx, caches);
    idx.haystack = { format: 2, count: 0, chunks: [] };

    const t = setup({ caches, searchIndex: idx, indexBuild: 'build-a' });
    t.server.serve(await publish('20261028.1'));
    t.server.state.offline = true;
    t.send(init);
    await t.reach('full', '20261028.1');
    expect(t.messages().some((m) => m.type === 'restored')).toBe(true);
    // Se reconstruye desde la caché (sin red) y se guarda otra vez, entero.
    await t.scheduler.runUntil(() => idx.writes.length === 2);
    expect(idx.writes[1]).toBe(idx.writes[0]);
    expect(answers(t, 5000)).toEqual(built);
  });

  it('una versión nueva del catálogo se indexa, se usa y se guarda en lugar de la anterior', async () => {
    const idx = memoryIndex();
    const caches = new MemoryCacheStorage();
    await firstVisit(idx, caches);

    const t = setup({ caches, searchIndex: idx, indexBuild: 'build-a' });
    t.server.serve(await publish('20261028.1'));
    t.server.state.offline = true;
    t.send(init);
    await t.reach('full', '20261028.1');
    const newer = [{ appid: 413150, name: 'Stardew Valley', year: 2016, pop: 39 }, ...ROWS];
    // Stardew Valley llega en `recent`: el núcleo local, de 1 día, sigue valiendo (CA2.4).
    const v2 = await publish('20261029.1', newer, undefined, { recent: newer.slice(0, 1) });
    t.server.serve(v2);
    t.server.state.offline = false;
    t.host.online();
    await t.reach('full', '20261029.1');
    await t.scheduler.runUntil(() => idx.writes.length === 2);
    expect(idx.writes[1]).not.toBe(idx.writes[0]);
    expect(idx.writes[1]).toContain(v2.manifest.files.recent?.sha256);

    // Y el siguiente arranque ya restaura la nueva.
    const next = setup({ caches, searchIndex: idx, indexBuild: 'build-a' });
    next.server.serve(v2);
    next.send(init);
    await next.reach('full', '20261029.1');
    expect(next.messages().some((m) => m.type === 'restored')).toBe(true);
    next.send({ type: 'query', seq: 1, q: 'stardew', limit: 8 });
    expect(next.results(1)?.items[0]?.appid).toBe(413150);
  });

  it('con el gancho `hold` de los E2E no se restaura: la construcción se para donde pide', async () => {
    const idx = memoryIndex();
    const caches = new MemoryCacheStorage();
    await firstVisit(idx, caches);
    let hold: 'none' | 'scan' | null = 'scan';
    const t = setup({
      caches,
      searchIndex: idx,
      indexBuild: 'build-a',
      hooks: { hold: () => hold, beforeLoad: () => undefined },
    });
    t.server.serve(await publish('20261028.1'));
    t.send(init);
    await t.reach('scan');
    expect(idx.reads).toBe(0);
    hold = null;
    t.host.resume();
    await t.reach('full');
  });
});

/** Los estados de los `status`, sin repetir el anterior. */
function statesOf(t: ReturnType<typeof setup>): CatalogState[] {
  const states: CatalogState[] = [];
  for (const { state } of t.statuses()) if (states.at(-1) !== state) states.push(state);
  return states;
}

/** Peticiones al catálogo desde el último `server.reset()`, sin la base. */
const pathsOf = (t: ReturnType<typeof setup>) =>
  t.server.state.requests.map((url) => url.slice(BASE.length));

/** Una puerta que la prueba abre cuando quiere. */
function gate() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

/** `fetch` que retiene (y, con `fail`, hace fallar como sin red) la descarga del núcleo. */
function holdCore(until: Promise<void>, fail: () => boolean) {
  return (inner: typeof fetch) =>
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/core.')) {
        await until;
        if (fail()) throw new TypeError('Failed to fetch');
      }
      return inner(input, init);
    }) as typeof fetch;
}

/** Unas cuantas vueltas de las promesas (red, WebCrypto, caché) sin ejecutar bloques. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('createSearchHost · núcleo de arranque (M3, ADR-009)', () => {
  /** Con un reloj que avanza en cada lectura: así se ve `scan` también con el mini-catálogo. */
  const setupBoot = (options: SetupOptions = {}) => setup({ now: steppingClock(), ...options });

  /** Las 4 primeras filas: Counter-Strike 2, ELDEN RING, Baldur's Gate 3 y Hollow Knight. */
  const BOOT = 4;
  const withBoot = (boot: number | string = BOOT) =>
    publish('20261028.1', ROWS, undefined, { boot });

  it('la primera visita pasa por `boot`: busca en los más populares hasta que el núcleo llega a `scan`', async () => {
    let hold: 'boot' | null = 'boot';
    const t = setupBoot({ hooks: { hold: () => hold, beforeLoad() {} } });
    const published = await withBoot();
    t.server.serve(published);
    t.send(init);
    await t.reach('boot');
    expect(t.lastStatus()).toMatchObject({
      version: '20261028.1',
      count: BOOT,
      error: null,
      catalog: { version: '20261028.1', detailsIndex: published.manifest.files.details },
    });
    // Los alias y las filas del núcleo de arranque responden; Celeste aún no está.
    const found = (
      [
        ['cs2', 730],
        ['bg3', 1086940],
        ['hollow', 367520],
      ] as const
    ).map(([q], i) => {
      t.send({ type: 'query', seq: i + 1, q, limit: 8 });
      return t.results(i + 1)?.items[0]?.appid;
    });
    expect(found).toEqual([730, 1086940, 367520]);
    t.send({ type: 'query', seq: 4, q: 'celeste', limit: 8 });
    expect(t.results(4)?.items).toEqual([]);

    hold = null;
    t.host.resume();
    await t.reach('full');
    expect(statesOf(t)).toEqual(['none', 'boot', 'scan', 'full']);
    t.send({ type: 'query', seq: 5, q: 'celeste', limit: 8 });
    expect(t.results(5)?.items[0]?.appid).toBe(504230);
    expect(t.lastStatus()?.count).toBe(ROWS.length - ADULTS);
  });

  it('en `boot` cuenta los juegos del núcleo de arranque sin +18, salvo que se muestren', async () => {
    const t = setupBoot({ hooks: { hold: () => 'boot', beforeLoad() {} } });
    // Las 9 primeras filas, con Celeste & Luna (+18).
    t.server.serve(await withBoot(9));
    t.send(init);
    await t.reach('boot');
    expect(t.lastStatus()?.count).toBe(8);
    t.request('options', { showAdult: true });
    expect(t.lastStatus()?.count).toBe(9);
  });

  it('el avance no retrocede ni en `none` ni en `boot`, y `boot` va siempre antes que `scan`', async () => {
    const t = setupBoot({ now: steppingClock() });
    t.server.serve(await withBoot());
    t.send(init);
    await t.reach('full');
    expect(statesOf(t)).toEqual(['none', 'boot', 'scan', 'full']);
    for (const state of ['none', 'boot'] as const) {
      const progress = t
        .statuses()
        .filter((s) => s.state === state)
        .map((s) => s.progress);
      expect(progress.length).toBeGreaterThan(0);
      expect(progress).toEqual([...progress].sort((a, b) => a - b));
    }
  });

  it('sin `files.boot`, la primera visita es la de M2: las mismas peticiones y sin `boot`', async () => {
    const t = setupBoot();
    const { manifest } = await publish('20261028.1');
    t.server.serve(await publish('20261028.1'));
    t.send(init);
    await t.reach('full');
    const { files } = manifest;
    expect(pathsOf(t)).toEqual([
      'manifest.json',
      files.core.path,
      files.aliases.path,
      files.recent?.path,
      files.details?.path,
    ]);
    expect(statesOf(t)).toEqual(['none', 'scan', 'full']);
  });

  it('baja el núcleo de arranque y los alias a la vez y después el resto, cada fichero una vez', async () => {
    const caches = new MemoryCacheStorage();
    const t = setupBoot({ caches });
    const { manifest } = await withBoot();
    t.server.serve(await withBoot());
    t.send(init);
    await t.reach('full');
    const { files } = manifest;
    const requests = pathsOf(t);
    expect(requests[0]).toBe('manifest.json');
    expect(new Set(requests.slice(1, 3))).toEqual(new Set([files.boot?.path, files.aliases.path]));
    expect(requests.slice(3)).toEqual([files.core.path, files.recent?.path, files.details?.path]);
    const stored = caches.stores.get('gacat-20261028.1');
    expect(new Set(stored?.keys())).toEqual(
      new Set(
        [
          files.boot?.path,
          files.core.path,
          files.aliases.path,
          files.recent?.path,
          files.details?.path,
          'gacat-local.json',
          'manifest.json',
        ].map((path) => `${BASE}${path}`),
      ),
    );
    // El núcleo en uso es el núcleo, nunca el de arranque.
    const local = stored?.get(`${BASE}gacat-local.json`)?.body as ArrayBuffer;
    expect(JSON.parse(new TextDecoder().decode(local))).toMatchObject({ path: files.core.path });
  });

  it('un núcleo de arranque que no vale (sha256, 404 o cabecera) se ignora: de `none` a `scan` sin error', async () => {
    // Con la cabecera del núcleo (`#gacat-core v1`), el lector del de arranque lo rechaza.
    const otherHeader = serializeCore(ROWS.slice(0, BOOT), { version: '20261028.1' });
    const cases = [
      { boot: BOOT, spoil: (s: SpoilTarget, path: string) => s.corrupted.add(path) },
      { boot: BOOT, spoil: (s: SpoilTarget, path: string) => s.missing.add(path) },
      { boot: otherHeader, spoil: () => undefined },
    ];
    for (const { boot, spoil } of cases) {
      const caches = new MemoryCacheStorage();
      const t = setupBoot({ caches });
      const published = await withBoot(boot);
      const path = published.manifest.files.boot?.path as string;
      t.server.serve(published);
      spoil(t.server.state, path);
      t.send(init);
      await t.reach('full');
      expect(statesOf(t)).toEqual(['none', 'scan', 'full']);
      expect(t.statuses().every((s) => s.error === null)).toBe(true);
      // Uno que no se ha podido comprobar no se guarda.
      if (boot === BOOT) {
        expect(caches.stores.get('gacat-20261028.1')?.has(`${BASE}${path}`)).toBe(false);
      }
    }
  });

  it('en `boot`, la ficha y `lookup` responden si está en él; el Catálogo y `matchExact`, en `scan`', async () => {
    let hold: 'boot' | null = 'boot';
    const t = setupBoot({ hooks: { hold: () => hold, beforeLoad() {} } });
    t.server.serve(await withBoot());
    t.send(init);
    await t.reach('boot');
    expect(t.request('game', { appid: 730 })()).toMatchObject({ game: { appid: 730 } });
    expect(t.request('lookup', { appids: [730, 367520] })()).toMatchObject({ missing: [] });
    const game = t.request('game', { appid: 504230 });
    const lookup = t.request('lookup', { appids: [730, 504230] });
    const browse = t.request('browse', { viewId: 'v', q: '', filters: {} });
    const exact = t.request('matchExact', { title: 'hades ii' });
    await settle();
    expect([game(), lookup(), browse(), exact()]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);

    hold = null;
    t.host.resume();
    await t.scheduler.runUntil(() => exact() !== undefined);
    expect(t.lastStatus()?.state).not.toBe('boot');
    expect(game()).toMatchObject({ game: { appid: 504230, name: 'Celeste' } });
    expect(lookup()).toMatchObject({ missing: [] });
    expect(browse()).toMatchObject({ count: ROWS.length - ADULTS });
    expect(exact()).toMatchObject({ appids: [1145350] });
  });

  it('si el núcleo no llega en `boot`, sigue buscando en él, lo dice y repite la carga con espera', async () => {
    const cut = gate();
    let offline = true;
    const t = setupBoot({ wrapFetch: holdCore(cut.opened, () => offline) });
    const published = await withBoot();
    t.server.serve(published);
    t.send(init);
    await t.reach('boot');
    const exact = t.request('matchExact', { title: 'hades ii' });
    const game = t.request('game', { appid: 504230 });
    expect(exact()).toBeUndefined();
    cut.open();
    await t.scheduler.runUntil(() => t.lastStatus()?.error != null);
    expect(t.lastStatus()).toMatchObject({
      state: 'boot',
      version: '20261028.1',
      error: { code: 'network', retryable: true },
    });
    // Lo que esperaba se responde con lo que hay, y se sigue buscando en los más populares.
    expect(exact()).toMatchObject({ appids: [] });
    expect(game()).toMatchObject({ game: null });
    t.send({ type: 'query', seq: 1, q: 'elden', limit: 8 });
    expect(t.results(1)?.items[0]?.appid).toBe(1245620);
    expect(t.timers.pending).toEqual([RETRY_MIN_MS]);

    // El reintento carga el núcleo sin volver a bajar el de arranque ni los alias.
    offline = false;
    t.server.reset();
    t.timers.fire();
    await t.reach('full');
    const { files } = published.manifest;
    expect(pathsOf(t)).toEqual([
      'manifest.json',
      files.core.path,
      files.recent?.path,
      files.details?.path,
    ]);
    expect(t.lastStatus()?.error).toBeNull();
    expect(statesOf(t).slice(-3)).toEqual(['boot', 'scan', 'full']);
  });

  it('con el error en `boot`, la vuelta de la red y «Reintentar» repiten la carga (una sola vez)', async () => {
    for (const how of ['online', 'retry'] as const) {
      let offline = true;
      const t = setupBoot({ wrapFetch: holdCore(Promise.resolve(), () => offline) });
      const published = await withBoot();
      t.server.serve(published);
      t.send(init);
      await t.scheduler.runUntil(
        () => t.lastStatus()?.state === 'boot' && t.lastStatus()?.error != null,
      );
      offline = false;
      t.server.reset();
      if (how === 'online') t.host.online();
      else t.request('retry', {});
      // Mientras carga, otra vuelta de la red no empieza otra descarga.
      t.host.online();
      await t.reach('full');
      const core = published.manifest.files.core.path;
      expect(pathsOf(t).filter((path) => path === core)).toHaveLength(1);
      expect(t.lastStatus()?.error).toBeNull();

      // El reintento que quedó programado ya sobra: no vuelve a pedir el *manifest*.
      expect(t.timers.pending).toEqual([RETRY_MIN_MS]);
      t.server.reset();
      t.timers.fire();
      await settle();
      expect(pathsOf(t)).toEqual([]);
    }
  });

  it('la consulta repetida al salir de `boot` abandona las sugerencias que se estaban calculando', async () => {
    let hold: 'boot' | null = 'boot';
    const t = setupBoot({ hooks: { hold: () => hold, beforeLoad() {} } });
    t.server.serve(await withBoot());
    t.send(init);
    await t.reach('boot');
    // En `boot` se piden sugerencias; antes de que esté uFuzzy, el cliente repite la consulta
    // (con el mismo `seq`), como hace al pasar a `scan`.
    t.send({ type: 'query', seq: 1, q: 'celestte', limit: 8 });
    t.send({ type: 'suggest', seq: 1 });
    t.send({ type: 'query', seq: 1, q: 'celestte', limit: 8 });
    hold = null;
    t.host.resume();
    await t.reach('full');
    await settle();
    expect(t.suggestions(1)).toBeUndefined();
    // Las que pide después salen del catálogo entero.
    t.send({ type: 'query', seq: 1, q: 'celestte', limit: 8 });
    t.send({ type: 'suggest', seq: 1 });
    await t.scheduler.runUntil(() => t.suggestions(1) !== undefined);
    expect(t.suggestions(1)?.items.map((i) => i.appid)).toContain(504230);
  });

  it('si la primera visita se corta tras el núcleo de arranque, la siguiente lo lee de la caché', async () => {
    const caches = new MemoryCacheStorage();
    const published = await withBoot();
    const first = setupBoot({ caches, wrapFetch: holdCore(Promise.resolve(), () => true) });
    first.server.serve(published);
    first.send(init);
    await first.scheduler.runUntil(
      () => first.lastStatus()?.state === 'boot' && first.lastStatus()?.error != null,
    );

    const again = setupBoot({ caches });
    again.server.serve(published);
    again.send(init);
    await again.reach('full');
    const { files } = published.manifest;
    expect(pathsOf(again)).toEqual([
      'manifest.json',
      files.core.path,
      files.recent?.path,
      files.details?.path,
    ]);
    expect(statesOf(again)).toEqual(['none', 'boot', 'scan', 'full']);
  });

  it('con el catálogo en la caché no se pide: ni al arrancar ni al actualizar (CA2.4)', async () => {
    const caches = new MemoryCacheStorage();
    const first = setupBoot({ caches });
    first.server.serve(await withBoot());
    first.send(init);
    await first.reach('full');

    // Al día siguiente, otro núcleo de arranque: no se baja.
    const t = setupBoot({ caches });
    const v2 = await publish('20261029.1', NEWER_ROWS, undefined, {
      recent: [BALATRO],
      fileVersion: '20261028.1',
      boot: BOOT,
    });
    t.server.serve(v2);
    t.server.reset();
    t.send(init);
    await t.reach('full', '20261029.1');
    expect(pathsOf(t)).toEqual(['manifest.json', v2.manifest.files.recent?.path]);
    expect(statesOf(t)).toEqual(['none', 'scan', 'full']);
  });

  it('el índice que se guarda y se restaura es el del núcleo, nunca el de arranque', async () => {
    const idx = memoryIndex();
    const caches = new MemoryCacheStorage();
    const first = setupBoot({ caches, searchIndex: idx, indexBuild: 'build-a' });
    const published = await withBoot();
    first.server.serve(published);
    first.send(init);
    await first.reach('full');
    await first.scheduler.runUntil(() => idx.writes.length === 1);
    const { files } = published.manifest;
    expect(idx.writes[0]).toBe(
      `2|build-a|${files.core.sha256}|${files.recent?.sha256}|${files.aliases.sha256}`,
    );

    const again = setupBoot({ caches, searchIndex: idx, indexBuild: 'build-a' });
    again.server.serve(published);
    again.send(init);
    await again.reach('full');
    await again.scheduler.runUntil(() => manifestRequests(again) === 1);
    await settle();
    expect(statesOf(again)).toEqual(['none', 'full']);
    expect(again.lastStatus()?.count).toBe(ROWS.length - ADULTS);
    expect(pathsOf(again)).toEqual(['manifest.json']);
  });

  it('«Actualizar catálogo» y la vuelta de la red en `boot` esperan a la carga: un solo núcleo', async () => {
    const slow = gate();
    const t = setupBoot({ wrapFetch: holdCore(slow.opened, () => false) });
    const published = await withBoot();
    t.server.serve(published);
    t.send(init);
    await t.reach('boot');
    const refresh = t.request('refresh', {});
    t.host.online();
    await settle();
    expect(refresh()).toBeUndefined();
    slow.open();
    await t.scheduler.runUntil(() => refresh() !== undefined && t.lastStatus()?.state === 'full');
    expect(refresh()).toMatchObject({ type: 'refresh' });
    const core = `${BASE}${published.manifest.files.core.path}`;
    expect(t.server.state.requests.filter((url) => url === core)).toHaveLength(1);
  });

  it('un 404 del núcleo en `boot` relee el manifest y sigue con la versión nueva (§5.4)', async () => {
    const caches = new MemoryCacheStorage();
    const v1 = await withBoot();
    const v2 = await publish('20261029.1', NEWER_ROWS, undefined, { boot: BOOT });
    let manifests = 0;
    // El primer *manifest* es el de antes del despliegue: su núcleo ya no está.
    const t = setupBoot({
      caches,
      wrapFetch: (inner) =>
        (async (input: RequestInfo | URL, init?: RequestInit) => {
          if (String(input).endsWith('manifest.json') && manifests++ === 0) {
            return Response.json(v1.manifest);
          }
          return inner(input, init);
        }) as typeof fetch,
    });
    t.server.serve(v1);
    t.server.serve(v2);
    t.server.drop(v1.manifest.files.core.path);
    t.send(init);
    await t.reach('full', '20261029.1');
    const seen: string[] = [];
    for (const { state, version } of t.statuses()) {
      const step = `${state} ${version}`;
      if (state !== 'none' && seen.at(-1) !== step) seen.push(step);
    }
    expect(seen).toEqual(['boot 20261028.1', 'scan 20261029.1', 'full 20261029.1']);
    expect(t.lastStatus()?.error).toBeNull();
    // La caché a medias de la versión anterior (el núcleo de arranque y los alias) se borra.
    expect(await caches.keys()).toEqual(['gacat-20261029.1']);
  });

  it('ganchos: con `none` no hay `boot`; con `boot`, el núcleo no se lee; con `scan`, se pasa por `boot`', async () => {
    for (const held of ['none', 'boot', 'scan'] as const) {
      let hold: typeof held | null = held;
      const t = setupBoot({ hooks: { hold: () => hold, beforeLoad() {} } });
      t.server.serve(await withBoot());
      t.send(init);
      // Descargado todo: el núcleo, en su sitio (`progress` ≥ 0,5 en `none` y en `boot`).
      await t.scheduler.runUntil(() => {
        const s = t.lastStatus();
        return s?.state === held && (held === 'scan' || s.progress >= 0.5);
      });
      await settle();
      expect(t.lastStatus()?.state).toBe(held);
      expect(statesOf(t)).toEqual(
        { none: ['none'], boot: ['none', 'boot'], scan: ['none', 'boot', 'scan'] }[held],
      );
      hold = null;
      t.host.resume();
      await t.reach('full');
      expect(statesOf(t)).toEqual(['none', 'boot', 'scan', 'full']);
    }
  });
});

type SpoilTarget = ReturnType<typeof catalogServer>['state'];
