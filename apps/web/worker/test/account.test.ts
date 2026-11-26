// Cuentas con email y contraseña (ADR-014): crear la cuenta, entrar con ella desde otro
// dispositivo, el mismo error para un email desconocido y para una contraseña mala, el freno por
// email, poner, cambiar y quitar el email y la contraseña, y que D1 no guarde ni el email ni nada
// que sirva para entrar.

import {
  ACCOUNT_KDF,
  DEFAULT_MIN_AGE,
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_MS,
} from '@gameagenda/core/api';
import { describe, expect, it } from 'vitest';
import { base64url } from '../crypto.ts';
import { purgeSteamTickets } from '../maintenance.ts';
import { type Client, createAgenda, createHarness, dumpAllText } from './harness.ts';

const EMAIL = 'Lucas@Example.com';
/** Lo que saldría de la contraseña con PBKDF2 en el dispositivo: aquí, 256 bits cualquiera. */
function newAuthKey(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}
const AUTH_KEY = newAuthKey();

function createAccount(
  client: Client,
  email = EMAIL,
  authKey = AUTH_KEY,
  label = 'Chrome en Windows',
) {
  return client.post('/api/v1/account', {
    email,
    authKey,
    kdf: ACCOUNT_KDF,
    ageConfirmed: true,
    minAge: DEFAULT_MIN_AGE,
    label,
  });
}

function login(client: Client, email = EMAIL, authKey = AUTH_KEY, label = 'Safari en iPhone') {
  return client.post('/api/v1/account/login', { email, authKey, kdf: ACCOUNT_KDF, label });
}

function setLoginDetails(client: Client, email: string, authKey: string) {
  return client.post('/api/v1/account/login-details', { email, authKey, kdf: ACCOUNT_KDF });
}

describe('crear una cuenta', () => {
  it('crea la agenda con su dispositivo, pone la cookie y da el código de recuperación', async () => {
    const h = createHarness();
    const pc = h.client();
    const response = await createAccount(pc);
    expect(response.status).toBe(201);
    expect(response.json).toEqual({
      deviceId: expect.any(String),
      recoveryCode: expect.stringMatching(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){6}$/),
    });
    expect(pc.cookies.has('__Host-ga_device')).toBe(true);
    expect(pc.cookies.get('__Host-ga_sync')).toBe('1');
    expect(h.db.rows('SELECT id FROM agenda')).toHaveLength(1);
    expect(h.db.rows('SELECT kdf FROM account_login')).toEqual([{ kdf: ACCOUNT_KDF }]);
    expect((await pc.get('/api/v1/account')).json).toEqual({ hasLogin: true, steam: null });
  });

  it('D1 no guarda el email ni authKey, ni siquiera normalizados', async () => {
    const h = createHarness();
    await createAccount(h.client());
    const text = dumpAllText(h.db);
    expect(text.toLowerCase()).not.toContain('lucas@example.com');
    expect(text).not.toContain('example');
    expect(text).not.toContain(AUTH_KEY);
  });

  it('un email que ya tiene cuenta da email_taken, también escrito de otra forma', async () => {
    const h = createHarness();
    expect((await createAccount(h.client())).status).toBe(201);
    const other = h.client();
    const response = await createAccount(other, '  lucas@EXAMPLE.com ', newAuthKey());
    expect(response.status).toBe(409);
    expect(response.json).toEqual({ error: 'email_taken' });
    expect(other.cookies.size).toBe(0);
    // Y no deja una agenda a medias.
    expect(h.db.rows('SELECT id FROM agenda')).toHaveLength(1);
  });

  it('rechaza lo que no es un email, otro kdf, un authKey raro y la edad cambiada', async () => {
    const h = createHarness();
    const pc = h.client();
    expect((await createAccount(pc, 'sin-arroba')).json).toEqual({ error: 'invalid_body' });
    expect((await createAccount(pc, 'a @b.es')).json).toEqual({ error: 'invalid_body' });
    expect((await createAccount(pc, EMAIL, 'corto')).json).toEqual({ error: 'invalid_body' });
    const base = {
      email: EMAIL,
      authKey: AUTH_KEY,
      kdf: ACCOUNT_KDF,
      ageConfirmed: true,
      minAge: DEFAULT_MIN_AGE,
      label: 'PC',
    };
    const wrongKdf = await pc.post('/api/v1/account', { ...base, kdf: 'sha1' });
    expect(wrongKdf.json).toEqual({ error: 'invalid_body' });
    const extra = await pc.post('/api/v1/account', { ...base, password: 'hola' });
    expect(extra.json).toEqual({ error: 'invalid_body' });
    const age = await pc.post('/api/v1/account', { ...base, minAge: 16 });
    expect(age.json).toEqual({ error: 'age_policy_changed' });
    expect(h.db.rows('SELECT id FROM agenda')).toHaveLength(0);
  });

  it('un dispositivo ya sincronizado no crea otra: already_paired', async () => {
    const h = createHarness();
    const pc = h.client();
    await createAgenda(pc);
    expect((await createAccount(pc)).json).toEqual({ error: 'already_paired' });
  });

  it('cuenta en el límite de crear agendas (RL_AGENDA)', async () => {
    const h = createHarness();
    h.limits.agenda.max = 0;
    expect((await createAccount(h.client())).json).toEqual({ error: 'rate_limited' });
  });
});

