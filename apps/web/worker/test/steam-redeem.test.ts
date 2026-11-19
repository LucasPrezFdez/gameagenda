// `POST /api/v1/steam/redeem` (Fase 2, parte 2; §10.2 y §10.3 de prototipe.md; ADR-012): el canje
// tipo PKCE del ticket y la biblioteca y la lista de deseados, tal cual las da Steam.

import { STEAM_TICKET_TTL_MS, steamImportResponseSchema } from '@gameagenda/core/api';
import { describe, expect, it, vi } from 'vitest';
import { ownedGamesUrl, wishlistUrl } from '../steam-library.ts';
import { STEAM_OPENID } from '../steam-openid.ts';
import { type Client, createHarness, dumpAllText, type Harness } from './harness.ts';
import {
  begin,
  callback,
  OWNED_EMPTY_FIXTURE,
  OWNED_FIXTURE,
  OWNED_PRIVATE_FIXTURE,
  pkce,
  STEAM_ID,
  steamIdOf,
  TEST_STEAM_KEY,
  WISHLIST_FIXTURE,
  WISHLIST_PRIVATE_FIXTURE,
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

function redeem(client: Client, ticket: string, verifier: string) {
  return client.post('/api/v1/steam/redeem', { ticket, verifier });
}

/** Las llamadas a la Web API de Steam (no las de OpenID). */
function webApiCalls(h: Harness): string[] {
  return h.steam.calls.filter((url) => url !== STEAM_OPENID);
}

describe('un canje bueno', () => {
  it('trae la biblioteca y la lista de deseados tal cual, y gasta el ticket', async () => {
    const h = createHarness();
    const pc = h.client();
    const { ticket, verifier } = await loggedIn(h, pc);
    const response = await redeem(pc, ticket, verifier);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.json).toEqual({
      owned: JSON.parse(OWNED_FIXTURE),
      wishlist: JSON.parse(WISHLIST_FIXTURE),
    });
    expect(steamImportResponseSchema.safeParse(response.json).success).toBe(true);
    expect(h.db.rows('SELECT * FROM steam_ticket')).toEqual([]);
  });

  it('pide a Steam lo de la §10.1, con la clave en x-webapi-key y nunca en la URL', async () => {
    const h = createHarness();
    const pc = h.client();
    const { ticket, verifier } = await loggedIn(h, pc);
    await redeem(pc, ticket, verifier);
    expect(webApiCalls(h).sort()).toEqual([ownedGamesUrl(STEAM_ID), wishlistUrl(STEAM_ID)].sort());
    const owned = new URL(ownedGamesUrl(STEAM_ID));
    expect(Object.fromEntries(owned.searchParams)).toEqual({
      steamid: STEAM_ID,
      include_appinfo: 'true',
      include_played_free_games: 'true',
      skip_unvetted_apps: 'false',
      format: 'json',
    });
    for (const { url, headers } of h.steam.webapi.requests) {
      expect(url).not.toContain(TEST_STEAM_KEY);
      expect(url).not.toMatch(/key=/i);
      const expected = url.startsWith(owned.origin + owned.pathname) ? TEST_STEAM_KEY : null;
      expect(headers.get('x-webapi-key')).toBe(expected);
    }
  });

  it('ni D1 ni los registros guardan nada de Steam', async () => {
    const h = createHarness();
    const pc = h.client();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const { ticket, verifier } = await loggedIn(h, pc);
      await redeem(pc, ticket, verifier);
      const text = dumpAllText(h.db);
      for (const leak of [STEAM_ID, 'Stardew Valley', '413150', '1086940', TEST_STEAM_KEY]) {
        expect(text).not.toContain(leak);
      }
      expect(errors).not.toHaveBeenCalled();
      expect(logs).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
      logs.mockRestore();
    }
  });

  it('desde otro contexto (la PWA de iOS): solo hacen falta el ticket y el verificador', async () => {
    const h = createHarness();
    const app = h.client('198.51.100.7');
    const safari = h.client('198.51.100.7');
    const { ticket, verifier, returnTo } = await begin(app);
    // El login acaba en Safari, con otras cookies; la vuelta no lleva nada de la app.
    await callback(safari, ticket, h.steam.openid.assertion(returnTo));
    expect(app.cookies.size).toBe(0);
    expect(safari.cookies.size).toBe(0);
    expect((await redeem(app, ticket, verifier)).status).toBe(200);
  });

  it('el perfil privado llega tal cual (sin games): lo explica la app', async () => {
    const h = createHarness();
    const pc = h.client();
    h.steam.webapi.owned = OWNED_PRIVATE_FIXTURE;
    h.steam.webapi.wishlist = WISHLIST_PRIVATE_FIXTURE;
    const { ticket, verifier } = await loggedIn(h, pc);
    const response = await redeem(pc, ticket, verifier);
    expect(response.status).toBe(200);
    expect(response.json).toEqual({ owned: { response: {} }, wishlist: { response: {} } });
  });

  it('la biblioteca vacía, también', async () => {
    const h = createHarness();
    const pc = h.client();
    h.steam.webapi.owned = OWNED_EMPTY_FIXTURE;
    const { ticket, verifier } = await loggedIn(h, pc);
    expect((await redeem(pc, ticket, verifier)).json.owned).toEqual({
      response: { game_count: 0 },
    });
  });
});

