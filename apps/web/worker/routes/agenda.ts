// La agenda en el servidor (§5.2 y §7.7): crearla al activar la sincronización, con la declaración
// de edad y el código de recuperación; canjear ese código; cambiarlo, y borrarla en cascada.

import {
  createAgendaRequestSchema,
  deleteAgendaRequestSchema,
  emptyRequestSchema,
  formatCode,
  parseCode,
  redeemRequestSchema,
} from '@gameagenda/core/api';
import type { Hono } from 'hono';
import { newCode, newDeviceToken, sha256Hex } from '../crypto.ts';
import {
  addDevice,
  clearDeviceCookies,
  readDevice,
  requireDevice,
  setDeviceCookies,
} from '../device.ts';
import type { AppEnv, Deps } from '../env.ts';
import { apiError, iso, parseBody, rateLimited } from '../http.ts';

/** Los cuerpos de estas rutas son pequeños: 1 KiB sobra. */
const MAX_BODY = 1024;

export function agendaRoutes(api: Hono<AppEnv>, deps: Deps): void {
  // Activar la sincronización: crea la agenda y su primer dispositivo, pone la cookie y devuelve el
  // código de recuperación, que solo se muestra esta vez.
  api.post('/agenda', async (c) => {
    const limited = await rateLimited(c, c.env.RL_AGENDA);
    if (limited) return limited;
    const body = await parseBody(c, createAgendaRequestSchema, MAX_BODY);
    if (!body.ok) return body.response;
    if (body.data.minAge !== Number(c.env.MIN_AGE)) return apiError(c, 'age_policy_changed');
    if ((await readDevice(c)) !== null) return apiError(c, 'already_paired');

    const at = iso(deps.now());
    const agendaId = crypto.randomUUID();
    const deviceId = crypto.randomUUID();
    const token = newDeviceToken();
    const recovery = newCode();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO agenda (id, recovery_hash, created_at, last_sync_at)
         VALUES (?1, ?2, ?3, ?3)`,
      ).bind(agendaId, await sha256Hex(recovery), at),
      c.env.DB.prepare(
        `INSERT INTO device (id, agenda_id, kind, label, token_hash, created_at, last_seen_at)
         VALUES (?1, ?2, 'app', ?3, ?4, ?5, ?5)`,
      ).bind(deviceId, agendaId, body.data.label, await sha256Hex(token), at),
    ]);
    setDeviceCookies(c, token);
    return c.json({ deviceId, recoveryCode: formatCode(recovery) }, 201);
  });

  // «Borrar todos mis datos» (CA4.7): la agenda y, en cascada, sus dispositivos, *tokens*,
  // operaciones y buzón. Time Travel de D1 la conserva 7 días (§11.2).
  api.post('/agenda/delete', requireDevice, async (c) => {
    const body = await parseBody(c, deleteAgendaRequestSchema, MAX_BODY);
    if (!body.ok) return body.response;
    await c.env.DB.prepare('DELETE FROM agenda WHERE id = ?1').bind(c.var.device.agendaId).run();
    clearDeviceCookies(c);
    return c.json({ ok: true });
  });

  // Canjear el código de recuperación: un dispositivo nuevo en la agenda. El código sigue valiendo
  // hasta que se cree otro.
  api.post('/recovery/redeem', async (c) => {
    const limited = await rateLimited(c, c.env.RL_REDEEM);
    if (limited) return limited;
    const body = await parseBody(c, redeemRequestSchema, MAX_BODY);
    if (!body.ok) return body.response;
    if ((await readDevice(c)) !== null) return apiError(c, 'already_paired');
    const code = parseCode(body.data.code);
    if (code === null) return apiError(c, 'invalid_code');
    const agenda = await c.env.DB.prepare('SELECT id FROM agenda WHERE recovery_hash = ?1')
      .bind(await sha256Hex(code))
      .first<{ id: string }>();
    if (agenda === null) return apiError(c, 'invalid_code');
    const { deviceId } = await addDevice(c, agenda.id, 'app', body.data.label, deps.now());
    return c.json({ deviceId }, 201);
  });

  // Código de recuperación nuevo (el anterior deja de valer), por si se ha perdido o se ha visto.
  api.post('/recovery', requireDevice, async (c) => {
    const body = await parseBody(c, emptyRequestSchema, MAX_BODY);
    if (!body.ok) return body.response;
    const recovery = newCode();
    await c.env.DB.prepare('UPDATE agenda SET recovery_hash = ?2 WHERE id = ?1')
      .bind(c.var.device.agendaId, await sha256Hex(recovery))
      .run();
    return c.json({ recoveryCode: formatCode(recovery) }, 201);
  });
}
