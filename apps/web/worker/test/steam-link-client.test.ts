// Steam vinculado en la app (ADR-014), contra la micro-API de verdad: vincular desde «Importar
// desde Steam» (el canje va a `steam/link`, con la cookie del dispositivo) y la actualización diaria
// (`src/steam/auto-refresh.ts`): trae la biblioteca sin login, aplica lo nuevo sin resumen, pide los
// logros solo de lo jugado hace poco y no vuelve a añadir lo que el usuario quitó.

import { STEAM_REFRESH_MIN_INTERVAL_MS } from '@gameagenda/core/api';
import { isLive } from '@gameagenda/core/entries';
import { describe, expect, it } from 'vitest';
import { newBrowser, openTab } from '../../src/agenda/test-support.ts';
import { refreshFromSteam } from '../../src/steam/auto-refresh.ts';
import { type FetchLike, SteamImportFlow } from '../../src/steam/steam-flow.ts';
import { type Client, createAgenda, createHarness, type Harness, ORIGIN } from './harness.ts';
import { ACHIEVEMENTS_FIXTURES } from './steam-support.ts';

/** El 20-11-2025: Outer Wilds y Stardew Valley, jugados en las últimas dos semanas; Half-Life 2, no. */
const NOW = Date.UTC(2025, 10, 20, 12);
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** El `fetch` de la app: la cookie del dispositivo solo va con `credentials: 'same-origin'`. */
function appFetch(
  h: Harness,
  device: Client,
  seen: { path: string; init: RequestInit }[],
): FetchLike {
  return async (path, init) => {
    seen.push({ path, init });
    const headers = new Headers(init.headers);
    headers.set('Origin', ORIGIN);
    headers.set('CF-Connecting-IP', '192.0.2.60');
    if (init.credentials === 'same-origin' && device.cookies.size > 0) {
      headers.set(
        'Cookie',
        [...device.cookies].map(([name, value]) => `${name}=${value}`).join('; '),
      );
    }
    const { method, body } = init;
    return h.app.request(`${ORIGIN}${path}`, { method, body, headers }, h.env);
  };
}

async function setup() {
  const h = createHarness();
  const device = h.client();
  await createAgenda(device);
  const tab = await openTab(newBrowser());
  const seen: { path: string; init: RequestInit }[] = [];
  const fetch = appFetch(h, device, seen);
  h.steam.webapi.achievements.set(753640, ACHIEVEMENTS_FIXTURES.complete);
  h.steam.webapi.achievements.set(413150, ACHIEVEMENTS_FIXTURES.noAchievements);
  const deps = {
    fetch,
    agenda: tab.agenda,
    fallbackTitle: (appid: number) => `Juego de Steam ${appid}`,
    dayOf: utcDay,
    now: () => NOW,
    applyOptions: { pause: async () => {} },
  };
  return { h, device, tab, seen, fetch, deps };
}

