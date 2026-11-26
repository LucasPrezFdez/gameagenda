// Steam vinculado (ADR-014): `POST /api/v1/steam/link` canjea el login como `redeem` y guarda el
// SteamID64 de la agenda; `refresh` trae la biblioteca sin login, como mucho una vez cada 20 h por
// agenda (y si Steam no la da, la vez no cuenta); `unlink` borra el vínculo. Las tres, con la cookie
// y con `ACCOUNTS_ENABLED`.

import { STEAM_IMPORT_TOKEN_PATTERN, STEAM_REFRESH_MIN_INTERVAL_MS } from '@gameagenda/core/api';
import { describe, expect, it } from 'vitest';
import { ownedGamesUrl } from '../steam-library.ts';
import { openImportToken } from '../steam-token.ts';
import { type Client, createAgenda, createHarness, type Harness } from './harness.ts';
import {
  begin,
  callback,
  OWNED_FIXTURE,
  STEAM_ID,
  TEST_STEAM_KEY,
  WISHLIST_FIXTURE,
} from './steam-support.ts';

/** Empieza y vuelve de Steam con una aserción buena: el ticket ya tiene su SteamID64. */
async function loggedIn(h: Harness, client: Client) {
  const started = await begin(client);
  const response = await callback(
    client,
    started.ticket,
    h.steam.openid.assertion(started.returnTo),
  );
  if (response.status !== 200) throw new Error(`callback: ${response.status}`);
  return started;
}

function link(client: Client, ticket: string, verifier: string) {
  return client.post('/api/v1/steam/link', { ticket, verifier });
}

function refresh(client: Client) {
  return client.post('/api/v1/steam/refresh', {});
}

/** Una agenda con su cuenta de Steam vinculada, desde `pc`. */
async function linked(h: Harness) {
  const pc = h.client();
  await createAgenda(pc);
  const { ticket, verifier } = await loggedIn(h, pc);
  const response = await link(pc, ticket, verifier);
  if (response.status !== 200) throw new Error(`link: ${response.status}`);
  return pc;
}

function ownedCalls(h: Harness): number {
  return h.steam.calls.filter((url) => url === ownedGamesUrl(STEAM_ID)).length;
}

describe('vincular', () => {
  it('trae la biblioteca como redeem y guarda el vínculo de la agenda', async () => {
    const h = createHarness();
    const pc = h.client();
    await createAgenda(pc);
    const { ticket, verifier } = await loggedIn(h, pc);
    const response = await link(pc, ticket, verifier);
    expect(response.status).toBe(200);
    expect(response.json).toEqual({
      token: expect.stringMatching(STEAM_IMPORT_TOKEN_PATTERN),
      owned: JSON.parse(OWNED_FIXTURE),
      wishlist: JSON.parse(WISHLIST_FIXTURE),
    });
    expect(await openImportToken(TEST_STEAM_KEY, response.json.token, h.clock.ms)).toBe(STEAM_ID);
    const at = new Date(h.clock.ms).toISOString();
    expect(h.db.rows('SELECT steam_id, linked_at, refreshed_at FROM steam_link')).toEqual([
      { steam_id: STEAM_ID, linked_at: at, refreshed_at: at },
    ]);
    expect((await pc.get('/api/v1/account')).json).toEqual({
      hasLogin: false,
      steam: { linkedAt: at, refreshedAt: at },
    });
  });

  it('el ticket es de un solo uso, como en redeem', async () => {
    const h = createHarness();
    const pc = h.client();
    await createAgenda(pc);
    const { ticket, verifier } = await loggedIn(h, pc);
    expect((await link(pc, ticket, verifier)).status).toBe(200);
    expect((await link(pc, ticket, verifier)).json).toEqual({ error: 'steam_ticket_invalid' });
    expect((await pc.post('/api/v1/steam/redeem', { ticket, verifier })).status).toBe(410);
  });

  it('sin login aún, 202 pending, sin gastar el ticket ni guardar nada', async () => {
    const h = createHarness();
    const pc = h.client();
    await createAgenda(pc);
    const { ticket, verifier } = await begin(pc);
    const response = await link(pc, ticket, verifier);
    expect(response.status).toBe(202);
    expect(response.json).toEqual({ status: 'pending' });
    expect(h.db.rows('SELECT * FROM steam_link')).toHaveLength(0);
  });

  it('sin cookie, 401, y el ticket sigue sin gastar', async () => {
    const h = createHarness();
    const anon = h.client();
    const { ticket, verifier } = await loggedIn(h, anon);
    expect((await link(anon, ticket, verifier)).status).toBe(401);
    expect((await anon.post('/api/v1/steam/redeem', { ticket, verifier })).status).toBe(200);
  });

  it('volver a vincular cambia la cuenta y la fecha', async () => {
    const h = createHarness();
    const pc = await linked(h);
    h.clock.ms += 60_000;
    const { ticket, verifier } = await loggedIn(h, pc);
    expect((await link(pc, ticket, verifier)).status).toBe(200);
    expect(h.db.rows('SELECT linked_at FROM steam_link')).toEqual([
      { linked_at: new Date(h.clock.ms).toISOString() },
    ]);
  });
});

