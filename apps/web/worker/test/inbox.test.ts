// Buzón del Atajo de iOS (§5.2 y §11.4; RF-08; CA4.5): el *token* de solo escritura, el enlace que
// deja el Atajo y su entrega a las apps en `sync`, con la confirmación en la petición siguiente.

import { INBOX_MAX_PENDING, INBOX_PAGE_SIZE } from '@gameagenda/core/api';
import { describe, expect, it } from 'vitest';
import { INBOX_MESSAGES } from '../routes/inbox.ts';
import { type Client, createAgenda, createHarness, dumpAllText, type Harness } from './harness.ts';
import { addOps, hlc } from './sync-support.ts';

const LINK = 'https://store.steampowered.com/app/1145360/Hades/?snr=1_7_15__13';

async function setup(h: Harness = createHarness()) {
  const pc = h.client();
  await createAgenda(pc);
  const created = await pc.post('/api/v1/inbox/token', { label: 'Atajo de iOS' });
  expect(created.status).toBe(201);
  return { h, pc, token: created.json.token as string, deviceId: created.json.deviceId as string };
}

/** Lo que manda el Atajo: sin `Origin`, sin cookies y con el *token* en `Authorization`. */
function shortcut(h: Harness, token: string, url: string, ip = '198.51.100.7') {
  return h
    .client(ip)
    .post(
      '/api/v1/inbox',
      { url },
      { origin: null, headers: { Authorization: `Bearer ${token}` } },
    );
}

async function syncWith(client: Client, body: Record<string, unknown> = {}) {
  return client.post('/api/v1/sync', { cursor: 0, purgedSeq: 0, ops: [], ...body });
}

describe('el token del buzón', () => {
  it('se crea con la cookie, se ve en la lista como `inbox` y D1 solo guarda su hash', async () => {
    const { h, pc, token, deviceId } = await setup();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(dumpAllText(h.db)).not.toContain(token);
    // No toca las cookies de la app que lo pide.
    const devices = (await pc.get('/api/v1/devices')).json.devices;
    expect(devices).toMatchObject([
      { kind: 'app', current: true },
      { id: deviceId, kind: 'inbox', label: 'Atajo de iOS', current: false },
    ]);
    expect(pc.cookies.get('__Host-ga_device')).toHaveLength(43);
  });

  it('sin cookie, 401; con un nombre vacío o con campos de más, 400', async () => {
    const h = createHarness();
    expect((await h.client().post('/api/v1/inbox/token', { label: 'Atajo' })).status).toBe(401);
    const pc = h.client();
    await createAgenda(pc);
    expect((await pc.post('/api/v1/inbox/token', { label: '  ' })).status).toBe(400);
    expect((await pc.post('/api/v1/inbox/token', { label: 'A', x: 1 })).status).toBe(400);
  });

  it('el token del buzón no vale como cookie de la app (ni para sincronizar)', async () => {
    const { h, token } = await setup();
    const thief = h.client();
    thief.cookies.set('__Host-ga_device', token);
    expect((await syncWith(thief)).status).toBe(401);
    expect((await thief.get('/api/v1/devices')).status).toBe(401);
  });
});

