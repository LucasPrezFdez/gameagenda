// Cuentas de punta a punta (ADR-014): el motor de la app (fachada, *runtime*, PBKDF2 y cliente de
// la micro-API) contra la micro-API de verdad. Un dispositivo crea la cuenta con email y
// contraseña; otro, sin código ni llave, entra con ellos y recibe la agenda. La contraseña no sale
// del dispositivo: el servidor no la ve en ninguna petición.

import { afterEach, describe, expect, it } from 'vitest';
import { deriveAuthKey } from '../../src/sync/account-key.ts';
import { SyncError } from '../../src/sync/types.ts';
import { createHarness, dumpAllText } from './harness.ts';
import { Replica, type ReplicaOptions } from './sync-client-support.ts';

const EMAIL = 'Lucas@Example.com';
const PASSWORD = 'una frase larga de prueba';

const open: Replica[] = [];

async function replica(h: ReturnType<typeof createHarness>, options: ReplicaOptions = {}) {
  const r = await Replica.open(h, options);
  open.push(r);
  return r;
}

afterEach(async () => {
  for (const r of open.splice(0)) {
    expect(r.errors).toEqual([]);
    await r.closeTab();
  }
});

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof SyncError ? error.code : String(error);
  }
  return 'ok';
}

describe('cuentas con email y contraseña', () => {
  it('se crea en el PC, se entra desde un móvil nuevo y llega la agenda', async () => {
    const h = createHarness();
    const pc = await replica(h);
    pc.agenda.capture({ id: 'steam:730', title: 'Counter-Strike 2' });
    const { recoveryCode } = await pc.sync.createAccount({
      email: EMAIL,
      password: PASSWORD,
      label: 'Chrome en Windows',
      minAge: 14,
    });
    expect(recoveryCode).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){6}$/);
    await pc.drain();
    expect(await pc.sync.localAccount()).toMatchObject({ email: 'lucas@example.com' });
    expect(await pc.sync.account()).toEqual({ hasLogin: true, steam: null });

    const phone = await replica(h);
    phone.agenda.capture({ id: 'steam:570', title: 'Dota 2' });
    await phone.sync.logIn({ email: ' lucas@EXAMPLE.com', password: PASSWORD, label: 'iPhone' });
    await phone.drain();
    await pc.syncNow();
    // Lo que había en el móvil se junta con lo de la cuenta.
    for (const r of [pc, phone]) {
      expect(
        r
          .memory()
          .map((e) => e.id)
          .sort(),
      ).toEqual(['steam:570', 'steam:730']);
    }
    // La contraseña no ha viajado: ni en las peticiones ni en D1.
    expect(JSON.stringify(h.db.rows('SELECT * FROM account_login'))).not.toContain(PASSWORD);
    expect(dumpAllText(h.db)).not.toContain('example.com');
  });

  it('una contraseña mala da invalid_login y no cambia nada', async () => {
    const h = createHarness();
    const pc = await replica(h);
    await pc.sync.createAccount({ email: EMAIL, password: PASSWORD, label: 'PC', minAge: 14 });
    const phone = await replica(h);
    const code = await codeOf(
      phone.sync.logIn({ email: EMAIL, password: 'otra frase distinta', label: 'iPhone' }),
    );
    expect(code).toBe('invalid_login');
    expect(phone.sync.getSnapshot().status).toBe('off');
    expect(await phone.sync.localAccount()).toMatchObject({ email: null });
  });

  it('cambiar la contraseña: la nueva vale en otro dispositivo, la vieja no', async () => {
    const h = createHarness();
    const pc = await replica(h);
    await pc.sync.createAccount({ email: EMAIL, password: PASSWORD, label: 'PC', minAge: 14 });
    const next = 'otra frase larga nueva';
    expect(await pc.sync.setLoginDetails({ email: EMAIL, password: next })).toEqual({
      hasLogin: true,
      steam: null,
    });
    const phone = await replica(h);
    expect(
      await codeOf(phone.sync.logIn({ email: EMAIL, password: PASSWORD, label: 'iPhone' })),
    ).toBe('invalid_login');
    await phone.sync.logIn({ email: EMAIL, password: next, label: 'iPhone' });
    expect(phone.sync.getSnapshot().status).not.toBe('off');
  });

  it('cerrar sesión olvida el email de este dispositivo', async () => {
    const h = createHarness();
    const pc = await replica(h);
    await pc.sync.createAccount({ email: EMAIL, password: PASSWORD, label: 'PC', minAge: 14 });
    const devices = await pc.sync.listDevices();
    const self = devices.find((d) => d.current)?.id ?? '';
    expect((await pc.sync.revokeDevice(self)).self).toBe(true);
    expect(pc.sync.getSnapshot().status).toBe('off');
    expect(await pc.sync.localAccount()).toMatchObject({ email: null });
  });

  it('PBKDF2: la misma clave para el mismo email escrito de otra forma, otra con otro email', async () => {
    const a = await deriveAuthKey('Lucas@Example.com', PASSWORD, 1000);
    expect(await deriveAuthKey('  lucas@example.COM ', PASSWORD, 1000)).toBe(a);
    expect(await deriveAuthKey('otra@example.com', PASSWORD, 1000)).not.toBe(a);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
