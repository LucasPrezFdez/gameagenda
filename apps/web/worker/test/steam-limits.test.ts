// Importar desde Steam (Fase 2, parte 2; §11.1 y §11.4 de prototipe.md; ADR-012): el interruptor
// `STEAM_ENABLED`, el límite por IP (`RL_STEAM`) y el tope diario de llamadas a Steam.

import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../crypto.ts';
import { utcDay } from '../maintenance.ts';
import { STEAM_OPENID } from '../steam-openid.ts';
import { steamPageTitle } from '../steam-page.ts';
import { STEAM_DAILY_CALLS } from '../steam-quota.ts';
import { type Client, createHarness, type Harness, T0 } from './harness.ts';
import { begin, callback, pkce, STEAM_ID, steamIdOf } from './steam-support.ts';

async function loggedIn(h: Harness, client: Client) {
  const started = await begin(client);
  await callback(client, started.ticket, h.steam.openid.assertion(started.returnTo));
  return started;
}

function quota(h: Harness): unknown[] {
  return h.db.rows('SELECT day, calls FROM steam_quota');
}

describe('el interruptor STEAM_ENABLED', () => {
  for (const [what, overrides] of [
    ['con STEAM_ENABLED a "0"', { STEAM_ENABLED: '0' }],
    ['con otro valor', { STEAM_ENABLED: 'true' }],
    ['sin la clave', { STEAM_WEB_API_KEY: '' }],
    ['sin la clave definida', { STEAM_WEB_API_KEY: undefined }],
  ] as const) {
    it(`${what}, 503 steam_disabled en todo, sin tocar D1 ni Steam`, async () => {
      const h = createHarness(overrides);
      const pc = h.client();
      const { challenge, verifier } = await pkce();
      const start = await pc.post('/api/v1/steam/start', { challenge });
      expect(start.status).toBe(503);
      expect(start.json).toEqual({ error: 'steam_disabled' });
      expect(start.headers.get('Cache-Control')).toBe('no-store');
      const redeem = await pc.post('/api/v1/steam/redeem', { ticket: challenge, verifier });
      expect(redeem.json).toEqual({ error: 'steam_disabled' });
      const back = await pc.get(`/api/v1/steam/callback?t=${challenge}&openid.mode=id_res`);
      expect(back.status).toBe(503);
      expect(back.headers.get('Content-Type')).toMatch(/^text\/html/);
      expect(back.json).toContain(steamPageTitle('disabled'));
      expect(h.db.rows('SELECT * FROM steam_ticket')).toEqual([]);
      expect(quota(h)).toEqual([]);
      expect(h.steam.calls).toEqual([]);
      expect(h.limits.steam.counts.size).toBe(0);
    });
  }

  it('apagarlo no apaga la sincronización, y SYNC_ENABLED a "0" lo apaga todo', async () => {
    const off = createHarness({ STEAM_ENABLED: '0' });
    expect(
      (
        await off.client().post('/api/v1/agenda', {
          ageConfirmed: true,
          minAge: 14,
          label: 'Chrome en Windows',
        })
      ).status,
    ).toBe(201);
    const all = createHarness({ SYNC_ENABLED: '0' });
    const start = await all.client().post('/api/v1/steam/start', {
      challenge: (await pkce()).challenge,
    });
    expect(start.status).toBe(503);
    expect(start.json).toEqual({ error: 'sync_disabled' });
  });

  it('apagado a mitad: un ticket con login no se canjea, ni se gasta', async () => {
    const h = createHarness();
    const pc = h.client();
    const { ticket, verifier } = await loggedIn(h, pc);
    h.env.STEAM_ENABLED = '0';
    expect((await pc.post('/api/v1/steam/redeem', { ticket, verifier })).status).toBe(503);
    expect(await steamIdOf(h, ticket)).toBe(STEAM_ID);
    h.env.STEAM_ENABLED = '1';
    expect((await pc.post('/api/v1/steam/redeem', { ticket, verifier })).status).toBe(200);
  });
});