describe('POST /api/v1/inbox', () => {
  it('guarda el enlace canónico, sin repetir el juego, y responde con un mensaje', async () => {
    const { h, token } = await setup();
    const first = await shortcut(h, token, `Mira este juego: ${LINK}`);
    expect(first.status).toBe(201);
    expect(first.json).toEqual({ ok: true, appid: 1145360, message: INBOX_MESSAGES.queued });
    // El mismo juego con otro *slug* o de otra forma no se repite.
    const again = await shortcut(h, token, 'https://s.team/a/1145360');
    expect(again.status).toBe(200);
    expect(again.json.ok).toBe(true);
    // Otro juego con un `appid` que empieza igual sí entra.
    expect((await shortcut(h, token, 'store.steampowered.com/app/11453600/')).status).toBe(201);
    expect(h.db.rows('SELECT url FROM inbox_item ORDER BY rowid')).toEqual([
      { url: 'https://store.steampowered.com/app/1145360/Hades' },
      { url: 'https://store.steampowered.com/app/11453600/' },
    ]);
    // Y las respuestas, con las cabeceras de la micro-API.
    expect(first.headers.get('Cache-Control')).toBe('no-store');
  });

  it('sin token, con uno inventado o revocado: 401, sin tocar D1 si no tiene forma de token', async () => {
    const { h, pc, token, deviceId } = await setup();
    for (const authorization of [undefined, 'Bearer corto', `Basic ${token}`, token]) {
      const headers: Record<string, string> = authorization ? { Authorization: authorization } : {};
      const response = await h
        .client()
        .post('/api/v1/inbox', { url: LINK }, { origin: null, headers });
      expect(response.status, String(authorization)).toBe(401);
      expect(response.json).toEqual({
        error: 'unauthorized',
        message: INBOX_MESSAGES.unauthorized,
      });
    }
    expect(h.limits.inbox.counts.size).toBe(0);
    const invented = 'A'.repeat(43);
    expect((await shortcut(h, invented, LINK)).status).toBe(401);
    // Revocado desde Ajustes (CA4.5): 401.
    expect((await pc.post(`/api/v1/devices/${deviceId}/revoke`)).status).toBe(200);
    expect((await shortcut(h, token, LINK)).status).toBe(401);
    expect(h.db.rows('SELECT * FROM inbox_item')).toEqual([]);
  });

  it('no mira Origin ni acepta la cookie de la app; sí pide JSON', async () => {
    const { h, pc, token } = await setup();
    // La cookie de la app no sirve en el buzón.
    const withCookie = await pc.post('/api/v1/inbox', { url: LINK });
    expect(withCookie.status).toBe(401);
    // Con otro Origin (un navegador) y el token, vale: lo que cuenta es el token.
    const otherOrigin = await h
      .client()
      .post(
        '/api/v1/inbox',
        { url: LINK },
        { origin: 'https://otra.example', headers: { Authorization: `Bearer ${token}` } },
      );
    expect(otherOrigin.status).toBe(201);
    const text = await h.client().post('/api/v1/inbox', JSON.stringify({ url: LINK }), {
      origin: null,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
    });
    expect(text.status).toBe(415);
  });

  it('solo enlaces de Steam; cuerpo con tope', async () => {
    const { h, token } = await setup();
    for (const url of ['https://example.com/app/730', 'hola', '']) {
      const response = await shortcut(h, token, url);
      expect(response.status, url).toBe(400);
      expect(response.json.error).toBe('invalid_link');
    }
    expect((await shortcut(h, token, `${LINK} ${'x'.repeat(3000)}`)).status).toBe(400);
    expect(h.db.rows('SELECT * FROM inbox_item')).toEqual([]);
  });

  it('límite por token (429) y tope de enlaces pendientes (409 `inbox_full`)', async () => {
    const { h, token } = await setup();
    h.limits.inbox.max = 2;
    expect((await shortcut(h, token, 'appid:1')).status).toBe(201);
    expect((await shortcut(h, token, 'appid:2', '203.0.113.9')).status).toBe(201);
    const limited = await shortcut(h, token, 'appid:3');
    expect(limited.status).toBe(429);
    expect(limited.json.message).toBe(INBOX_MESSAGES.rate_limited);
    h.limits.inbox.max = Number.POSITIVE_INFINITY;
    for (let appid = 3; appid <= INBOX_MAX_PENDING; appid++) {
      expect((await shortcut(h, token, `appid:${appid}`)).status).toBe(201);
    }
    const full = await shortcut(h, token, `appid:${INBOX_MAX_PENDING + 1}`);
    expect(full.status).toBe(409);
    expect(full.json).toEqual({ error: 'inbox_full', message: INBOX_MESSAGES.inbox_full });
    // Uno que ya espera no es «lleno».
    expect((await shortcut(h, token, 'appid:7')).status).toBe(200);
  });

  it('con el interruptor apagado, 503 como el resto de la micro-API', async () => {
    const { h, token } = await setup();
    h.env.SYNC_ENABLED = '0';
    expect((await shortcut(h, token, LINK)).status).toBe(503);
  });
});

