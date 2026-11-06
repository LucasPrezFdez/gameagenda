// Agenda y dispositivos en la micro-API (§5.2, §7.7 y §11.4; RF-27; CA4.4 y CA4.7).

import { FORMATTED_CODE_LENGTH, parseCode } from '@gameagenda/core/api';
import { describe, expect, it } from 'vitest';
import { createAgenda, createHarness, dumpAllText } from './harness.ts';

const AGENDA = { ageConfirmed: true, minAge: 14, label: 'Chrome en Windows' };

describe('POST /api/v1/agenda', () => {
  it('crea la agenda y el dispositivo, pone la cookie __Host- y devuelve el código una vez', async () => {
    const h = createHarness();
    const client = h.client();
    const response = await client.post('/api/v1/agenda', AGENDA);
    expect(response.status).toBe(201);
    expect(response.json.deviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.json.recoveryCode).toHaveLength(FORMATTED_CODE_LENGTH);
    expect(parseCode(response.json.recoveryCode)).not.toBeNull();

    const [device, hint] = response.setCookies;
    expect(device).toMatch(/^__Host-ga_device=[A-Za-z0-9_-]{43};/);
    for (const attr of ['Max-Age=34560000', 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax']) {
      expect(device).toContain(attr);
    }
    expect(device).not.toContain('Domain');
    expect(hint).toMatch(/^__Host-ga_sync=1;/);
    expect(hint).toContain('Secure');
    expect(hint).not.toContain('HttpOnly');

    expect(h.db.rows('SELECT id, kind, label FROM device')).toEqual([
      { id: response.json.deviceId, kind: 'app', label: 'Chrome en Windows' },
    ]);
    const [agenda] = h.db.rows<{ created_at: string; seq: number }>('SELECT * FROM agenda');
    expect(agenda).toMatchObject({ seq: 0, created_at: '2026-11-06T12:00:00.000Z' });
  });

  it('D1 no guarda en claro ni la credencial ni el código de recuperación (CA4.4)', async () => {
    const h = createHarness();
    const client = h.client();
    const { recoveryCode } = await createAgenda(client);
    const token = client.cookies.get('__Host-ga_device') ?? '';
    expect(token).toHaveLength(43);
    const text = dumpAllText(h.db);
    expect(text).not.toContain(token);
    expect(text).not.toContain(parseCode(recoveryCode));
    expect(text).not.toContain(recoveryCode);
  });

  it('la edad declarada tiene que ser la que pide el servidor (R-10)', async () => {
    const h = createHarness({ MIN_AGE: '16' });
    const response = await h.client().post('/api/v1/agenda', AGENDA);
    expect(response.status).toBe(409);
    expect(response.json).toEqual({ error: 'age_policy_changed' });
    expect((await h.client().post('/api/v1/agenda', { ...AGENDA, minAge: 16 })).status).toBe(201);
  });

  it('un dispositivo ya emparejado no crea otra agenda', async () => {
    const h = createHarness();
    const client = h.client();
    await createAgenda(client);
    const again = await client.post('/api/v1/agenda', AGENDA);
    expect(again.status).toBe(409);
    expect(again.json).toEqual({ error: 'already_paired' });
    expect(h.db.rows('SELECT * FROM agenda')).toHaveLength(1);
  });
});

describe('cookie de dispositivo', () => {
  it('sin cookie, o con una que no vale, da 401; si había cookies, las quita', async () => {
    const h = createHarness();
    const none = await h.client().get('/api/v1/devices');
    expect(none.status).toBe(401);
    expect(none.setCookies).toEqual([]);

    const forged = h.client();
    forged.cookies.set('__Host-ga_device', 'A'.repeat(43));
    forged.cookies.set('__Host-ga_sync', '1');
    const response = await forged.get('/api/v1/devices');
    expect(response.status).toBe(401);
    expect(response.json).toEqual({ error: 'unauthorized' });
    expect(response.setCookies.join('\n')).toMatch(/__Host-ga_device=;.*Max-Age=0/);
    expect(forged.cookies.size).toBe(0);
  });

  it('la cookie sin el prefijo __Host- no vale', async () => {
    const h = createHarness();
    const client = h.client();
    await createAgenda(client);
    const token = client.cookies.get('__Host-ga_device') ?? '';
    const bare = h.client();
    bare.cookies.set('ga_device', token);
    expect((await bare.get('/api/v1/devices')).status).toBe(401);
  });
});

describe('dispositivos (RF-27)', () => {
  it('lista los de la agenda, marca el actual y revoca otro', async () => {
    const h = createHarness();
    const pc = h.client();
    const { deviceId: pcId } = await createAgenda(pc);
    const { json: pairing } = await pc.post('/api/v1/pairing');
    h.clock.ms += 60_000;
    const phone = h.client();
    const { json: redeemed } = await phone.post('/api/v1/pairing/redeem', {
      code: pairing.code,
      label: 'Safari en iPhone',
    });

    const list = await pc.get('/api/v1/devices');
    expect(list.json.devices).toEqual([
      {
        id: pcId,
        kind: 'app',
        label: 'Chrome en Windows',
        createdAt: '2026-11-06T12:00:00.000Z',
        lastSeenAt: '2026-11-06T12:00:00.000Z',
        current: true,
      },
      {
        id: redeemed.deviceId,
        kind: 'app',
        label: 'Safari en iPhone',
        createdAt: '2026-11-06T12:01:00.000Z',
        lastSeenAt: '2026-11-06T12:01:00.000Z',
        current: false,
      },
    ]);

    const revoke = await pc.post(`/api/v1/devices/${redeemed.deviceId}/revoke`);
    expect(revoke.json).toEqual({ ok: true });
    expect(revoke.setCookies).toEqual([]);
    expect((await phone.get('/api/v1/devices')).status).toBe(401);
    expect((await pc.get('/api/v1/devices')).json.devices).toHaveLength(1);
    // Revocar borra la fila: el hash no se guarda más allá de la revocación (§11.2).
    expect(h.db.rows('SELECT id FROM device')).toEqual([{ id: pcId }]);
  });

  it('revocarse a sí mismo es desemparejar: quita la cookie', async () => {
    const h = createHarness();
    const client = h.client();
    const { deviceId } = await createAgenda(client);
    const response = await client.post(`/api/v1/devices/${deviceId}/revoke`);
    expect(response.status).toBe(200);
    expect(client.cookies.size).toBe(0);
    expect((await client.get('/api/v1/devices')).status).toBe(401);
  });

  it('no revoca dispositivos de otra agenda ni ids inventados', async () => {
    const h = createHarness();
    const mine = h.client();
    await createAgenda(mine);
    const other = h.client();
    const { deviceId: otherId } = await createAgenda(other);
    for (const id of [otherId, 'nada']) {
      const response = await mine.post(`/api/v1/devices/${id}/revoke`);
      expect(response.status).toBe(404);
    }
    expect((await other.get('/api/v1/devices')).status).toBe(200);
  });

  it('revocar exige un cuerpo {} y Origin propio', async () => {
    const h = createHarness();
    const client = h.client();
    const { deviceId } = await createAgenda(client);
    const path = `/api/v1/devices/${deviceId}/revoke`;
    expect((await client.post(path, { force: true })).status).toBe(400);
    expect((await client.post(path, {}, { origin: 'https://evil.test' })).status).toBe(403);
    expect((await client.get('/api/v1/devices')).status).toBe(200);
  });
});

describe('POST /api/v1/agenda/delete (CA4.7)', () => {
  it('borra en cascada la agenda y todo lo suyo, y quita la cookie', async () => {
    const h = createHarness();
    const pc = h.client();
    await createAgenda(pc);
    await pc.post('/api/v1/pairing');
    const keep = h.client();
    await createAgenda(keep, 'Otra agenda');
    // Operaciones y buzón de la agenda que se borra, escritos a mano hasta que existan sus rutas.
    const [{ agenda_id: agendaId } = { agenda_id: '' }] = h.db.rows<{ agenda_id: string }>(
      "SELECT agenda_id FROM device WHERE label = 'Chrome en Windows'",
    );
    h.db.rows(
      `INSERT INTO op (agenda_id, entry_id, field, value, hlc, seq)
       VALUES (?, 'steam:730', 'status', '"playing"', '1793178900000-0000-k3x9p2qa', 1)`,
      agendaId,
    );
    h.db.rows(
      `INSERT INTO inbox_item (id, agenda_id, url, created_at)
       VALUES ('i1', ?, 'https://store.steampowered.com/app/730/', '2026-11-06T12:00:00.000Z')`,
      agendaId,
    );

    expect((await pc.post('/api/v1/agenda/delete', {})).status).toBe(400);
    const response = await pc.post('/api/v1/agenda/delete', { confirm: true });
    expect(response.json).toEqual({ ok: true });
    expect(pc.cookies.size).toBe(0);
    for (const table of ['device', 'pairing_token', 'op', 'inbox_item']) {
      expect(h.db.rows(`SELECT * FROM ${table} WHERE agenda_id = ?`, agendaId), table).toEqual([]);
    }
    expect(h.db.rows('SELECT * FROM agenda WHERE id = ?', agendaId)).toEqual([]);
    expect(h.db.rows('SELECT * FROM agenda')).toHaveLength(1);
    expect((await keep.get('/api/v1/devices')).status).toBe(200);
  });
});
