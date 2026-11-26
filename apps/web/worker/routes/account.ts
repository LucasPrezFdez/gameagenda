// Cuentas con email y contraseña (ADR-014). Una cuenta es la agenda sincronizada (ADR-011) con un
// email y una contraseña: entrar con ellos da de alta un dispositivo, como el código de
// recuperación o una llave de acceso. La contraseña nunca llega: llega `authKey`, que sale de ella
// con PBKDF2 en el dispositivo, y D1 guarda solo dos HMAC (`account-crypto.ts`).
//
// - `POST /account`: crea la agenda y su cuenta, con la cookie y el código de recuperación, como
//   `POST /agenda`. Sin correos no se puede ocultar que un email ya tiene cuenta (409
//   `email_taken`); lo frena `RL_AGENDA`.
// - `POST /account/login`: un dispositivo nuevo. Un email sin cuenta y una contraseña mala dan lo
//   mismo, `invalid_login`, y cuestan lo mismo (se calcula el HMAC aunque no haya cuenta). Con
//   `RL_LOGIN` por IP y el freno por email (`login_throttle`).
// - `GET /account`, `POST /account/login-details` y `…/remove`, con la cookie: lo que tiene la
//   cuenta, y poner, cambiar o quitar el email y la contraseña. Con la cookie basta, como para
//   borrar la agenda: «He olvidado mi contraseña» es entrar con una llave o con el código y
//   cambiarla aquí.
//
// Con `ACCOUNTS_ENABLED` distinto de `'1'`, o sin `ACCOUNT_PEPPER`, todas dan 503
// `accounts_disabled` sin tocar D1. Nada de estas rutas se registra (§11.4).

import {
  accountCreateRequestSchema,
  accountLoginRequestSchema,
  emptyRequestSchema,
  formatCode,
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_MS,
  loginDetailsRequestSchema,
  normalizeEmail,
} from '@gameagenda/core/api';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import { emailHash, newPasswordSalt, passwordVerifier, sameSecret } from '../account-crypto.ts';
import { addDevice, readDevice, requireDevice, setDeviceCookies } from '../device.ts';
import type { AppEnv, D1Database, D1PreparedStatement, Deps } from '../env.ts';
import { apiError, iso, parseBody, rateLimited } from '../http.ts';
import { newAgenda } from './agenda.ts';

/** Los cuerpos de estas rutas son pequeños: 1 KiB sobra. */
const MAX_BODY = 1024;
/** Un secreto más corto no es un secreto: mejor apagado que mal puesto. */
export const ACCOUNT_PEPPER_MIN = 32;
/** Para calcular el HMAC aunque el email no tenga cuenta: cuesta lo mismo y responde igual. */
const DUMMY_SALT = 'AAAAAAAAAAAAAAAAAAAAAA';

/** `ACCOUNTS_ENABLED` a `'1'` y, si `pepper`, el secreto puesto: si no, 503 sin tocar D1. */
export function accountsEnabled(pepper: boolean): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const secret = c.env.ACCOUNT_PEPPER ?? '';
    if (c.env.ACCOUNTS_ENABLED === '1' && (!pepper || secret.length >= ACCOUNT_PEPPER_MIN)) {
      return next();
    }
    return apiError(c, 'accounts_disabled');
  };
}

/** El secreto (el interruptor ya ha comprobado que está). */
function pepperOf(c: Context<AppEnv>): string {
  return c.env.ACCOUNT_PEPPER ?? '';
}

/** ¿Un `INSERT` ha chocado con el índice único del email? */
function isEmailConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    /UNIQUE constraint failed: account_login\.email_hash/.test(error.message)
  );
}