describe('el buzón en `sync`', () => {
  it('llega a las apps en la última página y sale al confirmarlo (CA4.5)', async () => {
    const { h, pc, token } = await setup();
    await shortcut(h, token, LINK);
    await shortcut(h, token, 'https://store.steampowered.com/app/2379780/Balatro/');
    const first = await syncWith(pc);
    expect(first.status).toBe(200);
    expect(first.json.inbox).toEqual([
      { id: expect.any(String), url: 'https://store.steampowered.com/app/1145360/Hades' },
      { id: expect.any(String), url: 'https://store.steampowered.com/app/2379780/Balatro' },
    ]);
    // Confirmar uno lo borra; el otro sigue llegando.
    const [hades, balatro] = first.json.inbox;
    const second = await syncWith(pc, { inboxAck: [hades.id] });
    expect(second.json.inbox).toEqual([balatro]);
    const third = await syncWith(pc, { inboxAck: [balatro.id, 'id-inventado'] });
    expect(third.json.inbox).toEqual([]);
    expect(h.db.rows('SELECT * FROM inbox_item')).toEqual([]);
  });

  it('una agenda no ve ni borra el buzón de otra', async () => {
    const a = await setup();
    const b = await setup(a.h);
    await shortcut(a.h, a.token, LINK);
    const [item] = (await syncWith(a.pc)).json.inbox;
    expect((await syncWith(b.pc, { inboxAck: [item.id] })).json.inbox).toEqual([]);
    expect((await syncWith(a.pc)).json.inbox).toEqual([item]);
  });

  it('con más páginas por bajar no se entrega; por respuesta, como mucho INBOX_PAGE_SIZE', async () => {
    const h = createHarness({}, { pageSize: 2 });
    const { pc, token } = await setup(h);
    await pc.post('/api/v1/sync', {
      cursor: 0,
      purgedSeq: 0,
      ops: addOps('steam:730', 'Counter-Strike 2', hlc(h.clock.ms)),
    });
    for (let appid = 1; appid <= INBOX_PAGE_SIZE + 3; appid++) {
      await shortcut(h, token, `appid:${appid}`);
    }
    const page = await syncWith(pc);
    expect(page.json.more).toBe(true);
    expect(page.json.inbox).toEqual([]);
    let cursor = page.json.cursor;
    let last = page.json;
    while (last.more) {
      last = (await syncWith(pc, { cursor })).json;
      cursor = last.cursor;
    }
    expect(last.inbox).toHaveLength(INBOX_PAGE_SIZE);
  });

  it('confirmar más de la cuenta o con ids raros: 400', async () => {
    const { pc } = await setup();
    const many = Array.from({ length: 201 }, (_, i) => `id-${i}`);
    expect((await syncWith(pc, { inboxAck: many })).status).toBe(400);
    expect((await syncWith(pc, { inboxAck: ['x'.repeat(65)] })).status).toBe(400);
  });

  it('«Borrar todos mis datos» se lleva el buzón y su token', async () => {
    const { h, pc, token } = await setup();
    await shortcut(h, token, LINK);
    expect((await pc.post('/api/v1/agenda/delete', { confirm: true })).status).toBe(200);
    expect(h.db.rows('SELECT * FROM inbox_item')).toEqual([]);
    expect(h.db.rows('SELECT * FROM device')).toEqual([]);
    expect((await shortcut(h, token, LINK)).status).toBe(401);
  });
});
