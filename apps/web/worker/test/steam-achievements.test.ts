// `POST /api/v1/steam/achievements` (Fase 2, parte 3; §10.1 de prototipe.md; ADR-012): con el pase
// de `redeem`, si cada juego tiene todos sus logros. Cada comprobación, con su prueba.

import {
  STEAM_ACHIEVEMENTS_BATCH,
  STEAM_IMPORT_TOKEN_TTL_MS,
  steamAchievementsResponseSchema,
} from '@gameagenda/core/api';
import { describe, expect, it, vi } from 'vitest';
import { utcDay } from '../maintenance.ts';
import {
  ACHIEVEMENTS_CONCURRENCY,
  achievementsOf,
  achievementsUrl,
} from '../steam-achievements.ts';
import { STEAM_OPENID } from '../steam-openid.ts';
import { sealImportToken } from '../steam-token.ts';
import { type Client, createHarness, dumpAllText, type Harness, T0 } from './harness.ts';
import {
  ACHIEVEMENTS_API_PREFIX,
  ACHIEVEMENTS_FIXTURES,
  begin,
  COMPLETE_AT,
  callback,
  STEAM_ID,
  TEST_STEAM_KEY,
  type WebApiFail,
} from './steam-support.ts';

/** Inicia sesión y canjea, como la app: devuelve el pase. */
async function imported(h: Harness, client: Client): Promise<string> {
  const { ticket, verifier, returnTo } = await begin(client);
  await callback(client, ticket, h.steam.openid.assertion(returnTo));
  const response = await client.post('/api/v1/steam/redeem', { ticket, verifier });
  if (response.status !== 200) throw new Error(`redeem: ${response.status}`);
  return response.json.token as string;
}

function achievements(client: Client, token: string, appids: readonly number[]) {
  return client.post('/api/v1/steam/achievements', { token, appids });
}

/** Las llamadas a `GetPlayerAchievements`. */
function achievementCalls(h: Harness): string[] {
  return h.steam.calls.filter((url) => url.startsWith(ACHIEVEMENTS_API_PREFIX));
}

function quota(h: Harness): unknown[] {
  return h.db.rows('SELECT day, calls FROM steam_quota');
}

