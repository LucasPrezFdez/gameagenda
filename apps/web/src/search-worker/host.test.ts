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
import { createCatalogStore } from './catalog-store.ts';
import { createSearchHost, type HostTestHooks } from './host.ts';
import {
  catalogServer,
  MemoryCacheStorage,
  manualScheduler,
  publish,
  ROWS,
} from './test-helpers.ts';

const BASE = 'http://127.0.0.1/catalog-dev/';
const ADULTS = 1;

type Reply = Extract<WorkerToUiMessage, { reqId: number }>;

interface SetupOptions {
  readonly hooks?: HostTestHooks;
  readonly caches?: MemoryCacheStorage;
  /** Reloj falso: con uno que avanza en cada lectura, la construcción se reparte en bloques. */
  readonly now?: () => number;
}

function setup(options: SetupOptions = {}) {
  const server = catalogServer(BASE);
  const caches = options.caches ?? new MemoryCacheStorage();
  const scheduler = manualScheduler();
  const out: WorkerToUiMessage[] = [];
  const host = createSearchHost({
    post: (message) => out.push(structuredClone(message)),
    now: options.now ?? (() => performance.now()),
    schedule: scheduler.schedule,
    store: createCatalogStore({
      fetch: server.fetch,
      caches: caches.asCacheStorage(),
      subtle: crypto.subtle,
      baseUrl: BASE,
      appVersion: '0.1.0',
    }),
    loadFuzzy,
    progressIntervalMs: 0,
    testHooks: options.hooks ?? null,
  });
  let reqId = 0;
  const send = (message: UiToWorkerMessage) => host.handle(structuredClone(message));
  const statuses = () => out.filter((m): m is StatusMessage => m.type === 'status');
  const lastStatus = () => statuses().at(-1);
  return {
    server,
    scheduler,
    host,
    send,
    statuses,
    lastStatus,
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
    offline.server.serve(await publish('20261029.1', newer));
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
