// Llaves de acceso de punta a punta (ADR-013): el motor de la app (fachada, *runtime* y cliente
// de la micro-API) contra la micro-API de verdad, con un llavero falso que firma con claves de
// WebCrypto. Un dispositivo crea la llave; otro, sin código ni emparejar, entra con ella y recibe
// la agenda.

import { afterEach, describe, expect, it } from 'vitest';
import { SyncError } from '../../src/sync/types.ts';
import { createHarness } from './harness.ts';
import { FakeAuthenticator, webAuthnHost } from './passkey-support.ts';
import { Replica, type ReplicaOptions } from './sync-client-support.ts';

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

describe('llaves de acceso', () => {
  it('una llave creada en el PC abre la agenda en un móvil nuevo, con sus juegos', async () => {
    const h = createHarness();
    const key = await FakeAuthenticator.create(-7);
    const pc = await replica(h, { webAuthn: webAuthnHost(key) });
    await pc.activate();
    pc.agenda.capture({ id: 'steam:730', title: 'Counter-Strike 2' });
    await pc.syncNow();

    const created = await pc.sync.createPasskey();
    expect(created.map((p) => p.label)).toEqual(['Chrome en Windows']);
    expect(await pc.sync.listPasskeys()).toEqual(created);

    const phone = await replica(h, { webAuthn: webAuthnHost(key) });
    expect(phone.sync.getSnapshot().status).toBe('off');
    await phone.sync.redeemPasskey('Safari en iPhone');
    await phone.drain();
    expect(phone.memory().map((e) => e.id)).toEqual(['steam:730']);
    expect(phone.sync.getSnapshot().status).not.toBe('off');
    const devices = await phone.sync.listDevices();
    // Con el mismo reloj, el orden es el de los ids (aleatorios): se compara sin orden.
    expect(devices.map((d) => d.label).sort()).toEqual(['Chrome en Windows', 'Safari en iPhone']);
  });

  it('cerrar el diálogo del navegador no es un error, y no cambia nada', async () => {
    const h = createHarness();
    const key = await FakeAuthenticator.create(-8);
    const pc = await replica(h, { webAuthn: webAuthnHost(key, { name: 'NotAllowedError' }) });
    await pc.activate();
    expect(await codeOf(pc.sync.createPasskey())).toBe('passkey_cancelled');
    expect(h.db.rows('SELECT * FROM passkey')).toEqual([]);

    const phone = await replica(h, { webAuthn: webAuthnHost(key, { name: 'NotAllowedError' }) });
    expect(await codeOf(phone.sync.redeemPasskey('Safari en iPhone'))).toBe('passkey_cancelled');
    expect(phone.sync.getSnapshot().status).toBe('off');
  });

  it('si ese llavero ya tiene una llave de la agenda: `passkey_exists`', async () => {
    const h = createHarness();
    const key = await FakeAuthenticator.create(-7);
    const pc = await replica(h, { webAuthn: webAuthnHost(key, { name: 'InvalidStateError' }) });
    await pc.activate();
    expect(await codeOf(pc.sync.createPasskey())).toBe('passkey_exists');
  });

  it('una llave quitada ya no abre la agenda', async () => {
    const h = createHarness();
    const key = await FakeAuthenticator.create(-257);
    const pc = await replica(h, { webAuthn: webAuthnHost(key) });
    await pc.activate();
    const [created] = await pc.sync.createPasskey();
    expect(await pc.sync.removePasskey(created?.id ?? '')).toEqual([]);

    const phone = await replica(h, { webAuthn: webAuthnHost(key) });
    expect(await codeOf(phone.sync.redeemPasskey('Safari en iPhone'))).toBe('invalid_passkey');
    expect(phone.sync.getSnapshot().status).toBe('off');
  });

  it('sin sincronizar, crear o ver las llaves no llama al servidor', async () => {
    const h = createHarness();
    const key = await FakeAuthenticator.create(-7);
    const pc = await replica(h, { webAuthn: webAuthnHost(key) });
    expect(await codeOf(pc.sync.createPasskey())).not.toBe('ok');
    expect(await codeOf(pc.sync.listPasskeys())).not.toBe('ok');
    expect(h.db.rows('SELECT * FROM webauthn_challenge')).toEqual([]);
  });
});