describe('con un pase bueno', () => {
  it('dice de cada juego si tiene todos los logros, en su orden', async () => {
    const h = createHarness();
    const pc = h.client();
    const token = await imported(h, pc);
    const fx = ACHIEVEMENTS_FIXTURES;
    h.steam.webapi.achievements.set(753640, fx.complete);
    h.steam.webapi.achievements.set(1145360, fx.incomplete);
    h.steam.webapi.achievements.set(413150, fx.noAchievements);
    h.steam.webapi.achievements.set(70, fx.private);
    // 220: sin entrada, «sin estadísticas».
    const response = await achievements(pc, token, [753640, 1145360, 413150, 220, 70]);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.json).toEqual({
      games: [
        { appid: 753640, result: 'complete', at: COMPLETE_AT },
        { appid: 1145360, result: 'incomplete' },
        { appid: 413150, result: 'none' },
        { appid: 220, result: 'none' },
        { appid: 70, result: 'hidden' },
      ],
    });
    expect(steamAchievementsResponseSchema.safeParse(response.json).success).toBe(true);
  });

  it('pregunta a Steam por el SteamID64 del pase, con la clave en x-webapi-key', async () => {
    const h = createHarness();
    const pc = h.client();
    const token = await imported(h, pc);
    await achievements(pc, token, [753640, 220]);
    expect(achievementCalls(h).sort()).toEqual(
      [achievementsUrl(STEAM_ID, 753640), achievementsUrl(STEAM_ID, 220)].sort(),
    );
    expect(Object.fromEntries(new URL(achievementsUrl(STEAM_ID, 220)).searchParams)).toEqual({
      steamid: STEAM_ID,
      appid: '220',
    });
    for (const { url, headers } of h.steam.webapi.requests) {
      expect(url).not.toContain(TEST_STEAM_KEY);
      if (url.startsWith(ACHIEVEMENTS_API_PREFIX)) {
        expect(headers.get('x-webapi-key')).toBe(TEST_STEAM_KEY);
      }
    }
  });

  it(`un lote entero (${STEAM_ACHIEVEMENTS_BATCH}), con ${ACHIEVEMENTS_CONCURRENCY} llamadas a la vez como mucho`, async () => {
    const h = createHarness();
    const pc = h.client();
    const token = await imported(h, pc);
    const appids = Array.from({ length: STEAM_ACHIEVEMENTS_BATCH }, (_, i) => 1000 + i);
    for (const appid of appids) {
      h.steam.webapi.achievements.set(appid, ACHIEVEMENTS_FIXTURES.complete);
    }
    const response = await achievements(pc, token, appids);
    expect(response.status).toBe(200);
    expect(response.json.games.map((g: { appid: number }) => g.appid)).toEqual(appids);
    expect(achievementCalls(h)).toHaveLength(STEAM_ACHIEVEMENTS_BATCH);
    expect(h.steam.webapi.maxInFlight).toBe(ACHIEVEMENTS_CONCURRENCY);
  });

  it('suma al tope diario un juego por llamada; D1 no guarda nada más y no se registra nada', async () => {
    const h = createHarness();
    const pc = h.client();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const token = await imported(h, pc); // callback 1 + redeem 2
      h.steam.webapi.achievements.set(753640, ACHIEVEMENTS_FIXTURES.complete);
      await achievements(pc, token, [753640, 220, 70]);
      expect(quota(h)).toEqual([{ day: utcDay(T0), calls: 6 }]);
      const text = dumpAllText(h.db);
      for (const leak of [STEAM_ID, token, '753640', 'Outer Wilds', TEST_STEAM_KEY]) {
        expect(text).not.toContain(leak);
      }
      expect(errors).not.toHaveBeenCalled();
      expect(logs).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
      logs.mockRestore();
    }
  });

  it('el mismo pase vale para varios lotes mientras no caduque', async () => {
    const h = createHarness();
    const pc = h.client();
    const token = await imported(h, pc);
    expect((await achievements(pc, token, [1])).status).toBe(200);
    h.clock.ms += STEAM_IMPORT_TOKEN_TTL_MS - 1;
    expect((await achievements(pc, token, [2])).status).toBe(200);
  });
});

describe('el pase', () => {
  async function rejected(h: Harness, pc: Client, token: string) {
    const response = await achievements(pc, token, [753640]);
    expect(response.status).toBe(410);
    expect(response.json).toEqual({ error: 'steam_token_invalid' });
    expect(achievementCalls(h)).toEqual([]);
  }

  it('caducado (15 min): 410, sin llamar a Steam', async () => {
    const h = createHarness();
    const pc = h.client();
    const token = await imported(h, pc);
    h.clock.ms += STEAM_IMPORT_TOKEN_TTL_MS;
    await rejected(h, pc, token);
  });

  it('cambiado en cualquier carácter: 410', async () => {
    const h = createHarness();
    const pc = h.client();
    const token = await imported(h, pc);
    // Se cambia el bit alto del carácter: en el último, los 2 bits bajos son relleno y el
    // decodificador los ignora (con «B» → «A», el pase seguía valiendo 1 vez de cada 16).
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    for (const index of [0, 5, 16, 40, token.length - 1]) {
      const c = alphabet[alphabet.indexOf(token[index] ?? 'A') ^ 0b10_0000];
      await rejected(h, pc, token.slice(0, index) + c + token.slice(index + 1));
    }
  });

  it('inventado, o de otra clave de Steam: 410', async () => {
    const h = createHarness();
    const pc = h.client();
    await rejected(h, pc, 'A'.repeat(79));
    const other = await sealImportToken('FEDCBA9876543210FEDCBA9876543210', STEAM_ID, T0 + 60_000);
    await rejected(h, pc, other);
  });

  it('uno bueno hecho con la clave del Worker sí vale (lo que firma es la clave)', async () => {
    const h = createHarness();
    const token = await sealImportToken(TEST_STEAM_KEY, STEAM_ID, T0 + 60_000);
    expect((await achievements(h.client(), token, [220])).status).toBe(200);
  });

  it('no sirve como ticket ni como verificador de redeem', async () => {
    const h = createHarness();
    const pc = h.client();
    const token = await imported(h, pc);
    const response = await pc.post('/api/v1/steam/redeem', { ticket: token, verifier: token });
    expect(response.status).toBe(400);
  });
});

