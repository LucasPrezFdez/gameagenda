// «Importar desde Steam» en la app (`src/steam/steam-flow.ts`; ADR-012) contra la micro-API de
// verdad (`app.request()`, D1 sobre `node:sqlite` y Steam falso): el canje tipo PKCE de punta a
// punta, la vuelta a la app y cada estado. Con una agenda (Dexie sobre `fake-indexeddb`), la
// parte 3: los logros, el resumen, aplicar y deshacer.

import { STEAM_ACHIEVEMENTS_BATCH, STEAM_TICKET_TTL_MS } from '@gameagenda/core/api';
import { isLive } from '@gameagenda/core/entries';
import { describe, expect, it } from 'vitest';
import { newBrowser, openTab, type TestTab } from '../../src/agenda/test-support.ts';
import {
  type SteamFlowDeps,
  SteamImportFlow,
  type SteamImportState,
} from '../../src/steam/steam-flow.ts';
import { createHarness, type Harness, ORIGIN } from './harness.ts';
import {
  ACHIEVEMENTS_API_PREFIX,
  ACHIEVEMENTS_FIXTURES,
  bigLibrary,
  COMPLETE_AT,
  OWNED_PRIVATE_FIXTURE,
} from './steam-support.ts';

/** `window` y `document` falsos: solo los eventos de la vuelta a la app. */
class FakePage {
  readonly win = new EventTarget();
  readonly doc = Object.assign(new EventTarget(), {
    visibilityState: 'visible' as DocumentVisibilityState,
  });

  /** Vuelve a la app: foco y vuelta a la vista, a la vez, como en un navegador. */
  comeBack(): void {
    this.doc.visibilityState = 'visible';
    this.doc.dispatchEvent(new Event('visibilitychange'));
    this.win.dispatchEvent(new Event('focus'));
  }
}

interface Setup {
  h: Harness;
  flow: SteamImportFlow;
  page: FakePage;
  /** Lo que la app ha pedido a `/api`, con sus opciones. */
  requests: { path: string; init: RequestInit }[];
  net: { offline: boolean };
  /** Las peticiones en vuelo (ver `settle`). */
  inflight: Set<Promise<unknown>>;
}

function setup(h = createHarness(), extra: Partial<SteamFlowDeps> = {}): Setup {
  const page = new FakePage();
  const requests: Setup['requests'] = [];
  const net = { offline: false };
  const inflight = new Set<Promise<unknown>>();
  const flow = new SteamImportFlow({
    ...extra,
    win: page.win as unknown as Window,
    doc: page.doc as unknown as Document,
    async fetch(path, init) {
      requests.push({ path, init });
      if (net.offline) throw new TypeError('Failed to fetch');
      // Como el navegador: `Origin` lo pone él, y Cloudflare, la IP.
      const headers = new Headers(init.headers);
      headers.set('Origin', ORIGIN);
      headers.set('CF-Connecting-IP', '192.0.2.50');
      const { method, body, signal } = init;
      const response = Promise.resolve(
        h.app.request(`${ORIGIN}${path}`, { method, body, signal, headers }, h.env),
      );
      inflight.add(response);
      void response.finally(() => inflight.delete(response)).catch(() => {});
      return response;
    },
  });
  return { h, flow, page, requests, net, inflight };
}

/**
 * Espera a que acaben las peticiones en vuelo y a que el flujo las procese. Un tiempo fijo no vale:
 * en el *runner* del CI, el canje automático de la vuelta a la app seguía en vuelo a los 5 ms.
 */
async function settle(s: Setup): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await Promise.allSettled([...s.inflight]);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** Lo que haría Steam al iniciar sesión en la otra ventana: la vuelta a `callback`. */
async function signInOnSteam(s: Setup, steamId?: string): Promise<number> {
  const state = s.flow.getSnapshot();
  if (state.kind !== 'ready' && state.kind !== 'waiting') throw new Error(state.kind);
  const returnTo = new URL(state.url).searchParams.get('openid.return_to') ?? '';
  const assertion = s.h.steam.openid.assertion(returnTo, steamId === undefined ? {} : { steamId });
  const ticket = new URL(returnTo).searchParams.get('t') ?? '';
  return (await s.h.client().get(`/api/v1/steam/callback?t=${ticket}&${assertion}`)).status;
}

/** Espera a que el flujo llegue a un estado (las peticiones van por microtareas). */
async function until(s: Setup, kind: SteamImportState['kind']): Promise<SteamImportState> {
  for (let i = 0; i < 200; i++) {
    const state = s.flow.getSnapshot();
    if (state.kind === kind) return state;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`no llega a ${kind}: ${s.flow.getSnapshot().kind}`);
}