/** Vincula desde el flujo de la importación, como la app con la casilla marcada. */
async function linkFromFlow(s: Awaited<ReturnType<typeof setup>>) {
  let linked = 0;
  const page = Object.assign(new EventTarget(), {
    visibilityState: 'visible' as DocumentVisibilityState,
  });
  const flow = new SteamImportFlow({
    ...s.deps,
    win: new EventTarget() as unknown as Window,
    doc: page as unknown as Document,
    onLinked: () => {
      linked += 1;
    },
  });
  await flow.start(true);
  const state = flow.getSnapshot();
  if (state.kind !== 'ready') throw new Error(state.kind);
  flow.opened();
  const returnTo = new URL(state.url).searchParams.get('openid.return_to') ?? '';
  const ticket = new URL(returnTo).searchParams.get('t') ?? '';
  const assertion = s.h.steam.openid.assertion(returnTo);
  await s.h.client().get(`/api/v1/steam/callback?t=${ticket}&${assertion}`);
  await flow.redeem(true);
  for (let i = 0; i < 200 && flow.getSnapshot().kind !== 'review'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  return { flow, linked: () => linked };
}

describe('vincular desde «Importar desde Steam»', () => {
  it('start y el canje (steam/link) van con la cookie; los logros y el software, sin ella', async () => {
    const s = await setup();
    const { flow, linked } = await linkFromFlow(s);
    expect(flow.getSnapshot().kind).toBe('review');
    expect(flow.isLinking()).toBe(true);
    expect(linked()).toBe(1);
    const link = s.seen.find((r) => r.path === '/api/v1/steam/link');
    expect(link?.init.credentials).toBe('same-origin');
    expect(s.seen.some((r) => r.path === '/api/v1/steam/redeem')).toBe(false);
    const withCookie = new Set(['/api/v1/steam/start', '/api/v1/steam/link']);
    expect(s.seen.find((r) => r.path === '/api/v1/steam/start')?.init.credentials).toBe(
      'same-origin',
    );
    for (const r of s.seen.filter((r) => !withCookie.has(r.path))) {
      expect(r.init.credentials, r.path).toBe('omit');
    }
    expect(s.h.db.rows('SELECT steam_id FROM steam_link')).toHaveLength(1);
  });

  it('sin marcar la casilla, como siempre: redeem, sin cookie y sin vínculo', async () => {
    const s = await setup();
    const flow = new SteamImportFlow({
      ...s.deps,
      win: new EventTarget() as unknown as Window,
      doc: Object.assign(new EventTarget(), { visibilityState: 'visible' }) as unknown as Document,
    });
    await flow.start(false);
    expect(flow.isLinking()).toBe(false);
    const state = flow.getSnapshot();
    if (state.kind !== 'ready') throw new Error(state.kind);
    const returnTo = new URL(state.url).searchParams.get('openid.return_to') ?? '';
    const ticket = new URL(returnTo).searchParams.get('t') ?? '';
    await s.h
      .client()
      .get(`/api/v1/steam/callback?t=${ticket}&${s.h.steam.openid.assertion(returnTo)}`);
    flow.opened();
    await flow.redeem(true);
    expect(s.seen.some((r) => r.path === '/api/v1/steam/redeem')).toBe(true);
    expect(s.seen.every((r) => r.init.credentials === 'omit')).toBe(true);
    expect(s.h.db.rows('SELECT * FROM steam_link')).toHaveLength(0);
  });
});

describe('la actualización diaria', () => {
  it('trae lo nuevo sin resumen y pide los logros solo de lo jugado hace poco', async () => {
    const s = await setup();
    const { flow } = await linkFromFlow(s);
    flow.reset();
    s.seen.length = 0;
    s.h.clock.ms += STEAM_REFRESH_MIN_INTERVAL_MS;
    const outcome = await refreshFromSteam(s.deps);
    expect(outcome.kind).toBe('applied');
    if (outcome.kind !== 'applied') return;
    expect(outcome.undo).not.toBeNull();
    // Los cuatro juegos de la biblioteca, ya en la agenda; Outer Wilds, platinado.
    const ids = ['steam:220', 'steam:413150', 'steam:1145360', 'steam:753640'];
    for (const id of ids) expect(isLive(s.tab.agenda.get(id)), id).toBe(true);
    expect(s.tab.agenda.get('steam:753640')?.flags.platinum).toBe(true);
    // Los logros: de Stardew Valley y Outer Wilds, no de Half-Life 2 (jugado en 2020).
    const asked = s.seen
      .filter((r) => r.path === '/api/v1/steam/achievements')
      .flatMap((r) => (JSON.parse(String(r.init.body)) as { appids: number[] }).appids);
    expect(asked.sort((a, b) => a - b)).toEqual([413150, 753640]);
    expect(s.seen.find((r) => r.path === '/api/v1/steam/refresh')?.init.credentials).toBe(
      'same-origin',
    );
    // Y «Deshacer» lo quita todo.
    outcome.undo?.();
    for (const id of ids) expect(isLive(s.tab.agenda.get(id)), id).toBe(false);
  });

  it('lo que el usuario quitó no vuelve', async () => {
    const s = await setup();
    await linkFromFlow(s);
    // Apuntado y quitado antes de la actualización.
    s.tab.agenda.capture({ id: 'steam:413150', title: 'Stardew Valley' });
    s.tab.agenda.remove('steam:413150');
    expect(isLive(s.tab.agenda.get('steam:413150'))).toBe(false);
    s.h.clock.ms += STEAM_REFRESH_MIN_INTERVAL_MS;
    const outcome = await refreshFromSteam(s.deps);
    expect(outcome.kind).toBe('applied');
    if (outcome.kind === 'applied') expect(outcome.counts.removed).toBe(1);
    expect(isLive(s.tab.agenda.get('steam:413150'))).toBe(false);
    expect(isLive(s.tab.agenda.get('steam:220'))).toBe(true);
  });

  it('dos veces seguidas: la segunda, tooSoon; sin vínculo, unlinked; sin cambios, unchanged', async () => {
    const s = await setup();
    expect((await refreshFromSteam(s.deps)).kind).toBe('unlinked');
    await linkFromFlow(s);
    expect((await refreshFromSteam(s.deps)).kind).toBe('tooSoon');
    s.h.clock.ms += STEAM_REFRESH_MIN_INTERVAL_MS;
    expect((await refreshFromSteam(s.deps)).kind).toBe('applied');
    s.h.clock.ms += STEAM_REFRESH_MIN_INTERVAL_MS;
    expect((await refreshFromSteam(s.deps)).kind).toBe('unchanged');
  });

  it('si Steam no responde, failed, y la vez no cuenta en el servidor', async () => {
    const s = await setup();
    await linkFromFlow(s);
    s.h.clock.ms += STEAM_REFRESH_MIN_INTERVAL_MS;
    s.h.steam.webapi.ownedFail = 'status';
    expect((await refreshFromSteam(s.deps)).kind).toBe('failed');
    s.h.steam.webapi.ownedFail = null;
    expect((await refreshFromSteam(s.deps)).kind).toBe('applied');
  });
});
