// Llaves de acceso (ADR-013): otra forma de abrir la agenda en un dispositivo nuevo, como el código
// de recuperación, con una llave del llavero de iCloud, Google o Windows. Crear una pide un
// dispositivo de la agenda (cookie); entrar con ella, no: da de alta el dispositivo, como
// `recovery/redeem`. Los retos son de un solo uso (gastarlo lo borra) y 5 min, y D1 solo guarda su
// SHA-256. Cualquier fallo al entrar responde lo mismo: `invalid_passkey`.

import {
  emptyRequestSchema,
  PASSKEY_CHALLENGE_TTL_MS,
  PASSKEY_TRANSPORTS,
  PASSKEYS_MAX,
  type PasskeyAlgorithm,
  type PasskeyInfo,
  passkeyCreateRequestSchema,
  passkeyRedeemRequestSchema,
} from '@gameagenda/core/api';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import { newPasskeyChallenge, newPasskeyUserId, sha256Hex } from '../crypto.ts';
import { addDevice, readDevice, requireDevice } from '../device.ts';
import type { AppEnv, Deps } from '../env.ts';
import { apiError, iso, parseBody, rateLimited } from '../http.ts';
import {
  type Expected,
  fromBase64url,
  parseClientData,
  verifyAssertion,
  verifyRegistration,
} from '../webauthn.ts';

/** Una llave con RSA de 4 096 bits y extensiones cabe de sobra. */
const MAX_BODY = 16 * 1024;

interface PasskeyRow {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
}

/** El origen y el `rp.id` de la app: los de la petición, que `requestRules` ya exige propios. */
function expected(c: Context<AppEnv>, challenge: string): Expected {
  const url = new URL(c.req.url);
  return { challenge, origin: url.origin, rpId: url.hostname };
}

/** El reto que dice `clientDataJSON`, sin fiarse de nada más: se busca y se gasta en D1. */
function claimedChallenge(clientDataJSON: string): string | null {
  const bytes = fromBase64url(clientDataJSON);
  return bytes === null ? null : (parseClientData(bytes)?.challenge ?? null);
}

/**
 * Gasta un reto de forma atómica: el DELETE que lo encuentra es el único que lo usa. Los de crear
 * son de la agenda del dispositivo; los de entrar, de ninguna.
 */
async function spendChallenge(
  c: Context<AppEnv>,
  challenge: string,
  kind: 'create' | 'get',
  agendaId: string | null,
  now: number,
): Promise<boolean> {
  const row = await c.env.DB.prepare(
    `DELETE FROM webauthn_challenge
     WHERE challenge_hash = ?1 AND kind = ?2 AND agenda_id IS ?3 AND expires_at > ?4
     RETURNING 1 AS ok`,
  )
    .bind(await sha256Hex(challenge), kind, agendaId, iso(now))
    .first<{ ok: number }>();
  return row !== null;
}

async function listPasskeys(c: Context<AppEnv>, agendaId: string) {
  const db = c.env.DB;
  const [{ results }, agenda] = await Promise.all([
    db
      .prepare(
        `SELECT id, label, created_at, last_used_at FROM passkey
         WHERE agenda_id = ?1 ORDER BY created_at, id`,
      )
      .bind(agendaId)
      .all<PasskeyRow>(),
    db
      .prepare('SELECT passkey_user_id FROM agenda WHERE id = ?1')
      .bind(agendaId)
      .first<{ passkey_user_id: string | null }>(),
  ]);
  const passkeys: PasskeyInfo[] = results.map((r) => ({
    id: r.id,
    label: r.label,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  }));
  return { passkeys, userId: agenda?.passkey_user_id ?? null, rpId: new URL(c.req.url).hostname };
}

