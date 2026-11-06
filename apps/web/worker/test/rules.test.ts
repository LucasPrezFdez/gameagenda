// Reglas de petición de la micro-API (§11.4) y encaminamiento de `ga-web` (ADR-011).

import { describe, expect, it, vi } from 'vitest';
import type { D1Database } from '../env.ts';
import { createAgenda, createHarness, ORIGIN } from './harness.ts';

const AGENDA = { ageConfirmed: true, minAge: 14, label: 'Chrome en Windows' };

describe('encaminamiento', () => {
  it('lo que no es /api/* va a los assets (el fallback de la SPA)', async () => {
    const h = createHarness();
    const response = await h.client().get('/juego/steam:730');
    expect(response.status).toBe(200);
    expect(response.json).toBe('asset /juego/steam:730');
  });

  it('una ruta desconocida de /api da 404 en JSON, con las cabeceras de la API', async () => {
    const h = createHarness();
    const response = await h.client().get('/api/v1/nada');
    expect(response.status).toBe(404);
    expect(response.json).toEqual({ error: 'not_found' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('cabeceras', () => {
  it('toda respuesta de /api lleva no-store, nosniff y una CSP que no deja cargar nada', async () => {
    const h = createHarness();
    const client = h.client();
    const ok = await client.post('/api/v1/agenda', AGENDA);
    const error = await h.client().get('/api/v1/devices');
    expect(error.status).toBe(401);
    for (const response of [ok, error]) {
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(response.headers.get('Content-Security-Policy')).toBe(
        "default-src 'none'; frame-ancestors 'none'",
      );
      expect(response.headers.get('Content-Type')).toMatch(/^application\/json/);
    }
  });
});

describe('interruptor (CA4.7: no antes de los textos legales)', () => {
  it('con SYNC_ENABLED distinto de 1, todo /api responde 503 y no toca D1', async () => {
    const h = createHarness({ SYNC_ENABLED: '0' });
    const client = h.client();
    const response = await client.post('/api/v1/agenda', AGENDA);
    expect(response.status).toBe(503);
    expect(response.json).toEqual({ error: 'sync_disabled' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(h.db.rows('SELECT * FROM agenda')).toHaveLength(0);
    expect((await client.get('/api/v1/devices')).status).toBe(503);
  });
});

describe('peticiones que cambian algo (§11.4)', () => {
  it('sin Origin, o con uno ajeno, da 403', async () => {
    const h = createHarness();
    const client = h.client();
    expect((await client.post('/api/v1/agenda', AGENDA, { origin: null })).json).toEqual({
      error: 'bad_origin',
    });
    const other = await client.post('/api/v1/agenda', AGENDA, { origin: 'https://evil.test' });
    expect(other.status).toBe(403);
    expect(h.db.rows('SELECT * FROM agenda')).toHaveLength(0);
  });

  it('sin Content-Type JSON da 415, aunque el cuerpo sea JSON', async () => {
    const h = createHarness();
    const client = h.client();
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
      const response = await client.post('/api/v1/agenda', AGENDA, {
        headers: { 'Content-Type': type },
      });
      expect(response.status).toBe(415);
    }
    const withCharset = await client.post('/api/v1/agenda', AGENDA, {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
    expect(withCharset.status).toBe(201);
  });

  it('un GET no necesita Origin', async () => {
    const h = createHarness();
    const client = h.client();
    await createAgenda(client);
    expect((await client.get('/api/v1/devices', { origin: null })).status).toBe(200);
  });
});

describe('cuerpos', () => {
  it('un cuerpo de más de 1 KiB da 413, con Content-Length o sin él', async () => {
    const h = createHarness();
    const client = h.client();
    const big = JSON.stringify({ ...AGENDA, label: 'x'.repeat(2000) });
    expect((await client.post('/api/v1/agenda', big)).status).toBe(413);
    // Sin Content-Length: el cuerpo llega como *stream* y se corta al pasar del límite.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 4; i++) controller.enqueue(new TextEncoder().encode(big.slice(0, 600)));
        controller.close();
      },
    });
    const response = await h.app.request(
      `${ORIGIN}/api/v1/agenda`,
      {
        method: 'POST',
        headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
        body: stream,
        duplex: 'half',
      } as RequestInit,
      h.env,
    );
    expect(response.status).toBe(413);
  });

  it('JSON roto, UTF-8 roto, campos de más o que faltan dan 400', async () => {
    const h = createHarness();
    const client = h.client();
    const bodies: unknown[] = [
      '{"ageConfirmed": tru',
      { ...AGENDA, extra: 1 },
      { ...AGENDA, ageConfirmed: false },
      { minAge: 14, label: 'x' },
      { ...AGENDA, label: '' },
      { ...AGENDA, label: 'con\u0007campana' },
      { ...AGENDA, minAge: 14.5 },
    ];
    for (const body of bodies) {
      const response = await client.post('/api/v1/agenda', body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.json).toEqual({ error: 'invalid_body' });
    }
    const broken = await h.app.request(
      `${ORIGIN}/api/v1/agenda`,
      {
        method: 'POST',
        headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
        body: new Uint8Array([0x7b, 0xff, 0x7d]),
      },
      h.env,
    );
    expect(broken.status).toBe(400);
    expect(h.db.rows('SELECT * FROM agenda')).toHaveLength(0);
  });
});

describe('límites por IP (§11.4)', () => {
  it('pasado el límite da 429, y al binding le llega el hash de la IP, no la IP', async () => {
    const h = createHarness();
    h.limits.agenda.max = 2;
    const a = h.client('198.51.100.7');
    const b = h.client('198.51.100.7');
    const c = h.client('198.51.100.7');
    expect((await a.post('/api/v1/agenda', AGENDA)).status).toBe(201);
    expect((await b.post('/api/v1/agenda', AGENDA)).status).toBe(201);
    const third = await c.post('/api/v1/agenda', AGENDA);
    expect(third.status).toBe(429);
    expect(third.json).toEqual({ error: 'rate_limited' });
    expect(h.db.rows('SELECT * FROM agenda')).toHaveLength(2);
    // Otra IP sigue pudiendo.
    expect((await h.client('198.51.100.8').post('/api/v1/agenda', AGENDA)).status).toBe(201);
    const keys = [...h.limits.agenda.counts.keys()];
    expect(keys).toHaveLength(2);
    for (const key of keys) {
      expect(key).toMatch(/^[0-9a-f]{64}$/);
      expect(key).not.toContain('198.51');
    }
  });
});

describe('errores internos', () => {
  it('dan 500 sin detalles, y el registro no lleva el cuerpo ni la cookie', async () => {
    const failing: D1Database = {
      prepare: () => {
        throw new Error('D1 caído: SELECT … secreto');
      },
      batch: async () => {
        throw new Error('D1 caído');
      },
    };
    const h = createHarness({ DB: failing });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const client = h.client();
      client.cookies.set('__Host-ga_device', 'token-secreto');
      const response = await client.post('/api/v1/pairing/redeem', {
        code: 'CODIGO-SECRETO',
        label: 'Android',
      });
      expect(response.status).toBe(500);
      expect(response.json).toEqual({ error: 'internal' });
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      const logged = log.mock.calls.flat().join(' ');
      expect(logged).toContain('/api/v1/pairing/redeem');
      expect(logged).not.toMatch(/secreto|CODIGO/i);
    } finally {
      log.mockRestore();
    }
  });
});