describe('peticiones que no valen', () => {
  it('cuerpo con otra forma, 400, sin llamar a Steam ni gastar del tope', async () => {
    const h = createHarness();
    const pc = h.client();
    const token = await imported(h, pc);
    const tooMany = Array.from({ length: STEAM_ACHIEVEMENTS_BATCH + 1 }, (_, i) => i + 1);
    for (const body of [
      { token, appids: [] },
      { token, appids: tooMany },
      { token, appids: [10, 10] },
      { token, appids: [0] },
      { token, appids: [1.5] },
      { token, appids: ['10'] },
      { token, appids: [10], extra: true },
      { appids: [10] },
      { token: 'corto', appids: [10] },
    ]) {
      const response = await pc.post('/api/v1/steam/achievements', body);
      expect(response.status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
    expect(achievementCalls(h)).toEqual([]);
    expect(quota(h)).toEqual([{ day: utcDay(T0), calls: 3 }]);
  });

  it('Origin ajeno, 403; sin JSON, 415', async () => {
    const h = createHarness();
    const pc = h.client();
    const token = await imported(h, pc);
    const foreign = await pc.post(
      '/api/v1/steam/achievements',
      { token, appids: [10] },
      { origin: 'https://otra.example' },
    );
    expect(foreign.status).toBe(403);
    const text = await pc.post(
      '/api/v1/steam/achievements',
      JSON.stringify({ token, appids: [10] }),
      {
        headers: { 'Content-Type': 'text/plain' },
      },
    );
    expect(text.status).toBe(415);
    expect(achievementCalls(h)).toEqual([]);
  });

  it('con STEAM_ENABLED a "0", 503 steam_disabled antes de todo', async () => {
    const h = createHarness();
    const pc = h.client();
    const token = await imported(h, pc);
    h.env.STEAM_ENABLED = '0';
    const response = await achievements(pc, token, [10]);
    expect(response.status).toBe(503);
    expect(response.json).toEqual({ error: 'steam_disabled' });
    expect(achievementCalls(h)).toEqual([]);
  });
});

describe('límites', () => {
  it('RL_STEAM_ACH, por IP y aparte de RL_STEAM: el 429 llega antes de leer el cuerpo', async () => {
    const h = createHarness();
    const pc = h.client('203.0.113.9');
    const token = await imported(h, pc);
    h.limits.steamAch.max = 2;
    expect((await achievements(pc, token, [1])).status).toBe(200);
    expect((await achievements(pc, token, [2])).status).toBe(200);
    const limited = await achievements(pc, token, [3]);
    expect(limited.status).toBe(429);
    expect(limited.json).toEqual({ error: 'rate_limited' });
    expect((await pc.post('/api/v1/steam/achievements', { nada: true })).status).toBe(429);
    expect(achievementCalls(h)).toHaveLength(2);
    // RL_STEAM solo ha contado start y redeem.
    expect([...h.limits.steam.counts.values()]).toEqual([2]);
    // Otra IP sigue pudiendo.
    expect((await achievements(h.client('203.0.113.10'), token, [4])).status).toBe(200);
  });

  it('el tope diario cuenta un juego por llamada y, sin sitio, 503 steam_busy sin llamar', async () => {
    const h = createHarness({}, { steamDailyCalls: 5 });
    const pc = h.client();
    const token = await imported(h, pc); // 3
    expect((await achievements(pc, token, [1, 2])).status).toBe(200); // 5
    const busy = await achievements(pc, token, [3]);
    expect(busy.status).toBe(503);
    expect(busy.json).toEqual({ error: 'steam_busy' });
    expect(achievementCalls(h)).toHaveLength(2);
  });
});

describe('si Steam falla con un juego', () => {
  const fails: readonly WebApiFail[] = [
    'network',
    'status',
    'unauthorized',
    'rate_limited',
    'html',
    'garbage',
    'huge',
  ];
  for (const fail of fails) {
    it(`${fail}: ese juego, unavailable; los demás, igual`, async () => {
      const h = createHarness();
      const pc = h.client();
      const token = await imported(h, pc);
      h.steam.webapi.achievements.set(753640, ACHIEVEMENTS_FIXTURES.complete);
      h.steam.webapi.achievementsFail.set(220, fail);
      const response = await achievements(pc, token, [220, 753640]);
      expect(response.status).toBe(200);
      expect(response.json.games).toEqual([
        { appid: 220, result: 'unavailable' },
        { appid: 753640, result: 'complete', at: COMPLETE_AT },
      ]);
    });
  }

  it('nunca pregunta a OpenID ni a otra URL', async () => {
    const h = createHarness();
    const pc = h.client();
    const token = await imported(h, pc);
    const before = h.steam.calls.length;
    await achievements(pc, token, [220]);
    expect(h.steam.calls.slice(before)).toEqual([achievementsUrl(STEAM_ID, 220)]);
    expect(h.steam.calls).not.toContain(`${STEAM_OPENID}#achievements`);
  });
});

describe('achievementsOf', () => {
  const ok = (achievements: unknown) => ({ playerstats: { success: true, achievements } });

  it('todos conseguidos: complete, con el último unlocktime (o null si no hay)', () => {
    const list = [
      { achieved: 1, unlocktime: 5 },
      { achieved: 1, unlocktime: 9 },
      { achieved: 1, unlocktime: 7 },
    ];
    expect(achievementsOf(1, 200, ok(list))).toEqual({ appid: 1, result: 'complete', at: 9 });
    expect(achievementsOf(1, 200, ok([{ achieved: 1, unlocktime: 0 }]))).toEqual({
      appid: 1,
      result: 'complete',
      at: null,
    });
    expect(achievementsOf(1, 200, ok([{ achieved: 1 }]))).toEqual({
      appid: 1,
      result: 'complete',
      at: null,
    });
  });

  it('uno sin conseguir, o con achieved que no es 1, incomplete', () => {
    for (const odd of [0, '1', true, null, undefined]) {
      expect(achievementsOf(1, 200, ok([{ achieved: 1 }, { achieved: odd }]))).toEqual({
        appid: 1,
        result: 'incomplete',
      });
    }
  });

  it('sin achievements o con la lista vacía, none; con otra cosa, unavailable', () => {
    expect(achievementsOf(1, 200, { playerstats: { success: true } })).toEqual({
      appid: 1,
      result: 'none',
    });
    expect(achievementsOf(1, 200, ok([]))).toEqual({ appid: 1, result: 'none' });
    expect(achievementsOf(1, 200, ok('nada'))).toEqual({ appid: 1, result: 'unavailable' });
    expect(achievementsOf(1, 200, { playerstats: { success: false } })).toEqual({
      appid: 1,
      result: 'unavailable',
    });
    expect(achievementsOf(1, 200, null)).toEqual({ appid: 1, result: 'unavailable' });
  });

  it('403 con el JSON de Steam, hidden; 403 sin él, unavailable; 400 de Steam, none', () => {
    const steamError = (error: string) => ({ playerstats: { error, success: false } });
    expect(achievementsOf(1, 403, steamError('Profile is not public'))).toEqual({
      appid: 1,
      result: 'hidden',
    });
    expect(achievementsOf(1, 403, null)).toEqual({ appid: 1, result: 'unavailable' });
    expect(achievementsOf(1, 400, steamError('Requested app has no stats'))).toEqual({
      appid: 1,
      result: 'none',
    });
    expect(achievementsOf(1, 500, ok([{ achieved: 1 }]))).toEqual({
      appid: 1,
      result: 'unavailable',
    });
  });
});
