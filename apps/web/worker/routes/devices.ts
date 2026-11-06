// Ver y desemparejar dispositivos (RF-27), también el *token* del buzón del Atajo de iOS. Revocar
// borra la fila: el *hash* de una credencial se guarda hasta revocarla (§11.2).

import { type DeviceInfo, type DeviceKind, emptyRequestSchema } from '@gameagenda/core/api';
import type { Hono } from 'hono';
import { clearDeviceCookies, requireDevice } from '../device.ts';
import type { AppEnv } from '../env.ts';
import { apiError, parseBody } from '../http.ts';

interface DeviceRow {
  id: string;
  kind: DeviceKind;
  label: string;
  created_at: string;
  last_seen_at: string;
}

export function deviceRoutes(api: Hono<AppEnv>): void {
  api.get('/devices', requireDevice, async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT id, kind, label, created_at, last_seen_at FROM device
       WHERE agenda_id = ?1 ORDER BY created_at, id`,
    )
      .bind(c.var.device.agendaId)
      .all<DeviceRow>();
    const devices: DeviceInfo[] = results.map((r) => ({
      id: r.id,
      kind: r.kind,
      label: r.label,
      createdAt: r.created_at,
      lastSeenAt: r.last_seen_at,
      current: r.id === c.var.device.deviceId,
    }));
    return c.json({ devices });
  });

  // Revocar el propio dispositivo es «Desemparejar este dispositivo»: también quita la cookie.
  api.post('/devices/:id/revoke', requireDevice, async (c) => {
    const body = await parseBody(c, emptyRequestSchema, 256);
    if (!body.ok) return body.response;
    const id = c.req.param('id');
    const { meta } = await c.env.DB.prepare('DELETE FROM device WHERE id = ?1 AND agenda_id = ?2')
      .bind(id, c.var.device.agendaId)
      .run();
    if (meta.changes === 0) return apiError(c, 'not_found');
    if (id === c.var.device.deviceId) clearDeviceCookies(c);
    return c.json({ ok: true });
  });
}