const paths = (s: Setup) => s.requests.map((r) => r.path);

describe('de punta a punta', () => {
  it('empezar, Steam en otra ventana, volver a la app: la biblioteca y los deseados', async () => {
    const s = setup();
    const seen: string[] = [];
    s.flow.subscribe(() => seen.push(s.flow.getSnapshot().kind));
    await s.flow.start();
    const ready = s.flow.getSnapshot();
    expect(ready.kind).toBe('ready');
    if (ready.kind !== 'ready') return;
    expect(ready.url.startsWith('https://steamcommunity.com/openid/login?')).toBe(true);
    s.flow.opened();
    expect(s.flow.getSnapshot()).toMatchObject({ kind: 'waiting', stillPending: false });
    expect(await signInOnSteam(s)).toBe(200);
    s.page.comeBack();
    const done = await until(s, 'done');
    expect(done).toMatchObject({
      kind: 'done',
      library: {
        visibility: 'public',
        skipped: 0,
        owned: expect.arrayContaining([
          {
            appid: 413150,
            name: 'Stardew Valley',
            minutes: 6120,
            lastPlayedAt: 1762905600000,
            stats: true,
          },
          { appid: 1145360, name: 'Hades', minutes: 0, lastPlayedAt: null, stats: true },
        ]),
        wishlist: [
          { appid: 1086940, priority: 1, addedAt: 1700000000000 },
          { appid: 367520, priority: 2, addedAt: 1710000000000 },
          { appid: 1245620, priority: 0, addedAt: 1720000000000 },
        ],
      },
    });
    if (done.kind === 'done') expect(done.library.owned).toHaveLength(4);
    expect(seen).toEqual(['starting', 'ready', 'waiting', 'loading', 'done']);
    // Foco y vuelta a la vista llegan juntos: un solo canje.
    expect(paths(s)).toEqual(['/api/v1/steam/start', '/api/v1/steam/redeem']);
    for (const { init } of s.requests) {
      expect(init).toMatchObject({
        method: 'POST',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
    }
    // Ya no escucha la vuelta a la app.
    s.page.comeBack();
    await settle(s);
    expect(s.requests).toHaveLength(2);
  });

  it('el verificador no sale de la app hasta el canje, y start solo lleva el challenge', async () => {
    const s = setup();
    await s.flow.start();
    const start = JSON.parse(String(s.requests[0]?.init.body));
    expect(Object.keys(start)).toEqual(['challenge']);
    s.flow.opened();
    await signInOnSteam(s);
    await s.flow.redeem(true);
    const redeem = JSON.parse(String(s.requests[1]?.init.body));
    expect(Object.keys(redeem).sort()).toEqual(['ticket', 'verifier']);
    expect(redeem.verifier).not.toBe(start.challenge);
  });
});

describe('volver antes de terminar en Steam', () => {
  it('al volver sola, sigue esperando sin decir nada; con «Ya he iniciado sesión», lo dice', async () => {
    const s = setup();
    await s.flow.start();
    s.flow.opened();
    s.page.comeBack();
    await settle(s);
    expect(s.flow.getSnapshot()).toMatchObject({ kind: 'waiting', stillPending: false });
    await s.flow.redeem(true);
    expect(s.flow.getSnapshot()).toMatchObject({ kind: 'waiting', stillPending: true });
    await signInOnSteam(s);
    s.page.comeBack();
    await until(s, 'done');
  });

  it('volver a la app sin haber pulsado el botón de Steam no canjea', async () => {
    const s = setup();
    await s.flow.start();
    s.page.comeBack();
    await settle(s);
    expect(paths(s)).toEqual(['/api/v1/steam/start']);
  });
});

describe('lo que puede salir mal', () => {
  it('el ticket caducado: volver a empezar, y vale el nuevo', async () => {
    const s = setup();
    await s.flow.start();
    s.flow.opened();
    await signInOnSteam(s);
    s.h.clock.ms += STEAM_TICKET_TTL_MS;
    await s.flow.redeem(true);
    expect(s.flow.getSnapshot()).toEqual({ kind: 'failed', reason: 'expired', retry: false });
    await s.flow.start();
    s.flow.opened();
    await signInOnSteam(s);
    await s.flow.redeem(true);
    expect(s.flow.getSnapshot().kind).toBe('done');
  });

  it('sin red al canjear: reintentar con el mismo ticket', async () => {
    const s = setup();
    await s.flow.start();
    s.flow.opened();
    await signInOnSteam(s);
    s.net.offline = true;
    await s.flow.redeem(true);
    expect(s.flow.getSnapshot()).toEqual({ kind: 'failed', reason: 'offline', retry: true });
    s.net.offline = false;
    await s.flow.redeem(true);
    expect(s.flow.getSnapshot().kind).toBe('done');
  });

  it('sin red al empezar: volver a empezar', async () => {
    const s = setup();
    s.net.offline = true;
    await s.flow.start();
    expect(s.flow.getSnapshot()).toEqual({ kind: 'failed', reason: 'offline', retry: false });
  });

  it('el perfil privado: done con visibility private', async () => {
    const s = setup();
    s.h.steam.webapi.owned = OWNED_PRIVATE_FIXTURE;
    await s.flow.start();
    s.flow.opened();
    await signInOnSteam(s);
    await s.flow.redeem(true);
    expect(s.flow.getSnapshot()).toMatchObject({
      kind: 'done',
      library: { visibility: 'private', owned: [] },
    });
  });

  it('con la importación apagada en el servidor: disabled', async () => {
    const s = setup(createHarness({ STEAM_ENABLED: '0' }));
    await s.flow.start();
    expect(s.flow.getSnapshot()).toEqual({ kind: 'failed', reason: 'disabled', retry: false });
  });

  it('con el tope del día lleno: busy', async () => {
    const s = setup(createHarness({}, { steamDailyCalls: 1 }));
    await s.flow.start();
    s.flow.opened();
    await signInOnSteam(s);
    await s.flow.redeem(true);
    expect(s.flow.getSnapshot()).toEqual({ kind: 'failed', reason: 'busy', retry: false });
  });

  it('con demasiados intentos: rateLimited, y reintentar vale (el ticket sigue vivo)', async () => {
    const s = setup();
    await s.flow.start();
    s.flow.opened();
    await signInOnSteam(s);
    s.h.limits.steam.max = 1;
    await s.flow.redeem(true);
    expect(s.flow.getSnapshot()).toEqual({ kind: 'failed', reason: 'rateLimited', retry: true });
    s.h.limits.steam.max = Number.POSITIVE_INFINITY;
    await s.flow.redeem(true);
    expect(s.flow.getSnapshot().kind).toBe('done');
  });

  for (const fail of ['status', 'huge'] as const) {
    it(`si Steam falla (${fail}): unavailable, y hay que volver a empezar`, async () => {
      const s = setup();
      s.h.steam.webapi.ownedFail = fail;
      await s.flow.start();
      s.flow.opened();
      await signInOnSteam(s);
      await s.flow.redeem(true);
      expect(s.flow.getSnapshot()).toEqual({
        kind: 'failed',
        reason: 'unavailable',
        retry: false,
      });
    });
  }

  it('«Cancelar» con un canje en vuelo: lo que llega se descarta', async () => {
    const s = setup();
    await s.flow.start();
    s.flow.opened();
    await signInOnSteam(s);
    const redeeming = s.flow.redeem(true);
    s.flow.reset();
    await redeeming;
    expect(s.flow.getSnapshot()).toEqual({ kind: 'idle' });
  });
});

// --- Parte 3 ---------------------------------------------------------------------------------

/** El 20-11-2025: Outer Wilds (última partida el 19-11-2025) cuenta como «jugado hace poco». */
const NOW = Date.UTC(2025, 10, 20, 12);
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

interface Part3 extends Setup {
  tab: TestTab;
}

async function setup3(h = createHarness(), extra: Partial<SteamFlowDeps> = {}): Promise<Part3> {
  const tab = await openTab(newBrowser());
  const s = setup(h, {
    agenda: tab.agenda,
    catalogTitles: async (appids) =>
      new Map(appids.filter((a) => a === 220).map((a) => [a, 'Half-Life 2 (catálogo)'])),
    fallbackTitle: (appid) => `Juego de Steam ${appid}`,
    dayOf: utcDay,
    now: () => NOW,
    applyOptions: { pause: async () => {} },
    ...extra,
  });
  // Outer Wilds, con todos los logros; Half-Life 2, con alguno; Stardew Valley, sin logros.
  h.steam.webapi.achievements.set(753640, ACHIEVEMENTS_FIXTURES.complete);
  h.steam.webapi.achievements.set(220, ACHIEVEMENTS_FIXTURES.incomplete);
  h.steam.webapi.achievements.set(413150, ACHIEVEMENTS_FIXTURES.noAchievements);
  return { ...s, tab };
}

/** Inicia sesión, vuelve a la app y espera al resumen. */
async function toReview(s: Setup): Promise<Extract<SteamImportState, { kind: 'review' }>> {
  await s.flow.start();
  s.flow.opened();
  await signInOnSteam(s);
  s.page.comeBack();
  const review = await until(s, 'review');
  if (review.kind !== 'review') throw new Error(review.kind);
  return review;
}

const achievementRequests = (s: Setup) =>
  s.requests.filter((r) => r.path === '/api/v1/steam/achievements');

describe('parte 3: logros, resumen, aplicar y deshacer', () => {
  it('de punta a punta: el resumen no toca la agenda; Aplicar sí; Deshacer lo quita todo', async () => {
    const s = await setup3();
    const seen: string[] = [];
    s.flow.subscribe(() => seen.push(s.flow.getSnapshot().kind));
    const review = await toReview(s);
    expect(review.plan.counts).toEqual({
      added: {
        playing: 1,
        on_hold: 1,
        want_to_play: 0,
        completed: 1,
        dropped: 0,
        not_started: 1,
        multiplayer: 0,
      },
      wishes: 0,
      markedOwned: 0,
      platinum: 1,
      unchanged: 0,
    });
    expect(review).toMatchObject({ wishes: 3, withWishlist: false, unknown: 0 });
    // Los logros, solo de los jugados con estadísticas (Hades, sin jugar, no), en un lote.
    expect(achievementRequests(s)).toHaveLength(1);
    expect(JSON.parse(String(achievementRequests(s)[0]?.init.body)).appids).toEqual([
      220, 413150, 753640,
    ]);
    expect(s.tab.agenda.allEntries()).toEqual([]);
    expect(seen).toEqual([
      'starting',
      'ready',
      'waiting',
      'loading',
      'checking',
      'checking',
      'review',
    ]);

    s.flow.setWishlist(true);
    expect(s.flow.getSnapshot()).toMatchObject({ kind: 'review', withWishlist: true });
    await s.flow.apply();
    expect(s.flow.getSnapshot()).toMatchObject({
      kind: 'applied',
      canUndo: true,
      counts: { wishes: 3, platinum: 1 },
    });
    await s.tab.agenda.whenIdle();
    const get = (id: string) => s.tab.agenda.get(id);
    expect(get('steam:753640')).toMatchObject({
      status: 'completed',
      flags: { owned: true, platinum: true },
      completedAt: utcDay(COMPLETE_AT * 1000),
      platinumAt: utcDay(COMPLETE_AT * 1000),
      title: 'Outer Wilds',
    });
    expect(get('steam:220')).toMatchObject({
      status: 'on_hold',
      flags: { owned: true },
      title: 'Half-Life 2 (catálogo)',
    });
    expect(get('steam:413150')).toMatchObject({ status: 'playing', flags: { owned: true } });
    // Sin jugar: Sin empezar, nunca Quiero jugar (eso lo decide el usuario).
    expect(get('steam:1145360')).toMatchObject({ status: 'not_started', flags: { owned: true } });
    for (const appid of [1086940, 367520, 1245620]) {
      expect(get(`steam:${appid}`)).toMatchObject({
        status: 'want_to_play',
        title: `Juego de Steam ${appid}`,
      });
      expect(get(`steam:${appid}`)?.flags.owned ?? false).toBe(false);
    }
    // El alta compacta: 9 + 6 × 3 de la biblioteca y 5 × 3 de los deseados.
    expect(await s.tab.db.outbox.count()).toBe(9 + 6 * 3 + 5 * 3);

    s.flow.undo();
    expect(s.flow.getSnapshot()).toEqual({ kind: 'undone' });
    await s.tab.agenda.whenIdle();
    expect(s.tab.agenda.allEntries().filter((e) => isLive(e))).toEqual([]);
    s.flow.reset();
    await s.tab.close();
  });

  it('lo ya apuntado no cambia de estado: gana Comprado (y Platinado si toca)', async () => {
    const s = await setup3();
    s.tab.agenda.capture({ id: 'steam:1145360', title: 'Hades' }, { status: 'dropped' });
    s.tab.agenda.capture({ id: 'steam:753640', title: 'Outer Wilds' }, { status: 'playing' });
    const review = await toReview(s);
    expect(review.plan.counts).toMatchObject({ markedOwned: 2, platinum: 1 });
    await s.flow.apply();
    expect(s.tab.agenda.get('steam:1145360')).toMatchObject({
      status: 'dropped',
      flags: { owned: true },
    });
    expect(s.tab.agenda.get('steam:753640')).toMatchObject({
      status: 'completed',
      flags: { owned: true, platinum: true },
    });
    await s.tab.close();
  });

  it('un Platinado de la agenda no se vuelve a preguntar a Steam', async () => {
    const s = await setup3();
    s.tab.agenda.capture(
      { id: 'steam:753640', title: 'Outer Wilds' },
      { flags: { platinum: true } },
    );
    await toReview(s);
    expect(JSON.parse(String(achievementRequests(s)[0]?.init.body)).appids).toEqual([220, 413150]);
    await s.tab.close();
  });

  it('lo que se apunta mientras se mira el resumen no se pisa', async () => {
    const s = await setup3();
    await toReview(s);
    s.tab.agenda.capture({ id: 'steam:220', title: 'Half-Life 2' }, { status: 'completed' });
    await s.flow.apply();
    expect(s.tab.agenda.get('steam:220')).toMatchObject({ status: 'completed', flags: {} });
    await s.tab.close();
  });

  it('los logros, en lotes de 40, con el progreso', async () => {
    const h = createHarness();
    h.steam.webapi.owned = bigLibrary(150);
    const s = await setup3(h);
    const checking: number[] = [];
    s.flow.subscribe(() => {
      const state = s.flow.getSnapshot();
      if (state.kind === 'checking') checking.push(state.done);
    });
    const review = await toReview(s);
    const library = JSON.parse(bigLibrary(150)).response.games as Array<{
      playtime_forever: number;
      has_community_visible_stats: boolean;
    }>;
    const candidates = library.filter(
      (g) => g.playtime_forever > 0 && g.has_community_visible_stats,
    );
    const batches = Math.ceil(candidates.length / STEAM_ACHIEVEMENTS_BATCH);
    expect(achievementRequests(s)).toHaveLength(batches);
    expect(h.steam.calls.filter((u) => u.startsWith(ACHIEVEMENTS_API_PREFIX))).toHaveLength(
      candidates.length,
    );
    expect(checking[0]).toBe(0);
    expect(checking.at(-1)).toBe(candidates.length);
    // Sin logros en el Steam falso: «sin estadísticas», ninguno desconocido.
    expect(review.unknown).toBe(0);
    await s.tab.close();
  });

  it('si un lote de logros falla (el tope del día), sigue sin ellos y lo dice', async () => {
    const h = createHarness({}, { steamDailyCalls: 3 });
    const s = await setup3(h);
    const review = await toReview(s);
    expect(review.unknown).toBe(3);
    expect(review.plan.counts.platinum).toBe(0);
    expect(review.plan.counts.added.completed).toBe(0);
    await s.tab.close();
  });

  it('un juego con los logros ocultos cuenta como desconocido', async () => {
    const s = await setup3();
    s.h.steam.webapi.achievements.set(220, ACHIEVEMENTS_FIXTURES.private);
    expect((await toReview(s)).unknown).toBe(1);
    await s.tab.close();
  });

  it('«Cancelar» en el resumen: no cambia nada y empieza de cero', async () => {
    const s = await setup3();
    await toReview(s);
    s.flow.reset();
    expect(s.flow.getSnapshot()).toEqual({ kind: 'idle' });
    await s.flow.apply();
    expect(s.tab.agenda.allEntries()).toEqual([]);
    await s.tab.close();
  });

  it('con todo ya al día, el resumen lo dice y no hay nada que aplicar', async () => {
    const s = await setup3();
    for (const [id, title] of [
      ['steam:220', 'A'],
      ['steam:413150', 'B'],
      ['steam:1145360', 'C'],
      ['steam:753640', 'D'],
    ] as const) {
      s.tab.agenda.capture(
        { id, title },
        { flags: { owned: true, platinum: id === 'steam:753640' } },
      );
    }
    const review = await toReview(s);
    expect(review.plan.items).toEqual([]);
    expect(review.plan.counts.unchanged).toBe(4);
    await s.tab.close();
  });

  it('sin agenda (la parte 2), acaba en done, como antes', async () => {
    const s = setup();
    await s.flow.start();
    s.flow.opened();
    await signInOnSteam(s);
    s.page.comeBack();
    expect((await until(s, 'done')).kind).toBe('done');
    expect(achievementRequests(s)).toEqual([]);
  });
});
