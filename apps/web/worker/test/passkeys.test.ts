// Llaves de acceso (ADR-013): crear una desde un dispositivo de la agenda, entrar con ella desde
// uno nuevo, quitarla, y cada rechazo (todos con la misma respuesta, `invalid_passkey`).

import {
  PASSKEY_ALGORITHMS,
  PASSKEY_CHALLENGE_TTL_MS,
  PASSKEYS_MAX,
  type PasskeyAlgorithm,
} from '@gameagenda/core/api';
import { describe, expect, it } from 'vitest';
import { purgeSteamTickets } from '../maintenance.ts';
import { derToRaw, parseAuthenticatorData } from '../webauthn.ts';
import { type Client, createAgenda, createHarness, dumpAllText, type Harness } from './harness.ts';
import {
  type CeremonyOverrides,
  FakeAuthenticator,
  RP_ID,
  rawToDer,
  tamper,
} from './passkey-support.ts';

const PHONE = 'Safari en iPhone';

/** Crea una llave en la agenda de `client` y la devuelve, con la respuesta de `POST /passkeys`. */
async function addPasskey(client: Client, alg: PasskeyAlgorithm = -7, signCount = 0) {
  const key = await FakeAuthenticator.create(alg, signCount);
  const options = await client.post('/api/v1/passkeys/options');
  expect(options.status).toBe(201);
  const response = await client.post('/api/v1/passkeys', await key.register(options.json));
  return { key, response };
}

/** Pide un reto y entra con `key` desde un cliente nuevo. */
async function redeem(h: Harness, key: FakeAuthenticator, overrides: CeremonyOverrides = {}) {
  const phone = h.client();
  const challenge = await phone.post('/api/v1/passkeys/challenge');
  expect(challenge.status).toBe(201);
  const response = await phone.post(
    '/api/v1/passkeys/redeem',
    await key.assert(challenge.json, PHONE, overrides),
  );
  return { phone, response };
}