/** Lo que tiene la cuenta de una agenda: `GET /account` y las rutas que lo cambian. */
export async function accountInfo(db: D1Database, agendaId: string) {
  const [login, steam] = await Promise.all([
    db
      .prepare('SELECT 1 AS ok FROM account_login WHERE agenda_id = ?1')
      .bind(agendaId)
      .first<{ ok: number }>(),
    db
      .prepare('SELECT linked_at, refreshed_at FROM steam_link WHERE agenda_id = ?1')
      .bind(agendaId)
      .first<{ linked_at: string; refreshed_at: string | null }>(),
  ]);
  return {
    hasLogin: login !== null,
    steam: steam === null ? null : { linkedAt: steam.linked_at, refreshedAt: steam.refreshed_at },
  };
}

/** Guarda (o cambia) el email y la contraseña de la agenda. */
async function loginDetailsStatement(
  c: Context<AppEnv>,
  agendaId: string,
  hash: string,
  authKey: string,
  kdf: string,
  nowMs: number,
): Promise<D1PreparedStatement> {
  const salt = newPasswordSalt();
  const verifier = await passwordVerifier(pepperOf(c), salt, authKey);
  return c.env.DB.prepare(
    `INSERT INTO account_login (agenda_id, email_hash, pw_salt, pw_verifier, kdf, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
     ON CONFLICT (agenda_id) DO UPDATE SET
       email_hash = excluded.email_hash,
       pw_salt = excluded.pw_salt,
       pw_verifier = excluded.pw_verifier,
       kdf = excluded.kdf,
       updated_at = excluded.updated_at`,
  ).bind(agendaId, hash, salt, verifier, kdf, iso(nowMs));
}

