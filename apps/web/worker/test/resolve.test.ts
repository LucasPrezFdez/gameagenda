// `GET /api/v1/resolve/<appid>` (§5.2 y §7.3; CA4.5): el nombre de un juego que no está en el
// catálogo local, con `GetItems` de Steam sin clave y la caché `resolve_cache` de D1.

import { RESOLVE_MISS_TTL_MS, RESOLVE_NAME_MAX, RESOLVE_TTL_MS } from '@gameagenda/core/api';
import { describe, expect, it } from 'vitest';
import { cleanName, steamUrl } from '../routes/resolve.ts';
import { createHarness } from './harness.ts';

describe('resolve', () => {
  it('pregunta a Steam sin clave, en español y para España, y lo guarda en la caché', async () => {
    const h = createHarness();
    h.steam.names.set(4000001, 'Juego Nuevo');
    const response = await h.client().get('/api/v1/resolve/4000001');
    expect(response.status).toBe(200);
    expect(response.json).toEqual({ appid: 4000001, name: 'Juego Nuevo' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(h.steam.calls).toEqual([steamUrl(4000001, 'ES')]);
    const input = JSON.parse(new URL(h.steam.calls[0] ?? '').searchParams.get('input_json') ?? '');
    expect(input).toEqual({
      ids: [{ appid: 4000001 }],
      context: { language: 'spanish', country_code: 'ES' },
    });
    expect(h.steam.calls[0]).not.toMatch(/key/i);
    expect(h.db.rows('SELECT * FROM resolve_cache')).toEqual([
      { appid: 4000001, name: 'Juego Nuevo', fetched_at: '2026-11-06T12:00:00.000Z' },
    ]);
    // La segunda vez, de la caché.
    h.steam.names.set(4000001, 'Otro nombre');
    expect((await h.client().get('/api/v1/resolve/4000001')).json.name).toBe('Juego Nuevo');
    expect(h.steam.calls).toHaveLength(1);
  });

  it('un nombre vale 30 días; «no lo conoce», 1 día', async () => {
    const h = createHarness();
    h.steam.names.set(10, 'Primero');
    await h.client().get('/api/v1/resolve/10');
    expect((await h.client().get('/api/v1/resolve/20')).json).toEqual({ appid: 20, name: null });
    h.steam.names.set(10, 'Cambiado');
    h.steam.names.set(20, 'Ya publicado');
    h.clock.ms += RESOLVE_MISS_TTL_MS - 1;
    expect((await h.client().get('/api/v1/resolve/20')).json.name).toBeNull();
    h.clock.ms += 1;
    expect((await h.client().get('/api/v1/resolve/20')).json.name).toBe('Ya publicado');
    expect((await h.client().get('/api/v1/resolve/10')).json.name).toBe('Primero');
    h.clock.ms += RESOLVE_TTL_MS;
    expect((await h.client().get('/api/v1/resolve/10')).json.name).toBe('Cambiado');
  });

  it('bloqueado en España: lo pide para EE. UU.', async () => {
    const h = createHarness();
    h.steam.blockedInEs.set(500, 'Solo fuera');
    expect((await h.client().get('/api/v1/resolve/500')).json).toEqual({
      appid: 500,
      name: 'Solo fuera',
    });
    expect(h.steam.calls).toEqual([steamUrl(500, 'ES'), steamUrl(500, 'US')]);
  });

  it('si Steam falla, vale la caché aunque sea vieja; sin caché, 502 y no guarda nada', async () => {
    const h = createHarness();
    h.steam.names.set(30, 'Guardado');
    await h.client().get('/api/v1/resolve/30');
    h.clock.ms += RESOLVE_TTL_MS + 1;
    for (const fail of ['network', 'status', 'garbage'] as const) {
      h.steam.fail = fail;
      expect((await h.client().get('/api/v1/resolve/30')).json.name, fail).toBe('Guardado');
      const missing = await h.client().get('/api/v1/resolve/31');
      expect(missing.status, fail).toBe(502);
      expect(missing.json).toEqual({ error: 'steam_unavailable' });
    }
    expect(h.db.rows('SELECT appid FROM resolve_cache')).toEqual([{ appid: 30 }]);
  });

  it('`appid` mal formado: 404 sin llamar a Steam', async () => {
    const h = createHarness();
    for (const raw of ['0', '0730', 'abc', '730a', '4294967296', '12345678901', '-1']) {
      expect((await h.client().get(`/api/v1/resolve/${raw}`)).status, raw).toBe(404);
    }
    expect(h.steam.calls).toEqual([]);
    expect(h.limits.resolve.counts.size).toBe(0);
  });

  it('límite por IP (429) y sin credencial: no lee ni pone cookies', async () => {
    const h = createHarness();
    h.limits.resolve.max = 1;
    h.steam.names.set(1, 'Uno');
    const client = h.client('198.51.100.20');
    const ok = await client.get('/api/v1/resolve/1');
    expect(ok.status).toBe(200);
    expect(ok.setCookies).toEqual([]);
    expect((await client.get('/api/v1/resolve/1')).status).toBe(429);
    expect((await h.client('198.51.100.21').get('/api/v1/resolve/1')).status).toBe(200);
    // Al límite le llega el SHA-256 de la IP, no la IP.
    expect([...h.limits.resolve.counts.keys()].join()).not.toContain('198.51.100');
  });

  it('nada cambia por POST: no hay ruta', async () => {
    const h = createHarness();
    expect((await h.client().post('/api/v1/resolve/1')).status).toBe(404);
  });

  it('el interruptor apagado también la cierra', async () => {
    const h = createHarness({ SYNC_ENABLED: '0' });
    expect((await h.client().get('/api/v1/resolve/1')).status).toBe(503);
    expect(h.steam.calls).toEqual([]);
  });
});

describe('cleanName', () => {
  it('sin caracteres de control, espacios juntos y con tope sin partir un emoji', () => {
    expect(cleanName('  Hades\u0000 II\n\t ')).toBe('Hades II');
    expect(cleanName('a'.repeat(RESOLVE_NAME_MAX + 10))).toHaveLength(RESOLVE_NAME_MAX);
    const emoji = `${'a'.repeat(RESOLVE_NAME_MAX - 1)}😀`;
    expect(cleanName(emoji)).toBe('a'.repeat(RESOLVE_NAME_MAX - 1));
  });
});
