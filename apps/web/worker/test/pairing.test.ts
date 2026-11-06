// Emparejar y recuperar (§11.4; RF-25; CA4.3 y CA4.4).

import { FORMATTED_CODE_LENGTH, PAIRING_TTL_MS, parseCode } from '@gameagenda/core/api';
import { describe, expect, it } from 'vitest';
import { createAgenda, createHarness, dumpAllText } from './harness.ts';

const LABEL = 'Chrome en Android';

describe('emparejar', () => {
  it('un código de un solo uso empareja el dispositivo nuevo en la misma agenda', async () => {
    const h = createHarness();
    const pc = h.client();
    await createAgenda(pc);
    const pairing = await pc.post('/api/v1/pairing');
    expect(pairing.status).toBe(201);
    expect(pairing.json.code).toHaveLength(FORMATTED_CODE_LENGTH);
    expect(pairing.json.expiresAt).toBe('2026-11-06T12:10:00.000Z');
    expect(dumpAllText(h.db)).not.toContain(parseCode(pairing.json.code));

    h.clock.ms += 30_000;
    const phone = h.client();
    const redeem = await phone.post('/api/v1/pairing/redeem', {
      code: pairing.json.code,
      label: LABEL,
    });
    expect(redeem.status).toBe(201);
    expect(phone.cookies.get('__Host-ga_device')).toHaveLength(43);
    expect(phone.cookies.get('__Host-ga_sync')).toBe('1');
    const devices = (await phone.get('/api/v1/devices')).json.devices;
    expect(devices.map((d: { label: string }) => d.label)).toEqual(['Chrome en Windows', LABEL]);
    // Canjearlo lo borra.
    expect(h.db.rows('SELECT * FROM pairing_token')).toEqual([]);
  });

  it('acepta el código en minúsculas, sin guiones, con espacios y con O, I y L', async () => {
    const h = createHarness();
    const pc = h.client();
    await createAgenda(pc);
    const { json } = await pc.post('/api/v1/pairing');
    const canonical = parseCode(json.code) ?? '';
    const typed = ` ${canonical.toLowerCase().replace(/0/g, 'o').replace(/1/g, 'l')} `;
    const response = await h.client().post('/api/v1/pairing/redeem', { code: typed, label: LABEL });
    expect(response.status).toBe(201);
  });

  it('un código usado, caducado (>10 min) o inventado se rechaza igual (CA4.4)', async () => {
    const h = createHarness();
    const pc = h.client();
    await createAgenda(pc);

    const used = (await pc.post('/api/v1/pairing')).json.code;
    expect(
      (await h.client().post('/api/v1/pairing/redeem', { code: used, label: LABEL })).status,
    ).toBe(201);
    const expired = (await pc.post('/api/v1/pairing')).json.code;
    h.clock.ms += PAIRING_TTL_MS;
    const invented = 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345';
    for (const code of [used, expired, invented, 'corto', '']) {
      const response = await h.client().post('/api/v1/pairing/redeem', { code, label: LABEL });
      expect(response.status, code).toBe(400);
      expect(response.json).toEqual({ error: 'invalid_code' });
    }
    expect(h.db.rows('SELECT * FROM device')).toHaveLength(2);
  });

  it('justo antes de caducar todavía vale', async () => {
    const h = createHarness();
    const pc = h.client();
    await createAgenda(pc);
    const { code } = (await pc.post('/api/v1/pairing')).json;
    h.clock.ms += PAIRING_TTL_MS - 1;
    expect((await h.client().post('/api/v1/pairing/redeem', { code, label: LABEL })).status).toBe(
      201,
    );
  });

  it('pedir un código exige estar emparejado; crear otro limpia los caducados', async () => {
    const h = createHarness();
    expect((await h.client().post('/api/v1/pairing')).status).toBe(401);
    const pc = h.client();
    await createAgenda(pc);
    await pc.post('/api/v1/pairing');
    await pc.post('/api/v1/pairing');
    h.clock.ms += PAIRING_TTL_MS;
    await pc.post('/api/v1/pairing');
    expect(h.db.rows('SELECT expires_at FROM pairing_token')).toEqual([
      { expires_at: '2026-11-06T12:20:00.000Z' },
    ]);
  });

  it('un dispositivo ya emparejado no canjea códigos, y el código sigue sin usar', async () => {
    const h = createHarness();
    const pc = h.client();
    await createAgenda(pc);
    const other = h.client();
    await createAgenda(other, 'Otra agenda');
    const { code } = (await pc.post('/api/v1/pairing')).json;
    const response = await other.post('/api/v1/pairing/redeem', { code, label: LABEL });
    expect(response.json).toEqual({ error: 'already_paired' });
    expect((await h.client().post('/api/v1/pairing/redeem', { code, label: LABEL })).status).toBe(
      201,
    );
  });

  it('canjear tiene límite por IP', async () => {
    const h = createHarness();
    h.limits.redeem.max = 3;
    const attacker = h.client('203.0.113.9');
    const codes = ['a', 'b', 'c', 'd'].map((x) => x.repeat(28));
    const statuses: number[] = [];
    for (const code of codes) {
      statuses.push((await attacker.post('/api/v1/pairing/redeem', { code, label: LABEL })).status);
    }
    expect(statuses).toEqual([400, 400, 400, 429]);
  });
});

describe('recuperar (CA4.3)', () => {
  it('el código de recuperación da un dispositivo nuevo y sigue valiendo', async () => {
    const h = createHarness();
    const lost = h.client();
    const { recoveryCode } = await createAgenda(lost);
    for (const label of ['Chrome reinstalado', 'Safari en iPhone']) {
      const fresh = h.client();
      const response = await fresh.post('/api/v1/recovery/redeem', { code: recoveryCode, label });
      expect(response.status).toBe(201);
      expect((await fresh.get('/api/v1/devices')).json.devices).toHaveLength(
        label === 'Chrome reinstalado' ? 2 : 3,
      );
    }
  });

  it('crear uno nuevo invalida el anterior', async () => {
    const h = createHarness();
    const pc = h.client();
    const { recoveryCode: old } = await createAgenda(pc);
    const rotated = await pc.post('/api/v1/recovery');
    expect(rotated.status).toBe(201);
    const fresh = rotated.json.recoveryCode as string;
    expect(fresh).not.toBe(old);
    expect(dumpAllText(h.db)).not.toContain(parseCode(fresh));

    const withOld = await h.client().post('/api/v1/recovery/redeem', { code: old, label: LABEL });
    expect(withOld.json).toEqual({ error: 'invalid_code' });
    const withNew = await h.client().post('/api/v1/recovery/redeem', { code: fresh, label: LABEL });
    expect(withNew.status).toBe(201);
  });

  it('un código inventado o el de otra agenda borrada no valen', async () => {
    const h = createHarness();
    const pc = h.client();
    const { recoveryCode } = await createAgenda(pc);
    await pc.post('/api/v1/agenda/delete', { confirm: true });
    for (const code of [recoveryCode, 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ']) {
      const response = await h.client().post('/api/v1/recovery/redeem', { code, label: LABEL });
      expect(response.json).toEqual({ error: 'invalid_code' });
    }
  });
});