describe('actualizar', () => {
  it('trae la biblioteca sin login, con el pase de los logros', async () => {
    const h = createHarness();
    const pc = await linked(h);
    h.clock.ms += STEAM_REFRESH_MIN_INTERVAL_MS;
    const response = await refresh(pc);
    expect(response.status).toBe(200);
    expect(response.json.owned).toEqual(JSON.parse(OWNED_FIXTURE));
    expect(await openImportToken(TEST_STEAM_KEY, response.json.token, h.clock.ms)).toBe(STEAM_ID);
    expect(h.db.rows('SELECT refreshed_at FROM steam_link')).toEqual([
      { refreshed_at: new Date(h.clock.ms).toISOString() },
    ]);
    expect(ownedCalls(h)).toBe(2);
  });

  it('antes de 20 h, steam_refresh_too_soon sin llamar a Steam, desde cualquier dispositivo', async () => {
    const h = createHarness();
    const pc = await linked(h);
    const { recoveryCode } = (await pc.post('/api/v1/recovery', {})).json as {
      recoveryCode: string;
    };
    const phone = h.client();
    await phone.post('/api/v1/recovery/redeem', { code: recoveryCode, label: 'iPhone' });
    h.clock.ms += STEAM_REFRESH_MIN_INTERVAL_MS - 1;
    for (const client of [pc, phone]) {
      const response = await refresh(client);
      expect(response.status).toBe(429);
      expect(response.json).toEqual({ error: 'steam_refresh_too_soon' });
    }
    expect(ownedCalls(h)).toBe(1);
    h.clock.ms += 1;
    expect((await refresh(phone)).status).toBe(200);
    expect((await refresh(pc)).json).toEqual({ error: 'steam_refresh_too_soon' });
  });

  it('si Steam no la da, la vez no cuenta', async () => {
    const h = createHarness();
    const pc = await linked(h);
    const [before] = h.db.rows('SELECT refreshed_at FROM steam_link');
    h.clock.ms += STEAM_REFRESH_MIN_INTERVAL_MS;
    h.steam.webapi.ownedFail = 'status';
    expect((await refresh(pc)).json).toEqual({ error: 'steam_unavailable' });
    expect(h.db.rows('SELECT refreshed_at FROM steam_link')).toEqual([before]);
    h.steam.webapi.ownedFail = null;
    expect((await refresh(pc)).status).toBe(200);
  });

  it('con el tope del día, steam_busy, y la vez tampoco cuenta', async () => {
    const h = createHarness({}, { steamDailyCalls: 10 });
    const pc = await linked(h);
    h.clock.ms += STEAM_REFRESH_MIN_INTERVAL_MS;
    // El día de la actualización, ya gastado.
    const day = new Date(h.clock.ms).toISOString().slice(0, 10);
    h.db.rows(`INSERT INTO steam_quota (day, calls) VALUES ('${day}', 10)`);
    expect((await refresh(pc)).json).toEqual({ error: 'steam_busy' });
    expect(h.db.rows('SELECT refreshed_at FROM steam_link')).toEqual([
      { refreshed_at: new Date(h.clock.ms - STEAM_REFRESH_MIN_INTERVAL_MS).toISOString() },
    ]);
  });

  it('sin vínculo, steam_not_linked; sin cookie, 401', async () => {
    const h = createHarness();
    const pc = h.client();
    await createAgenda(pc);
    expect((await refresh(pc)).json).toEqual({ error: 'steam_not_linked' });
    expect((await refresh(h.client())).status).toBe(401);
  });

  it('cuenta en RL_STEAM, por IP', async () => {
    const h = createHarness();
    const pc = await linked(h);
    h.clock.ms += STEAM_REFRESH_MIN_INTERVAL_MS;
    h.limits.steam.max = 0;
    expect((await refresh(pc)).json).toEqual({ error: 'rate_limited' });
  });
});

describe('desvincular', () => {
  it('borra el vínculo; actualizar ya no vale', async () => {
    const h = createHarness();
    const pc = await linked(h);
    const response = await pc.post('/api/v1/steam/unlink', {});
    expect(response.json).toEqual({ hasLogin: false, steam: null });
    expect(h.db.rows('SELECT * FROM steam_link')).toHaveLength(0);
    h.clock.ms += STEAM_REFRESH_MIN_INTERVAL_MS;
    expect((await refresh(pc)).json).toEqual({ error: 'steam_not_linked' });
  });

  it('«Borrar todos mis datos» se lleva el vínculo en cascada', async () => {
    const h = createHarness();
    const pc = await linked(h);
    await pc.post('/api/v1/agenda/delete', { confirm: true });
    expect(h.db.rows('SELECT * FROM steam_link')).toHaveLength(0);
  });
});

describe('los interruptores', () => {
  it('con ACCOUNTS_ENABLED a "0", 503 accounts_disabled; redeem sigue valiendo', async () => {
    const h = createHarness({ ACCOUNTS_ENABLED: '0' });
    const pc = h.client();
    await createAgenda(pc);
    const { ticket, verifier } = await loggedIn(h, pc);
    expect((await link(pc, ticket, verifier)).json).toEqual({ error: 'accounts_disabled' });
    expect((await refresh(pc)).json).toEqual({ error: 'accounts_disabled' });
    expect((await pc.post('/api/v1/steam/unlink', {})).json).toEqual({
      error: 'accounts_disabled',
    });
    expect((await pc.post('/api/v1/steam/redeem', { ticket, verifier })).status).toBe(200);
  });

  it('con STEAM_ENABLED a "0", steam_disabled', async () => {
    const h = createHarness({ STEAM_ENABLED: '0' });
    const pc = h.client();
    await createAgenda(pc);
    expect((await refresh(pc)).json).toEqual({ error: 'steam_disabled' });
  });
});