describe('entrar', () => {
  it('con el email y la contraseña, un dispositivo nuevo en la misma agenda', async () => {
    const h = createHarness();
    const pc = h.client();
    await createAccount(pc);
    const phone = h.client();
    const response = await login(phone, ' LUCAS@example.COM');
    expect(response.status).toBe(201);
    expect(response.json).toEqual({ deviceId: expect.any(String) });
    expect(phone.cookies.has('__Host-ga_device')).toBe(true);
    const devices = (await pc.get('/api/v1/devices')).json.devices as { label: string }[];
    expect(devices.map((d) => d.label).sort()).toEqual(['Chrome en Windows', 'Safari en iPhone']);
    expect(h.db.rows('SELECT DISTINCT agenda_id FROM device')).toHaveLength(1);
  });

  it('un email desconocido y una contraseña mala dan lo mismo, sin cookies', async () => {
    const h = createHarness();
    await createAccount(h.client());
    const phone = h.client();
    const wrong = await login(phone, EMAIL, newAuthKey());
    const unknown = await login(phone, 'otra@example.com');
    const notEmail = await login(phone, 'no es un email');
    for (const response of [wrong, unknown, notEmail]) {
      expect(response.status).toBe(400);
      expect(response.json).toEqual({ error: 'invalid_login' });
      expect(response.setCookies).toEqual([]);
    }
    expect(h.db.rows('SELECT id FROM device')).toHaveLength(1);
  });

  it('ya sincronizado: already_paired', async () => {
    const h = createHarness();
    const pc = h.client();
    await createAccount(pc);
    expect((await login(pc)).json).toEqual({ error: 'already_paired' });
  });

  it('cuenta en RL_LOGIN, por IP', async () => {
    const h = createHarness();
    await createAccount(h.client());
    h.limits.login.max = 0;
    expect((await login(h.client())).json).toEqual({ error: 'rate_limited' });
  });
});

describe('el freno por email', () => {
  it(`con ${LOGIN_MAX_FAILURES} fallos en una hora, bloquea ese email aunque luego acierte`, async () => {
    const h = createHarness();
    await createAccount(h.client());
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
      expect((await login(h.client(), EMAIL, newAuthKey())).json).toEqual({
        error: 'invalid_login',
      });
    }
    const blocked = await login(h.client());
    expect(blocked.status).toBe(429);
    expect(blocked.json).toEqual({ error: 'too_many_attempts' });
    // Otro email, no.
    expect((await login(h.client(), 'otra@example.com')).json).toEqual({ error: 'invalid_login' });
    // Al acabar la hora, vuelve a dejar, y el acierto borra los fallos.
    h.clock.ms += LOGIN_WINDOW_MS + 1;
    expect((await login(h.client())).status).toBe(201);
    expect(h.db.rows('SELECT * FROM login_throttle')).toHaveLength(1);
  });

  it('bloquea igual un email que no tiene cuenta: el bloqueo no dice cuáles sí', async () => {
    const h = createHarness();
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) await login(h.client(), 'nadie@example.com');
    expect((await login(h.client(), 'nadie@example.com')).json).toEqual({
      error: 'too_many_attempts',
    });
  });

  it('la ventana empieza con el primer fallo, y uno después de la ventana empieza otra', async () => {
    const h = createHarness();
    await createAccount(h.client());
    for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++) await login(h.client(), EMAIL, newAuthKey());
    h.clock.ms += LOGIN_WINDOW_MS;
    await login(h.client(), EMAIL, newAuthKey());
    expect(h.db.rows('SELECT failures FROM login_throttle')).toEqual([{ failures: 1 }]);
    expect((await login(h.client())).status).toBe(201);
  });

  it('el cron de cada 5 min se lleva las ventanas acabadas', async () => {
    const h = createHarness();
    await login(h.client(), 'nadie@example.com');
    await purgeSteamTickets(h.db, h.clock.ms);
    expect(h.db.rows('SELECT * FROM login_throttle')).toHaveLength(1);
    await purgeSteamTickets(h.db, h.clock.ms + LOGIN_WINDOW_MS);
    expect(h.db.rows('SELECT * FROM login_throttle')).toHaveLength(0);
  });
});