describe('crear una llave y entrar con ella', () => {
  it.each(PASSKEY_ALGORITHMS)(
    'con el algoritmo %i, abre la misma agenda en un dispositivo nuevo',
    async (alg) => {
      const h = createHarness();
      const pc = h.client();
      await createAgenda(pc);
      const { key, response } = await addPasskey(pc, alg);
      expect(response.status).toBe(201);
      expect(response.json.passkeys).toEqual([
        {
          id: key.id,
          label: 'Chrome en Windows',
          createdAt: '2026-11-06T12:00:00.000Z',
          lastUsedAt: null,
        },
      ]);
      expect(response.json.rpId).toBe(RP_ID);
      expect(response.json.userId).toBe(key.userHandle);

      h.clock.ms += 60_000;
      const { phone, response: entered } = await redeem(h, key);
      expect(entered.status).toBe(201);
      expect(phone.cookies.get('__Host-ga_device')).toHaveLength(43);
      expect(phone.cookies.get('__Host-ga_sync')).toBe('1');
      const devices = (await phone.get('/api/v1/devices')).json.devices;
      expect(devices.map((d: { label: string }) => d.label)).toEqual(['Chrome en Windows', PHONE]);
      const listed = (await phone.get('/api/v1/passkeys')).json.passkeys;
      expect(listed[0].lastUsedAt).toBe('2026-11-06T12:01:00.000Z');
      // Gastar los retos los borra; en D1 solo hay *hashes* de los que queden.
      expect(h.db.rows('SELECT * FROM webauthn_challenge')).toEqual([]);
    },
  );

  it('las opciones dan un `user.id` por agenda, el mismo siempre, y las llaves que ya tiene', async () => {
    const h = createHarness();
    const pc = h.client();
    await createAgenda(pc);
    const first = await addPasskey(pc);
    const options = (await pc.post('/api/v1/passkeys/options')).json;
    expect(options.userId).toBe(first.key.userHandle);
    expect(options.userId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(options.rpId).toBe(RP_ID);
    // Los transportes que no se conocen no se guardan.
    expect(options.excludeCredentials).toEqual([
      { id: first.key.id, transports: ['internal', 'hybrid'] },
    ]);
    expect(dumpAllText(h.db)).not.toContain(options.challenge);

    const other = h.client();
    await createAgenda(other);
    const theirs = (await other.post('/api/v1/passkeys/options')).json;
    expect(theirs.userId).not.toBe(options.userId);
    expect(theirs.excludeCredentials).toEqual([]);
  });

  it('una llave con contador (un autenticador físico) entra mientras el contador sube', async () => {
    const h = createHarness();
    const pc = h.client();
    await createAgenda(pc);
    const { key } = await addPasskey(pc, -7, 5);
    expect((await redeem(h, key)).response.status).toBe(201);
    expect(h.db.rows('SELECT sign_count FROM passkey')).toEqual([{ sign_count: 6 }]);
    // Una copia de la llave que se queda atrás: el contador no sube.
    key.signCount = 3;
    expect((await redeem(h, key)).response.json).toEqual({ error: 'invalid_passkey' });
  });
});

describe('entrar: cada rechazo da la misma respuesta', () => {
  async function setup() {
    const h = createHarness();
    const pc = h.client();
    await createAgenda(pc);
    const { key } = await addPasskey(pc);
    return { h, pc, key };
  }

  async function expectRejected(h: Harness, body: unknown, phone: Client = h.client()) {
    const response = await phone.post('/api/v1/passkeys/redeem', body);
    expect(response.status).toBe(400);
    expect(response.json).toEqual({ error: 'invalid_passkey' });
    expect(phone.cookies.size).toBe(0);
  }

  it('un reto gastado, caducado, inventado o de crear', async () => {
    const { h, pc, key } = await setup();
    const phone = h.client();
    const challenge = (await phone.post('/api/v1/passkeys/challenge')).json;
    const body = await key.assert(challenge, PHONE);
    expect((await phone.post('/api/v1/passkeys/redeem', body)).status).toBe(201);
    await expectRejected(h, body);

    const late = (await h.client().post('/api/v1/passkeys/challenge')).json;
    h.clock.ms += PASSKEY_CHALLENGE_TTL_MS;
    await expectRejected(h, await key.assert(late, PHONE));

    await expectRejected(h, await key.assert({ challenge: 'inventado', rpId: RP_ID }, PHONE));
    const create = (await pc.post('/api/v1/passkeys/options')).json;
    await expectRejected(h, await key.assert(create, PHONE));
  });

  it('otro tipo, otro origen, otro `rp.id`, sin UV o sin UP', async () => {
    const { h, key } = await setup();
    const cases: CeremonyOverrides[] = [
      { type: 'webauthn.create' },
      { origin: 'https://ga-web.evil.test' },
      { rpId: 'evil.test' },
      { flags: 0x01 },
      { flags: 0x04 },
    ];
    for (const overrides of cases) {
      const phone = h.client();
      const challenge = (await phone.post('/api/v1/passkeys/challenge')).json;
      await expectRejected(h, await key.assert(challenge, PHONE, overrides), phone);
    }
  });

  it('la firma, `clientDataJSON` o `authenticatorData` tocados después de firmar', async () => {
    const { h, key } = await setup();
    const touch = {
      signature: (value: string) => tamper(value, 34),
      // Un byte del contador: el resto de comprobaciones pasan, solo falla la firma.
      authenticatorData: (value: string) => tamper(value, 34),
      // Un campo de más: sigue siendo JSON con el mismo reto y el mismo origen.
      clientDataJSON: (value: string) => {
        const data = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
        return Buffer.from(JSON.stringify({ ...data, other: 'x' })).toString('base64url');
      },
    };
    for (const [field, change] of Object.entries(touch)) {
      const phone = h.client();
      const challenge = (await phone.post('/api/v1/passkeys/challenge')).json;
      const body = await key.assert(challenge, PHONE);
      const value = body[field as keyof typeof touch];
      await expectRejected(h, { ...body, [field]: change(value) }, phone);
    }
  });

  it('una llave que no está en ninguna agenda, o con el `userHandle` de otra', async () => {
    const { h, key } = await setup();
    const stranger = await FakeAuthenticator.create(-7);
    const phone = h.client();
    let challenge = (await phone.post('/api/v1/passkeys/challenge')).json;
    await expectRejected(h, await stranger.assert(challenge, PHONE), phone);

    challenge = (await phone.post('/api/v1/passkeys/challenge')).json;
    const body = await key.assert(challenge, PHONE);
    await expectRejected(h, { ...body, userHandle: 'AAAA' }, phone);
  });

  it('una llave quitada ya no abre la agenda', async () => {
    const { h, pc, key } = await setup();
    const removed = await pc.post(`/api/v1/passkeys/${key.id}/remove`);
    expect(removed.status).toBe(200);
    expect(removed.json.passkeys).toEqual([]);
    expect((await redeem(h, key)).response.json).toEqual({ error: 'invalid_passkey' });
  });

  it('con cookie de un dispositivo ya emparejado: `already_paired`', async () => {
    const { h, pc, key } = await setup();
    expect((await pc.post('/api/v1/passkeys/challenge')).json).toEqual({ error: 'already_paired' });
    const challenge = (await h.client().post('/api/v1/passkeys/challenge')).json;
    const response = await pc.post('/api/v1/passkeys/redeem', await key.assert(challenge, PHONE));
    expect(response.json).toEqual({ error: 'already_paired' });
  });

  it('pedir retos y entrar cuentan en el límite de canjes por IP', async () => {
    const { h, key } = await setup();
    h.limits.redeem.max = 2;
    const phone = h.client();
    const challenge = (await phone.post('/api/v1/passkeys/challenge')).json;
    expect(
      (await phone.post('/api/v1/passkeys/redeem', await key.assert(challenge, PHONE))).status,
    ).toBe(201);
    const blocked = await h.client(phone.ip).post('/api/v1/passkeys/challenge');
    expect(blocked.status).toBe(429);
  });
});

describe('crear: rechazos', () => {
  it('el reto de otra agenda, uno gastado o uno de entrar', async () => {
    const h = createHarness();
    const pc = h.client();
    const other = h.client();
    await createAgenda(pc);
    await createAgenda(other);
    const key = await FakeAuthenticator.create();
    const theirs = (await other.post('/api/v1/passkeys/options')).json;
    let response = await pc.post('/api/v1/passkeys', await key.register(theirs));
    expect(response.json).toEqual({ error: 'invalid_passkey' });

    const mine = (await pc.post('/api/v1/passkeys/options')).json;
    const body = await key.register(mine);
    expect((await pc.post('/api/v1/passkeys', body)).status).toBe(201);
    response = await pc.post('/api/v1/passkeys', body);
    expect(response.json).toEqual({ error: 'invalid_passkey' });

    const get = (await h.client().post('/api/v1/passkeys/challenge')).json;
    response = await pc.post(
      '/api/v1/passkeys',
      await key.register({ ...get, userId: mine.userId }),
    );
    expect(response.json).toEqual({ error: 'invalid_passkey' });
  });

  it('otro id, otro tipo, sin AT, otro algoritmo o una clave que no es del algoritmo', async () => {
    const h = createHarness();
    const pc = h.client();
    await createAgenda(pc);
    const key = await FakeAuthenticator.create(-7);
    const ed25519 = await FakeAuthenticator.create(-8);
    const cases: ((o: { challenge: string; rpId: string; userId: string }) => Promise<unknown>)[] =
      [
        (o) => key.register(o, { id: 'b3Rybw' }),
        (o) => key.register(o, { type: 'webauthn.get' }),
        (o) => key.register(o, { flags: 0x05 }),
        (o) => key.register(o, { rpId: 'evil.test' }),
        async (o) => ({ ...(await key.register(o)), publicKeyAlgorithm: -36 }),
        async (o) => ({ ...(await key.register(o)), publicKey: await ed25519.publicKeySpki() }),
      ];
    for (const make of cases) {
      const options = (await pc.post('/api/v1/passkeys/options')).json;
      const response = await pc.post('/api/v1/passkeys', await make(options));
      expect(response.json).toEqual({ error: 'invalid_passkey' });
    }
    expect(h.db.rows('SELECT * FROM passkey')).toEqual([]);
  });

  it('sin cookie, 401; y como mucho PASSKEYS_MAX llaves por agenda', async () => {
    const h = createHarness();
    expect((await h.client().post('/api/v1/passkeys/options')).status).toBe(401);
    expect((await h.client().get('/api/v1/passkeys')).status).toBe(401);
    const pc = h.client();
    await createAgenda(pc);
    for (let i = 0; i < PASSKEYS_MAX; i++) expect((await addPasskey(pc)).response.status).toBe(201);
    const full = await pc.post('/api/v1/passkeys/options');
    expect(full.status).toBe(409);
    expect(full.json).toEqual({ error: 'passkeys_full' });
  });
});

describe('quitar, borrar y apagar', () => {
  it('solo se quitan las llaves de la propia agenda', async () => {
    const h = createHarness();
    const pc = h.client();
    const other = h.client();
    await createAgenda(pc);
    await createAgenda(other);
    const { key } = await addPasskey(pc);
    expect((await other.post(`/api/v1/passkeys/${key.id}/remove`)).status).toBe(404);
    expect((await pc.post('/api/v1/passkeys/no-existe/remove')).status).toBe(404);
    expect(h.db.rows('SELECT id FROM passkey')).toEqual([{ id: key.id }]);
  });

  it('«Borrar todos mis datos» se lleva las llaves y los retos de la agenda', async () => {
    const h = createHarness();
    const pc = h.client();
    await createAgenda(pc);
    await addPasskey(pc);
    await pc.post('/api/v1/passkeys/options');
    expect((await pc.post('/api/v1/agenda/delete', { confirm: true })).status).toBe(200);
    expect(h.db.rows('SELECT * FROM passkey')).toEqual([]);
    expect(h.db.rows('SELECT * FROM webauthn_challenge')).toEqual([]);
  });

  it('el *cron* de cada 5 min se lleva los retos caducados, también los de entrar', async () => {
    const h = createHarness();
    const pc = h.client();
    await createAgenda(pc);
    await pc.post('/api/v1/passkeys/options');
    await h.client().post('/api/v1/passkeys/challenge');
    await purgeSteamTickets(h.db, h.clock.ms + PASSKEY_CHALLENGE_TTL_MS - 1);
    expect(h.db.rows('SELECT kind FROM webauthn_challenge ORDER BY kind')).toHaveLength(2);
    await purgeSteamTickets(h.db, h.clock.ms + PASSKEY_CHALLENGE_TTL_MS);
    expect(h.db.rows('SELECT * FROM webauthn_challenge')).toEqual([]);
  });

  it('con `PASSKEYS_ENABLED` a "0", las seis rutas responden `passkeys_disabled`', async () => {
    const h = createHarness({ PASSKEYS_ENABLED: '0' });
    const pc = h.client();
    await createAgenda(pc);
    const calls = [
      pc.post('/api/v1/passkeys/options'),
      pc.post('/api/v1/passkeys', {}),
      pc.get('/api/v1/passkeys'),
      pc.post('/api/v1/passkeys/x/remove'),
      h.client().post('/api/v1/passkeys/challenge'),
      h.client().post('/api/v1/passkeys/redeem', {}),
    ];
    for (const response of await Promise.all(calls)) {
      expect(response.status).toBe(503);
      expect(response.json).toEqual({ error: 'passkeys_disabled' });
    }
  });
});

describe('webauthn.ts', () => {
  it('`derToRaw` deja `r‖s` en 64 bytes, con ceros delante o sin ellos, y rechaza lo mal formado', () => {
    const raw = new Uint8Array(64);
    raw[0] = 0x80; // r con el bit alto: DER le pone un 0 delante
    raw[32] = 0x00;
    raw[33] = 0x01; // s con un cero delante: DER se lo quita
    raw[63] = 0x7f;
    const der = rawToDer(raw);
    expect(derToRaw(der)).toEqual(raw);
    expect(derToRaw(der.subarray(0, der.length - 1))).toBeNull();
    expect(derToRaw(new Uint8Array([0x31, 6, 2, 1, 1, 2, 1, 1]))).toBeNull();
    expect(derToRaw(new Uint8Array(0))).toBeNull();
  });

  it('`parseAuthenticatorData` rechaza lo que es más corto de lo que dice', () => {
    expect(parseAuthenticatorData(new Uint8Array(36))).toBeNull();
    const withAt = new Uint8Array(55);
    withAt[32] = 0x40;
    withAt[54] = 16; // dice 16 bytes de id, pero no los hay
    expect(parseAuthenticatorData(withAt)).toBeNull();
  });
});
