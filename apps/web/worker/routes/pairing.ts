// Emparejar (§11.4; RF-25; CA4.4): un dispositivo emparejado pide un *token* de un solo uso que
// caduca en 10 min, y la app nueva lo canjea con un POST desde dentro de la app (nunca con un GET:
// una vista previa de enlaces lo gastaría). D1 solo guarda su *hash*, y canjearlo lo borra.

import {
  emptyRequestSchema,
  formatCode,
  PAIRING_TTL_MS,
  parseCode,
  redeemRequestSchema,
} from '@gameagenda/core/api';
import type { Hono } from 'hono';
import { newCode, sha256Hex } from '../crypto.ts';
import { addDevice, readDevice, requireDevice } from '../device.ts';
import type { AppEnv, Deps } from '../env.ts';
import { apiError, iso, parseBody, rateLimited } from '../http.ts';

const MAX_BODY = 1024;

export function pairingRoutes(api: Hono<AppEnv>, deps: Deps): void {
  api.post('/pairing', requireDevice, async (c) => {
    const body = await parseBody(c, emptyRequestSchema, MAX_BODY);
    if (!body.ok) return body.response;
    const now = deps.now();
    const code = newCode();
    const expiresAt = iso(now + PAIRING_TTL_MS);
    const { agendaId } = c.var.device;
    await c.env.DB.batch([
      // De paso, fuera los caducados de esta agenda (la purga diaria se lleva los demás).
      c.env.DB.prepare('DELETE FROM pairing_token WHERE agenda_id = ?1 AND expires_at <= ?2').bind(
        agendaId,
        iso(now),
      ),
      c.env.DB.prepare(
        'INSERT INTO pairing_token (token_hash, agenda_id, expires_at) VALUES (?1, ?2, ?3)',
      ).bind(await sha256Hex(code), agendaId, expiresAt),
    ]);
    return c.json({ code: formatCode(code), expiresAt }, 201);
  });

  // Usado, caducado o inventado dan la misma respuesta: `invalid_code`.
  api.post('/pairing/redeem', async (c) => {
    const limited = await rateLimited(c, c.env.RL_REDEEM);
    if (limited) return limited;
    const body = await parseBody(c, redeemRequestSchema, MAX_BODY);
    if (!body.ok) return body.response;
    if ((await readDevice(c)) !== null) return apiError(c, 'already_paired');
    const code = parseCode(body.data.code);
    if (code === null) return apiError(c, 'invalid_code');
    const now = deps.now();
    // Un solo uso de forma atómica: el DELETE que lo encuentra es el único que lo canjea.
    const token = await c.env.DB.prepare(
      'DELETE FROM pairing_token WHERE token_hash = ?1 AND expires_at > ?2 RETURNING agenda_id',
    )
      .bind(await sha256Hex(code), iso(now))
      .first<{ agenda_id: string }>();
    if (token === null) return apiError(c, 'invalid_code');
    const { deviceId } = await addDevice(c, token.agenda_id, 'app', body.data.label, now);
    return c.json({ deviceId }, 201);
  });
}
