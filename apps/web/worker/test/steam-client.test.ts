// «Importar desde Steam» en la app (`src/steam/steam-flow.ts`; ADR-012) contra la micro-API de
// verdad (`app.request()`, D1 sobre `node:sqlite` y Steam falso): el canje tipo PKCE de punta a
// punta, la vuelta a la app y cada estado.

import { STEAM_TICKET_TTL_MS } from '@gameagenda/core/api';
import { describe, expect, it } from 'vitest';
import { SteamImportFlow, type SteamImportState } from '../../src/steam/steam-flow.ts';
import { createHarness, type Harness, ORIGIN } from './harness.ts';
import { OWNED_PRIVATE_FIXTURE } from './steam-support.ts';

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
}

function setup(h = createHarness()): Setup {
  const page = new FakePage();
  const requests: Setup['requests'] = [];
  const net = { offline: false };
  const flow = new SteamImportFlow({
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
      return h.app.request(`${ORIGIN}${path}`, { method, body, signal, headers }, h.env);
    },
  });
  return { h, flow, page, requests, net };
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
          { appid: 413150, name: 'Stardew Valley', minutes: 6120, lastPlayedAt: 1762905600000 },
          { appid: 1145360, name: 'Hades', minutes: 0, lastPlayedAt: null },
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
    await new Promise((resolve) => setTimeout(resolve, 5));
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
    await new Promise((resolve) => setTimeout(resolve, 5));
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
    await new Promise((resolve) => setTimeout(resolve, 5));
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
