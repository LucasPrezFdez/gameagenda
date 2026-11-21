// `POST /api/v1/steam/types` (Software, DECISIONES §10.57): con el pase de `redeem`, qué apps de la
// biblioteca son software y no juegos, según la tienda de Steam. Cada comprobación, con su prueba.

import {
  STEAM_IMPORT_TOKEN_TTL_MS,
  STEAM_TYPES_BATCH,
  steamTypesResponseSchema,
} from '@gameagenda/core/api';
import { describe, expect, it, vi } from 'vitest';
import { utcDay } from '../maintenance.ts';
import { fetchSoftware, typesUrl } from '../steam-types.ts';
import { type Client, createHarness, dumpAllText, type Harness, T0 } from './harness.ts';
import { begin, callback, STEAM_ID, TEST_STEAM_KEY } from './steam-support.ts';

const ITEMS_PREFIX = 'https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?';
const WALLPAPER_ENGINE = 431960;
const BLENDER = 365670;
const CS2 = 730;

/** Inicia sesión y canjea, como la app: devuelve el pase. */
async function imported(h: Harness, client: Client): Promise<string> {
  const { ticket, verifier, returnTo } = await begin(client);
  await callback(client, ticket, h.steam.openid.assertion(returnTo));
  const response = await client.post('/api/v1/steam/redeem', { ticket, verifier });
  if (response.status !== 200) throw new Error(`redeem: ${response.status}`);
  return response.json.token as string;
}

function types(client: Client, token: string, appids: readonly number[]) {
  return client.post('/api/v1/steam/types', { token, appids });
}

function itemCalls(h: Harness): string[] {
  return h.steam.calls.filter((url) => url.startsWith(ITEMS_PREFIX));
}

function quota(h: Harness): unknown[] {
  return h.db.rows('SELECT day, calls FROM steam_quota');
}

function software(h: Harness): void {
  h.steam.software.add(WALLPAPER_ENGINE);
  h.steam.software.add(BLENDER);
  h.steam.names.set(CS2, 'Counter-Strike 2');
}

describe('con un pase bueno', () => {
  it('dice cuáles de las pedidas son software; lo que Steam no conoce cuenta como juego', async () => {
    const h = createHarness();
    const pc = h.client();
    software(h);
    const token = await imported(h, pc);
    // 220: Steam «no lo conoce» (success 15, sin type).
    const response = await types(pc, token, [CS2, WALLPAPER_ENGINE, 220, BLENDER]);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.json).toEqual({ software: [WALLPAPER_ENGINE, BLENDER] });
    expect(steamTypesResponseSchema.safeParse(response.json).success).toBe(true);
  });

  it('una sola llamada a la tienda, sin la clave ni el SteamID64', async () => {
    const h = createHarness();
    const pc = h.client();
    const token = await imported(h, pc);
    const before = h.steam.calls.length;
    await types(pc, token, [CS2, WALLPAPER_ENGINE]);
    const calls = h.steam.calls.slice(before);
    expect(calls).toEqual([typesUrl([CS2, WALLPAPER_ENGINE])]);
    expect(calls[0]).not.toContain(STEAM_ID);
    expect(calls[0]).not.toContain(TEST_STEAM_KEY);
  });

  it(`un lote entero (${STEAM_TYPES_BATCH}) es una llamada`, async () => {
    const h = createHarness();
    const pc = h.client();
    const token = await imported(h, pc);
    const many = Array.from({ length: STEAM_TYPES_BATCH }, (_, i) => i + 1);
    expect((await types(pc, token, many)).status).toBe(200);
    expect(itemCalls(h)).toHaveLength(1);
  });

  it('suma 1 al tope diario; D1 no guarda nada más y no se registra nada', async () => {
    const h = createHarness();
    const pc = h.client();
    software(h);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const token = await imported(h, pc); // callback 1 + redeem 2
      await types(pc, token, [WALLPAPER_ENGINE, CS2]);
      expect(quota(h)).toEqual([{ day: utcDay(T0), calls: 4 }]);
      const text = dumpAllText(h.db);
      for (const leak of [STEAM_ID, token, String(WALLPAPER_ENGINE), TEST_STEAM_KEY]) {
        expect(text).not.toContain(leak);
      }
      expect(errors).not.toHaveBeenCalled();
      expect(logs).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
      logs.mockRestore();
    }
  });
});