describe('comprobación 5: un solo uso, con su verificador y antes de 10 min', () => {
  it('antes del login, 202 pending, sin gastarlo ni llamar a Steam', async () => {
    const h = createHarness();
    const pc = h.client();
    const { ticket, verifier, returnTo } = await begin(pc);
    const early = await redeem(pc, ticket, verifier);
    expect(early.status).toBe(202);
    expect(early.json).toEqual({ status: 'pending' });
    expect(h.steam.calls).toEqual([]);
    await callback(pc, ticket, h.steam.openid.assertion(returnTo));
    expect((await redeem(pc, ticket, verifier)).status).toBe(200);
  });

  it('con otro verificador, 410 y sin llamar a Steam; con el suyo, sigue valiendo', async () => {
    const h = createHarness();
    const pc = h.client();
    const { ticket, verifier } = await loggedIn(h, pc);
    const wrong = (await pkce()).verifier;
    const response = await redeem(pc, ticket, wrong);
    expect(response.status).toBe(410);
    expect(response.json).toEqual({ error: 'steam_ticket_invalid' });
    expect(webApiCalls(h)).toEqual([]);
    expect(await steamIdOf(h, ticket)).toBe(STEAM_ID);
    expect((await redeem(pc, ticket, verifier)).status).toBe(200);
  });

  it('con otro verificador y sin login, tampoco dice pending', async () => {
    const h = createHarness();
    const pc = h.client();
    const { ticket } = await begin(pc);
    expect((await redeem(pc, ticket, (await pkce()).verifier)).status).toBe(410);
  });

  it('el challenge como verificador no vale (hay que conocer el verificador)', async () => {
    const h = createHarness();
    const pc = h.client();
    const { ticket, challenge } = await loggedIn(h, pc);
    expect((await redeem(pc, ticket, challenge)).status).toBe(410);
  });

  it('una segunda vez, 410, y Steam solo se llama una', async () => {
    const h = createHarness();
    const pc = h.client();
    const { ticket, verifier } = await loggedIn(h, pc);
    expect((await redeem(pc, ticket, verifier)).status).toBe(200);
    expect((await redeem(pc, ticket, verifier)).status).toBe(410);
    expect(webApiCalls(h)).toHaveLength(2);
  });

  it('caducado, 410 sin llamar a Steam', async () => {
    const h = createHarness();
    const pc = h.client();
    const { ticket, verifier } = await loggedIn(h, pc);
    h.clock.ms += STEAM_TICKET_TTL_MS;
    expect((await redeem(pc, ticket, verifier)).status).toBe(410);
    expect(webApiCalls(h)).toEqual([]);
  });

  it('inventado, 410', async () => {
    const h = createHarness();
    const { verifier } = await pkce();
    expect((await redeem(h.client(), 'A'.repeat(43), verifier)).status).toBe(410);
    expect(h.steam.calls).toEqual([]);
  });
});