describe('RL_STEAM, por IP', () => {
  it('start y redeem cuentan juntos, con el SHA-256 de la IP; callback no cuenta', async () => {
    const h = createHarness();
    h.limits.steam.max = 3;
    const pc = h.client('203.0.113.9');
    const { ticket, verifier } = await loggedIn(h, pc); // 1 (start); callback no cuenta
    expect((await pc.post('/api/v1/steam/redeem', { ticket, verifier })).status).toBe(200); // 2
    await begin(pc); // 3
    const limited = await pc.post('/api/v1/steam/start', { challenge: (await pkce()).challenge });
    expect(limited.status).toBe(429);
    expect(limited.json).toEqual({ error: 'rate_limited' });
    const again = await pc.post('/api/v1/steam/redeem', { ticket, verifier });
    expect(again.status).toBe(429);
    expect([...h.limits.steam.counts.keys()]).toEqual([await sha256Hex('203.0.113.9')]);
    // Otra IP sigue pudiendo.
    expect((await begin(h.client('203.0.113.10'))).ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('el 429 llega antes de leer el cuerpo y no toca D1', async () => {
    const h = createHarness();
    h.limits.steam.max = 0;
    const response = await h.client().post('/api/v1/steam/start', { nada: true });
    expect(response.status).toBe(429);
    expect(h.db.rows('SELECT * FROM steam_ticket')).toEqual([]);
  });
});

describe('el tope diario de llamadas a Steam', () => {
  it('por defecto, 50 000: la mitad de los ToU', () => {
    expect(STEAM_DAILY_CALLS).toBe(50_000);
  });

  it('callback suma 1 y redeem 2, en el día UTC, sin nada de quién', async () => {
    const h = createHarness();
    const pc = h.client();
    const { ticket, verifier } = await loggedIn(h, pc);
    expect(quota(h)).toEqual([{ day: utcDay(T0), calls: 1 }]);
    await pc.post('/api/v1/steam/redeem', { ticket, verifier });
    expect(quota(h)).toEqual([{ day: utcDay(T0), calls: 3 }]);
    // Al día siguiente, otra fila.
    h.clock.ms += 86_400_000;
    await loggedIn(h, pc);
    expect(quota(h)).toEqual([
      { day: utcDay(T0), calls: 3 },
      { day: utcDay(T0 + 86_400_000), calls: 1 },
    ]);
  });

  it('una vuelta que no pasa las comprobaciones no suma (no llama a Steam)', async () => {
    const h = createHarness();
    const pc = h.client();
    const { ticket, returnTo } = await begin(pc);
    const assertion = h.steam.openid.assertion(returnTo, {
      fields: { 'openid.op_endpoint': 'https://evil.example/openid/login' },
    });
    await callback(pc, ticket, assertion);
    expect(quota(h)).toEqual([]);
  });

  it('lleno: la vuelta de Steam dice «mañana» sin preguntar a Steam, y el ticket se queda', async () => {
    const h = createHarness({}, { steamDailyCalls: 3 });
    const pc = h.client();
    const first = await loggedIn(h, pc); // 1
    expect(
      (await pc.post('/api/v1/steam/redeem', { ticket: first.ticket, verifier: first.verifier }))
        .status,
    ).toBe(200); // 3
    const { ticket, returnTo } = await begin(pc);
    h.steam.calls.length = 0;
    const back = await callback(pc, ticket, h.steam.openid.assertion(returnTo));
    expect(back.status).toBe(503);
    expect(back.json).toContain(steamPageTitle('busy'));
    expect(h.steam.calls).toEqual([]);
    expect(await steamIdOf(h, ticket)).toBeNull();
    // Al día siguiente, el ticket ya habrá caducado, pero se puede volver a empezar.
    h.clock.ms += 86_400_000;
    const next = await loggedIn(h, pc);
    expect(
      (await pc.post('/api/v1/steam/redeem', { ticket: next.ticket, verifier: next.verifier }))
        .status,
    ).toBe(200);
  });

  it('lleno en el canje: 503 steam_busy sin llamar a la Web API', async () => {
    const h = createHarness({}, { steamDailyCalls: 2 });
    const pc = h.client();
    const { ticket, verifier } = await loggedIn(h, pc); // 1
    h.steam.calls.length = 0;
    const response = await pc.post('/api/v1/steam/redeem', { ticket, verifier }); // 3 > 2
    expect(response.status).toBe(503);
    expect(response.json).toEqual({ error: 'steam_busy' });
    expect(h.steam.calls.filter((url) => url !== STEAM_OPENID)).toEqual([]);
  });
});
