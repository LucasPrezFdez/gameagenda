// Importar desde Steam (Fase 2, parte 2; §10.2 y §10.3 de prototipe.md; ADR-012): «Iniciar sesión
// con Steam» con OpenID 2.0 y un canje tipo PKCE, y la biblioteca y la lista de deseados, que van
// tal cual al dispositivo.
//
// - `POST /steam/start` `{ challenge }`: crea el ticket (10 min, un uso) ligado al `challenge`
//   (`BASE64URL(SHA-256(verificador))`) y devuelve la URL de OpenID de Steam. No llama a Steam.
//
// Nada de estas rutas se registra: ni la URL (lleva el ticket y la aserción), ni los cuerpos, ni el
// SteamID64 (§10.4).

import { STEAM_TICKET_TTL_MS, steamStartRequestSchema } from '@gameagenda/core/api';
import type { Hono } from 'hono';
import { newSteamTicket, sha256Hex } from '../crypto.ts';
import type { AppEnv, Deps } from '../env.ts';
import { iso, parseBody } from '../http.ts';
import { steamLoginUrl } from '../steam-openid.ts';

const MAX_BODY = 1024;

export function steamRoutes(api: Hono<AppEnv>, deps: Deps): void {
  api.post('/steam/start', async (c) => {
    const body = await parseBody(c, steamStartRequestSchema, MAX_BODY);
    if (!body.ok) return body.response;
    const now = deps.now();
    const ticket = newSteamTicket();
    const expiresAt = iso(now + STEAM_TICKET_TTL_MS);
    const db = c.env.DB;
    await db.batch([
      // De paso, fuera los caducados (el *cron* de cada 5 min se lleva los demás).
      db.prepare('DELETE FROM steam_ticket WHERE expires_at <= ?1').bind(iso(now)),
      db
        .prepare(
          'INSERT INTO steam_ticket (ticket_hash, challenge, expires_at) VALUES (?1, ?2, ?3)',
        )
        .bind(await sha256Hex(ticket), body.data.challenge, expiresAt),
    ]);
    const origin = new URL(c.req.url).origin;
    return c.json({ ticket, url: steamLoginUrl(origin, ticket), expiresAt }, 201);
  });
}