describe('peticiones que no valen', () => {
  it('cuerpo con otra forma, 400; Origin ajeno, 403; sin JSON, 415', async () => {
    const h = createHarness();
    const pc = h.client();
    const { ticket, verifier } = await loggedIn(h, pc);
    for (const body of [
      {},
      { ticket },
      { ticket, verifier: verifier.slice(1) },
      { ticket, verifier, extra: 1 },
      { ticket: `${ticket}=`, verifier },
    ]) {
      expect((await pc.post('/api/v1/steam/redeem', body)).status).toBe(400);
    }
    expect(
      (await pc.post('/api/v1/steam/redeem', { ticket, verifier }, { origin: 'https://x.example' }))
        .status,
    ).toBe(403);
    expect(
      (
        await pc.post('/api/v1/steam/redeem', JSON.stringify({ ticket, verifier }), {
          headers: { 'Content-Type': 'text/plain' },
        })
      ).status,
    ).toBe(415);
    expect(webApiCalls(h)).toEqual([]);
    expect(await steamIdOf(h, ticket)).toBe(STEAM_ID);
  });

  it('si quitan la clave tras el login, 503 steam_disabled y el ticket sigue sin gastar', async () => {
    const h = createHarness();
    const pc = h.client();
    const { ticket, verifier } = await loggedIn(h, pc);
    h.env.STEAM_WEB_API_KEY = '';
    const response = await redeem(pc, ticket, verifier);
    expect(response.status).toBe(503);
    expect(response.json).toEqual({ error: 'steam_disabled' });
    expect(await steamIdOf(h, ticket)).toBe(STEAM_ID);
    expect(webApiCalls(h)).toEqual([]);
  });
});

describe('si Steam falla', () => {
  for (const [fail, status, error] of [
    ['network', 502, 'steam_unavailable'],
    ['status', 502, 'steam_unavailable'],
    ['html', 502, 'steam_unavailable'],
    ['unauthorized', 502, 'steam_unavailable'],
    ['rate_limited', 503, 'steam_busy'],
  ] as const) {
    it(`GetOwnedGames con ${fail}: ${status} ${error}, y el ticket ya está gastado`, async () => {
      const h = createHarness();
      const pc = h.client();
      h.steam.webapi.ownedFail = fail;
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const { ticket, verifier } = await loggedIn(h, pc);
        const response = await redeem(pc, ticket, verifier);
        expect(response.status).toBe(status);
        expect(response.json).toEqual({ error });
        expect((await redeem(pc, ticket, verifier)).status).toBe(410);
        // Solo la clave rechazada deja una línea, sin nada de la cuenta.
        if (fail === 'unauthorized') {
          expect(errors.mock.calls).toEqual([['micro-API: GetOwnedGames respondió 403']]);
        } else {
          expect(errors).not.toHaveBeenCalled();
        }
      } finally {
        errors.mockRestore();
      }
    });
  }

  for (const fail of ['network', 'status', 'html', 'garbage', 'rate_limited', 'huge'] as const) {
    it(`GetWishlist con ${fail}: la biblioteca llega igual, con wishlist a null`, async () => {
      const h = createHarness();
      const pc = h.client();
      h.steam.webapi.wishlistFail = fail;
      const { ticket, verifier } = await loggedIn(h, pc);
      const response = await redeem(pc, ticket, verifier);
      expect(response.status).toBe(200);
      expect(response.json).toEqual({ owned: JSON.parse(OWNED_FIXTURE), wishlist: null });
    });
  }

  it('una biblioteca de más de 16 MiB corta la respuesta (la app la ve rota)', async () => {
    const h = createHarness();
    const pc = h.client();
    h.steam.webapi.ownedFail = 'huge';
    const { ticket, verifier } = await loggedIn(h, pc);
    // Sin `rejects`: si llegara entera, Vitest intentaría pintar 17 MiB en el fallo y se colgaría.
    const outcome = await redeem(pc, ticket, verifier).then(
      () => 'llega entera',
      () => 'cortada',
    );
    expect(outcome).toBe('cortada');
  });
});