async function countPasskeys(c: Context<AppEnv>, agendaId: string): Promise<number> {
  const row = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM passkey WHERE agenda_id = ?1')
    .bind(agendaId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export function passkeyRoutes(api: Hono<AppEnv>, deps: Deps): void {
  // El interruptor: sin él, nada, ni D1.
  const enabled: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (c.env.PASSKEYS_ENABLED !== '1') return apiError(c, 'passkeys_disabled');
    return next();
  };
  api.use('/passkeys', enabled);
  api.use('/passkeys/*', enabled);

  // Opciones para crear una llave, con un reto de la agenda.
  api.post('/passkeys/options', requireDevice, async (c) => {
    const body = await parseBody(c, emptyRequestSchema, MAX_BODY);
    if (!body.ok) return body.response;
    const { agendaId } = c.var.device;
    if ((await countPasskeys(c, agendaId)) >= PASSKEYS_MAX) return apiError(c, 'passkeys_full');
    const db = c.env.DB;
    const now = deps.now();
    const challenge = newPasskeyChallenge();
    const [, , agenda, existing] = await db.batch([
      // El `user.id`, la primera vez; y de paso, fuera los retos caducados de esta agenda.
      db
        .prepare('UPDATE agenda SET passkey_user_id = ?2 WHERE id = ?1 AND passkey_user_id IS NULL')
        .bind(agendaId, newPasskeyUserId()),
      db
        .prepare('DELETE FROM webauthn_challenge WHERE agenda_id = ?1 AND expires_at <= ?2')
        .bind(agendaId, iso(now)),
      db.prepare('SELECT passkey_user_id FROM agenda WHERE id = ?1').bind(agendaId),
      db.prepare('SELECT id, transports FROM passkey WHERE agenda_id = ?1').bind(agendaId),
      db
        .prepare(
          `INSERT INTO webauthn_challenge (challenge_hash, agenda_id, kind, expires_at)
           VALUES (?1, ?2, 'create', ?3)`,
        )
        .bind(await sha256Hex(challenge), agendaId, iso(now + PASSKEY_CHALLENGE_TTL_MS)),
    ]);
    const userId = (agenda?.results[0] as { passkey_user_id: string } | undefined)?.passkey_user_id;
    if (userId === undefined) return apiError(c, 'internal');
    const excludeCredentials = (
      (existing?.results ?? []) as { id: string; transports: string }[]
    ).map((r) => ({ id: r.id, transports: JSON.parse(r.transports) as string[] }));
    const { rpId } = expected(c, challenge);
    return c.json({ challenge, rpId, userId, excludeCredentials }, 201);
  });

  // Guarda la llave recién creada, tras comprobarla.
  api.post('/passkeys', requireDevice, async (c) => {
    const body = await parseBody(c, passkeyCreateRequestSchema, MAX_BODY);
    if (!body.ok) return body.response;
    const { agendaId, deviceId } = c.var.device;
    const now = deps.now();
    const challenge = claimedChallenge(body.data.clientDataJSON);
    if (challenge === null || !(await spendChallenge(c, challenge, 'create', agendaId, now))) {
      return apiError(c, 'invalid_passkey');
    }
    const verified = await verifyRegistration(body.data, expected(c, challenge));
    if (verified === null) return apiError(c, 'invalid_passkey');
    if ((await countPasskeys(c, agendaId)) >= PASSKEYS_MAX) return apiError(c, 'passkeys_full');
    const known: readonly string[] = PASSKEY_TRANSPORTS;
    const transports = [...new Set(body.data.transports.filter((t) => known.includes(t)))];
    // El nombre, el del dispositivo que la crea (el de la lista de dispositivos).
    const { meta } = await c.env.DB.prepare(
      `INSERT INTO passkey (id, agenda_id, public_key, alg, sign_count, transports, label, created_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, label, ?7 FROM device WHERE id = ?8
       ON CONFLICT (id) DO NOTHING`,
    )
      .bind(
        verified.credentialId,
        agendaId,
        verified.publicKey,
        verified.alg,
        verified.signCount,
        JSON.stringify(transports),
        iso(now),
        deviceId,
      )
      .run();
    // Ya estaba (la misma llave dos veces): no se pisa.
    if (meta.changes === 0) return apiError(c, 'invalid_passkey');
    return c.json(await listPasskeys(c, agendaId), 201);
  });

  api.get('/passkeys', requireDevice, async (c) =>
    c.json(await listPasskeys(c, c.var.device.agendaId)),
  );

  // Quitar una llave: deja de abrir la agenda. La app pide además al navegador que la olvide.
  api.post('/passkeys/:id/remove', requireDevice, async (c) => {
    const body = await parseBody(c, emptyRequestSchema, 256);
    if (!body.ok) return body.response;
    const { agendaId } = c.var.device;
    const { meta } = await c.env.DB.prepare('DELETE FROM passkey WHERE id = ?1 AND agenda_id = ?2')
      .bind(c.req.param('id'), agendaId)
      .run();
    if (meta.changes === 0) return apiError(c, 'not_found');
    return c.json(await listPasskeys(c, agendaId));
  });

  // Un reto para entrar, sin agenda todavía: la llave dirá cuál.
  api.post('/passkeys/challenge', async (c) => {
    const limited = await rateLimited(c, c.env.RL_REDEEM);
    if (limited) return limited;
    const body = await parseBody(c, emptyRequestSchema, 256);
    if (!body.ok) return body.response;
    if ((await readDevice(c)) !== null) return apiError(c, 'already_paired');
    const challenge = newPasskeyChallenge();
    await c.env.DB.prepare(
      `INSERT INTO webauthn_challenge (challenge_hash, agenda_id, kind, expires_at)
       VALUES (?1, NULL, 'get', ?2)`,
    )
      .bind(await sha256Hex(challenge), iso(deps.now() + PASSKEY_CHALLENGE_TTL_MS))
      .run();
    return c.json({ challenge, rpId: expected(c, challenge).rpId }, 201);
  });

  // Entrar con una llave: un dispositivo nuevo en su agenda, como con el código de recuperación.
  api.post('/passkeys/redeem', async (c) => {
    const limited = await rateLimited(c, c.env.RL_REDEEM);
    if (limited) return limited;
    const body = await parseBody(c, passkeyRedeemRequestSchema, MAX_BODY);
    if (!body.ok) return body.response;
    if ((await readDevice(c)) !== null) return apiError(c, 'already_paired');
    const now = deps.now();
    const challenge = claimedChallenge(body.data.clientDataJSON);
    if (challenge === null || !(await spendChallenge(c, challenge, 'get', null, now))) {
      return apiError(c, 'invalid_passkey');
    }
    const db = c.env.DB;
    const row = await db
      .prepare(
        `SELECT p.agenda_id, p.public_key, p.alg, p.sign_count, a.passkey_user_id
         FROM passkey p JOIN agenda a ON a.id = p.agenda_id WHERE p.id = ?1`,
      )
      .bind(body.data.id)
      .first<{
        agenda_id: string;
        public_key: string;
        alg: PasskeyAlgorithm;
        sign_count: number;
        passkey_user_id: string | null;
      }>();
    if (row === null) return apiError(c, 'invalid_passkey');
    if (body.data.userHandle !== null && body.data.userHandle !== row.passkey_user_id) {
      return apiError(c, 'invalid_passkey');
    }
    const verified = await verifyAssertion(
      body.data,
      { publicKey: row.public_key, alg: row.alg, signCount: row.sign_count },
      expected(c, challenge),
    );
    if (verified === null) return apiError(c, 'invalid_passkey');
    await db
      .prepare('UPDATE passkey SET sign_count = ?2, last_used_at = ?3 WHERE id = ?1')
      .bind(body.data.id, verified.signCount, iso(now))
      .run();
    const { deviceId } = await addDevice(c, row.agenda_id, 'app', body.data.label, now);
    return c.json({ deviceId }, 201);
  });
}
