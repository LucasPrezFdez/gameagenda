// Buzón del Atajo de iOS (§5.2 y §11.4; RF-08; CA4.5). Desde Ajustes, un dispositivo emparejado
// crea un *token* de solo escritura (un `device` de tipo `inbox`: se ve y se revoca en la lista de
// dispositivos), que se muestra una vez. El Atajo lo manda en `Authorization: Bearer …`, nunca en la
// URL, con el enlace que se comparte desde Safari o la app de Steam. El buzón no mira `Origin` (el
// Atajo no lo envía) ni acepta la cookie: solo su *token*. Guarda el enlace canónico de la tienda,
// y la siguiente sincronización de una app de la agenda lo apunta y lo borra (ver `sync.ts`).
//
// Todas las respuestas llevan, además del código, un `message` en español: es lo que enseña el
// Atajo, que no tiene la app para traducir los códigos (`INBOX_MESSAGES` de `http.ts`).

import {
  INBOX_MAX_PENDING,
  INBOX_URL_MAX,
  inboxRequestSchema,
  inboxTokenRequestSchema,
} from '@gameagenda/core/api';
import { canonicalStoreUrl, findSteamLink } from '@gameagenda/core/steam-link';
import type { Hono } from 'hono';
import { sha256Hex } from '../crypto.ts';
import { addDevice, requireDevice } from '../device.ts';
import type { AppEnv, Deps } from '../env.ts';
import { apiError, INBOX_MESSAGES, iso, parseBody } from '../http.ts';

/** `{ "url": "…" }` con un texto de hasta 2 KiB: 4 KiB sobran. */
const MAX_INBOX_BODY = 4096;
const MAX_BODY = 1024;
/** Un *token* de verdad: 256 bits en base64url (43 caracteres), como la credencial de la app. */
const BEARER = /^Bearer\s+([A-Za-z0-9_-]{43})$/;

/**
 * El enlace que se guarda: el canónico de la tienda, con su *slug* (para el título del juego
 * provisional) si cabe. Un *slug* muy largo, o con caracteres que `encodeURIComponent` multiplica,
 * se queda fuera: si el enlace pasara de `INBOX_URL_MAX`, la respuesta de `sync` no pasaría su
 * esquema y la agenda entera dejaría de sincronizar.
 */
export function inboxUrl(link: { appid: number; title: string | null }): string {
  const url = canonicalStoreUrl(link);
  return url.length <= INBOX_URL_MAX ? url : canonicalStoreUrl({ appid: link.appid, title: null });
}

export function inboxRoutes(api: Hono<AppEnv>, deps: Deps): void {
  // El *token* del Atajo (Ajustes › Sincronización): se muestra una vez y D1 guarda su SHA-256.
  api.post('/inbox/token', requireDevice, async (c) => {
    const body = await parseBody(c, inboxTokenRequestSchema, MAX_BODY);
    if (!body.ok) return body.response;
    const { deviceId, token } = await addDevice(
      c,
      c.var.device.agendaId,
      'inbox',
      body.data.label,
      deps.now(),
    );
    return c.json({ deviceId, token }, 201);
  });

  api.post('/inbox', async (c) => {
    const token = BEARER.exec(c.req.header('Authorization') ?? '')?.[1];
    if (token === undefined) return apiError(c, 'unauthorized');
    const tokenHash = await sha256Hex(token);
    // Por *token*, antes de leer nada (§11.4).
    const { success } = await c.env.RL_INBOX.limit({ key: tokenHash });
    if (!success) return apiError(c, 'rate_limited');
    const body = await parseBody(c, inboxRequestSchema, MAX_INBOX_BODY);
    if (!body.ok) return body.response;

    const db = c.env.DB;
    const device = await db
      .prepare("SELECT id, agenda_id FROM device WHERE token_hash = ?1 AND kind = 'inbox'")
      .bind(tokenHash)
      .first<{ id: string; agenda_id: string }>();
    if (device === null) return apiError(c, 'unauthorized');
    const link = findSteamLink(body.data.url);
    if (link === null) return apiError(c, 'invalid_link');

    // Un juego que ya espera en el buzón no se repite (con otro *slug* es el mismo juego).
    const url = inboxUrl(link);
    const prefix = canonicalStoreUrl({ appid: link.appid, title: null });
    const at = iso(deps.now());
    const [inserted, , queued] = await db.batch([
      db
        .prepare(
          `INSERT INTO inbox_item (id, agenda_id, url, created_at)
           SELECT ?1, ?2, ?3, ?4
           WHERE NOT EXISTS (SELECT 1 FROM inbox_item
               WHERE agenda_id = ?2 AND substr(url, 1, length(?5)) = ?5)
             AND (SELECT count(*) FROM inbox_item WHERE agenda_id = ?2) < ?6`,
        )
        .bind(crypto.randomUUID(), device.agenda_id, url, at, prefix, INBOX_MAX_PENDING),
      db.prepare('UPDATE device SET last_seen_at = ?2 WHERE id = ?1').bind(device.id, at),
      db
        .prepare(
          `SELECT EXISTS (SELECT 1 FROM inbox_item
             WHERE agenda_id = ?1 AND substr(url, 1, length(?2)) = ?2) AS queued`,
        )
        .bind(device.agenda_id, prefix),
    ]);
    if (inserted?.meta.changes !== 1 && queued?.results[0]?.queued !== 1) {
      return apiError(c, 'inbox_full');
    }
    return c.json(
      { ok: true, appid: link.appid, message: INBOX_MESSAGES.queued },
      inserted?.meta.changes === 1 ? 201 : 200,
    );
  });
}