/** Un fallo más con la contraseña de este email; la ventana empieza con el primero. */
function failureStatement(db: D1Database, hash: string, nowMs: number): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO login_throttle (email_hash, failures, window_start) VALUES (?1, 1, ?2)
       ON CONFLICT (email_hash) DO UPDATE SET
         failures = CASE WHEN window_start <= ?3 THEN 1 ELSE failures + 1 END,
         window_start = CASE WHEN window_start <= ?3 THEN ?2 ELSE window_start END`,
    )
    .bind(hash, iso(nowMs), iso(nowMs - LOGIN_WINDOW_MS));
}

export function accountRoutes(api: Hono<AppEnv>, deps: Deps): void {
  const enabled = accountsEnabled(true);
  api.use('/account', enabled);
  api.use('/account/*', enabled);

  api.post('/account', async (c) => {
    const limited = await rateLimited(c, c.env.RL_AGENDA);
    if (limited) return limited;
    const body = await parseBody(c, accountCreateRequestSchema, MAX_BODY);
    if (!body.ok) return body.response;
    if (body.data.minAge !== Number(c.env.MIN_AGE)) return apiError(c, 'age_policy_changed');
    if ((await readDevice(c)) !== null) return apiError(c, 'already_paired');
    const email = normalizeEmail(body.data.email);
    if (email === null) return apiError(c, 'invalid_body');
    const db = c.env.DB;
    const hash = await emailHash(pepperOf(c), email);
    const taken = await db
      .prepare('SELECT 1 AS ok FROM account_login WHERE email_hash = ?1')
      .bind(hash)
      .first();
    if (taken !== null) return apiError(c, 'email_taken');

    const now = deps.now();
    const agenda = await newAgenda(db, body.data.label, now);
    const login = await loginDetailsStatement(
      c,
      agenda.agendaId,
      hash,
      body.data.authKey,
      body.data.kdf,
      now,
    );
    try {
      // Todo o nada: si otro creó la cuenta con ese email entre medias, tampoco queda la agenda.
      await db.batch([...agenda.statements, login]);
    } catch (error) {
      if (isEmailConflict(error)) return apiError(c, 'email_taken');
      throw error;
    }
    setDeviceCookies(c, agenda.token);
    return c.json({ deviceId: agenda.deviceId, recoveryCode: formatCode(agenda.recovery) }, 201);
  });

  api.post('/account/login', async (c) => {
    const limited = await rateLimited(c, c.env.RL_LOGIN);
    if (limited) return limited;
    const body = await parseBody(c, accountLoginRequestSchema, MAX_BODY);
    if (!body.ok) return body.response;
    if ((await readDevice(c)) !== null) return apiError(c, 'already_paired');
    // Un email que no lo parece no tiene cuenta: lo mismo que uno desconocido.
    const email = normalizeEmail(body.data.email);
    if (email === null) return apiError(c, 'invalid_login');
    const db = c.env.DB;
    const now = deps.now();
    const hash = await emailHash(pepperOf(c), email);
    const [throttle, account] = await Promise.all([
      db
        .prepare('SELECT failures, window_start FROM login_throttle WHERE email_hash = ?1')
        .bind(hash)
        .first<{ failures: number; window_start: string }>(),
      db
        .prepare('SELECT agenda_id, pw_salt, pw_verifier FROM account_login WHERE email_hash = ?1')
        .bind(hash)
        .first<{ agenda_id: string; pw_salt: string; pw_verifier: string }>(),
    ]);
    // Bloqueado, aunque esta vez la contraseña fuera la buena.
    if (
      throttle !== null &&
      throttle.failures >= LOGIN_MAX_FAILURES &&
      throttle.window_start > iso(now - LOGIN_WINDOW_MS)
    ) {
      return apiError(c, 'too_many_attempts');
    }
    const verifier = await passwordVerifier(
      pepperOf(c),
      account?.pw_salt ?? DUMMY_SALT,
      body.data.authKey,
    );
    if (account === null || !sameSecret(verifier, account.pw_verifier)) {
      await failureStatement(db, hash, now).run();
      return apiError(c, 'invalid_login');
    }
    if (throttle !== null) {
      await db.prepare('DELETE FROM login_throttle WHERE email_hash = ?1').bind(hash).run();
    }
    const { deviceId } = await addDevice(c, account.agenda_id, 'app', body.data.label, now);
    return c.json({ deviceId }, 201);
  });

  api.get('/account', requireDevice, async (c) =>
    c.json(await accountInfo(c.env.DB, c.var.device.agendaId)),
  );

  // Poner o cambiar el email y la contraseña. No echa a ningún dispositivo: para eso está la lista.
  api.post('/account/login-details', requireDevice, async (c) => {
    const body = await parseBody(c, loginDetailsRequestSchema, MAX_BODY);
    if (!body.ok) return body.response;
    const email = normalizeEmail(body.data.email);
    if (email === null) return apiError(c, 'invalid_body');
    const db = c.env.DB;
    const { agendaId } = c.var.device;
    const hash = await emailHash(pepperOf(c), email);
    const owner = await db
      .prepare('SELECT agenda_id FROM account_login WHERE email_hash = ?1')
      .bind(hash)
      .first<{ agenda_id: string }>();
    if (owner !== null && owner.agenda_id !== agendaId) return apiError(c, 'email_taken');
    const login = await loginDetailsStatement(
      c,
      agendaId,
      hash,
      body.data.authKey,
      body.data.kdf,
      deps.now(),
    );
    try {
      await db.batch([
        login,
        // Con la contraseña nueva, los fallos de antes ya no cuentan.
        db.prepare('DELETE FROM login_throttle WHERE email_hash = ?1').bind(hash),
      ]);
    } catch (error) {
      if (isEmailConflict(error)) return apiError(c, 'email_taken');
      throw error;
    }
    return c.json(await accountInfo(db, agendaId));
  });

  // Quitar el email y la contraseña: la agenda sigue, con sus llaves y su código.
  api.post('/account/login-details/remove', requireDevice, async (c) => {
    const body = await parseBody(c, emptyRequestSchema, MAX_BODY);
    if (!body.ok) return body.response;
    const { agendaId } = c.var.device;
    await c.env.DB.prepare('DELETE FROM account_login WHERE agenda_id = ?1').bind(agendaId).run();
    return c.json(await accountInfo(c.env.DB, agendaId));
  });
}