describe('el email y la contraseña de una agenda', () => {
  it('una agenda sin email los añade, y con ellos se entra', async () => {
    const h = createHarness();
    const pc = h.client();
    await createAgenda(pc);
    expect((await pc.get('/api/v1/account')).json).toEqual({ hasLogin: false, steam: null });
    const response = await setLoginDetails(pc, EMAIL, AUTH_KEY);
    expect(response.status).toBe(200);
    expect(response.json).toEqual({ hasLogin: true, steam: null });
    expect((await login(h.client())).status).toBe(201);
  });

  it('cambiar la contraseña: la vieja ya no vale y no echa a nadie', async () => {
    const h = createHarness();
    const pc = h.client();
    await createAccount(pc);
    const phone = h.client();
    await login(phone);
    const next = newAuthKey();
    expect((await setLoginDetails(pc, EMAIL, next)).status).toBe(200);
    expect((await login(h.client())).json).toEqual({ error: 'invalid_login' });
    expect((await login(h.client(), EMAIL, next)).status).toBe(201);
    expect((await phone.get('/api/v1/account')).status).toBe(200);
  });

  it('cambiar el email: el viejo deja de valer', async () => {
    const h = createHarness();
    const pc = h.client();
    await createAccount(pc);
    const next = newAuthKey();
    expect((await setLoginDetails(pc, 'nuevo@example.com', next)).status).toBe(200);
    expect((await login(h.client(), EMAIL, AUTH_KEY)).json).toEqual({ error: 'invalid_login' });
    expect((await login(h.client(), 'nuevo@example.com', next)).status).toBe(201);
  });

  it('el email de otra cuenta: email_taken', async () => {
    const h = createHarness();
    await createAccount(h.client());
    const other = h.client();
    await createAgenda(other);
    const response = await setLoginDetails(other, EMAIL, newAuthKey());
    expect(response.status).toBe(409);
    expect(response.json).toEqual({ error: 'email_taken' });
    expect((await login(h.client())).status).toBe(201);
  });

  it('quitarlos deja la agenda, pero ya no se entra con ellos', async () => {
    const h = createHarness();
    const pc = h.client();
    await createAccount(pc);
    const response = await pc.post('/api/v1/account/login-details/remove', {});
    expect(response.json).toEqual({ hasLogin: false, steam: null });
    expect((await login(h.client())).json).toEqual({ error: 'invalid_login' });
    expect(h.db.rows('SELECT id FROM agenda')).toHaveLength(1);
  });

  it('sin cookie, 401', async () => {
    const h = createHarness();
    const anon = h.client();
    expect((await anon.get('/api/v1/account')).status).toBe(401);
    expect((await setLoginDetails(anon, EMAIL, AUTH_KEY)).status).toBe(401);
    expect((await anon.post('/api/v1/account/login-details/remove', {})).status).toBe(401);
  });

  it('«Borrar todos mis datos» se lleva la cuenta en cascada', async () => {
    const h = createHarness();
    const pc = h.client();
    await createAccount(pc);
    await pc.post('/api/v1/agenda/delete', { confirm: true });
    expect(h.db.rows('SELECT * FROM account_login')).toHaveLength(0);
    expect((await login(h.client())).json).toEqual({ error: 'invalid_login' });
  });
});

describe('el interruptor', () => {
  it('con ACCOUNTS_ENABLED a "0", 503 sin tocar D1', async () => {
    const h = createHarness({ ACCOUNTS_ENABLED: '0' });
    const pc = h.client();
    expect((await createAccount(pc)).json).toEqual({ error: 'accounts_disabled' });
    expect((await login(pc)).json).toEqual({ error: 'accounts_disabled' });
    expect((await pc.get('/api/v1/account')).json).toEqual({ error: 'accounts_disabled' });
    expect(h.db.rows('SELECT id FROM agenda')).toHaveLength(0);
  });

  it('sin ACCOUNT_PEPPER, o con uno corto, también', async () => {
    for (const pepper of [undefined, 'corto']) {
      const h = createHarness({ ACCOUNT_PEPPER: pepper });
      const response = await createAccount(h.client());
      expect(response.status).toBe(503);
      expect(response.json).toEqual({ error: 'accounts_disabled' });
    }
  });

  it('con otro secreto, nadie entra con email (las llaves y los códigos siguen valiendo)', async () => {
    const h = createHarness();
    const pc = h.client();
    const { recoveryCode } = (await createAccount(pc)).json as { recoveryCode: string };
    h.env.ACCOUNT_PEPPER = 'otra-pimienta-distinta-de-la-de-antes-0123456789';
    expect((await login(h.client())).json).toEqual({ error: 'invalid_login' });
    const phone = h.client();
    const redeemed = await phone.post('/api/v1/recovery/redeem', {
      code: recoveryCode,
      label: 'Safari en iPhone',
    });
    expect(redeemed.status).toBe(201);
  });
});