describe('el pase', () => {
  it('caducado, inventado o de otra clave: 410, sin llamar a la tienda', async () => {
    const h = createHarness();
    const pc = h.client();
    const token = await imported(h, pc);
    h.clock.ms += STEAM_IMPORT_TOKEN_TTL_MS;
    for (const bad of [token, 'A'.repeat(79)]) {
      const response = await types(pc, bad, [WALLPAPER_ENGINE]);
      expect(response.status).toBe(410);
      expect(response.json).toEqual({ error: 'steam_token_invalid' });
    }
    expect(itemCalls(h)).toEqual([]);
  });
});

describe('peticiones que no valen', () => {
  it('cuerpo con otra forma, 400, sin llamar a la tienda ni gastar del tope', async () => {
    const h = createHarness();
    const pc = h.client();
    const token = await imported(h, pc);
    const tooMany = Array.from({ length: STEAM_TYPES_BATCH + 1 }, (_, i) => i + 1);
    for (const body of [
      { token, appids: [] },
      { token, appids: tooMany },
      { token, appids: [10, 10] },
      { token, appids: [0] },
      { token, appids: ['10'] },
      { token, appids: [10], extra: true },
      { appids: [10] },
    ]) {
      const response = await pc.post('/api/v1/steam/types', body);
      expect(response.status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
    expect(itemCalls(h)).toEqual([]);
    expect(quota(h)).toEqual([{ day: utcDay(T0), calls: 3 }]);
  });

  it('con STEAM_ENABLED a "0", 503 steam_disabled antes de todo', async () => {
    const h = createHarness();
    const pc = h.client();
    const token = await imported(h, pc);
    h.env.STEAM_ENABLED = '0';
    const response = await types(pc, token, [10]);
    expect(response.status).toBe(503);
    expect(response.json).toEqual({ error: 'steam_disabled' });
    expect(itemCalls(h)).toEqual([]);
  });
});

describe('límites', () => {
  it('RL_STEAM_ACH, por IP: el 429 llega antes de leer el cuerpo', async () => {
    const h = createHarness();
    const pc = h.client('203.0.113.9');
    const token = await imported(h, pc);
    h.limits.steamAch.max = 1;
    expect((await types(pc, token, [1])).status).toBe(200);
    const limited = await types(pc, token, [2]);
    expect(limited.status).toBe(429);
    expect(limited.json).toEqual({ error: 'rate_limited' });
    expect(itemCalls(h)).toHaveLength(1);
  });

  it('sin sitio en el tope diario, 503 steam_busy sin llamar', async () => {
    const h = createHarness({}, { steamDailyCalls: 3 });
    const pc = h.client();
    const token = await imported(h, pc); // 3
    const busy = await types(pc, token, [WALLPAPER_ENGINE]);
    expect(busy.status).toBe(503);
    expect(busy.json).toEqual({ error: 'steam_busy' });
    expect(itemCalls(h)).toEqual([]);
  });
});

describe('si la tienda falla', () => {
  for (const fail of ['network', 'status', 'garbage', 'huge'] as const) {
    it(`${fail}: 502 steam_unavailable (la app sigue, con todo como juegos)`, async () => {
      const h = createHarness();
      const pc = h.client();
      const token = await imported(h, pc);
      h.steam.fail = fail;
      const response = await types(pc, token, [WALLPAPER_ENGINE]);
      expect(response.status).toBe(502);
      expect(response.json).toEqual({ error: 'steam_unavailable' });
    });
  }
});

describe('fetchSoftware', () => {
  const reply = (items: unknown[]) => async () =>
    Response.json({ response: { store_items: items } });

  it('solo las pedidas, con success 1 y type 6', async () => {
    const software = await fetchSoftware(
      [1, 2, 3, 4],
      reply([
        { appid: 1, success: 1, type: 6 },
        { appid: 2, success: 1, type: 0 },
        { appid: 3, success: 15, type: 6 },
        { appid: 9, success: 1, type: 6 },
        { appid: 1, success: 1, type: 6 },
        { success: 1, type: 6 },
      ]),
    );
    expect(software).toEqual([1]);
  });

  it('sin store_items, ninguna; con otra forma, null', async () => {
    expect(await fetchSoftware([1], async () => Response.json({ response: {} }))).toEqual([]);
    expect(await fetchSoftware([1], async () => Response.json({ nada: 1 }))).toBeNull();
  });
});
