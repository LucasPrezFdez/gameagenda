// Importar desde Steam (Fase 2, parte 2; §10.2 y §10.3 de prototipe.md; ADR-012): «Iniciar sesión
// con Steam» con OpenID 2.0 y un canje tipo PKCE, y la biblioteca y la lista de deseados, que van
// tal cual al dispositivo.
//
// - `POST /steam/start` `{ challenge }`: crea el ticket (10 min, un uso) ligado al `challenge`
//   (`BASE64URL(SHA-256(verificador))`) y devuelve la URL de OpenID de Steam. No llama a Steam.
// - `GET /steam/callback?t=<ticket>&openid.*`: la vuelta de Steam. Comprueba la aserción (las
//   cinco comprobaciones de la §10.2, en `steam-openid.ts`) y, si Steam la da por buena, apunta el
//   SteamID64 en el ticket. Responde una página corta (`steam-page.ts`). Es un GET que escribe en
//   D1: lo exige OpenID 2.0, y solo escribe con una aserción verificada para un ticket vigente.
//
// Nada de estas rutas se registra: ni la URL (lleva el ticket y la aserción), ni los cuerpos, ni el
// SteamID64 (§10.4).

import {
  STEAM_SECRET_PATTERN,
  STEAM_TICKET_TTL_MS,
  steamStartRequestSchema,
} from '@gameagenda/core/api';
import type { Context, Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { newSteamTicket, sha256Hex } from '../crypto.ts';
import type { AppEnv, Deps } from '../env.ts';
import { iso, parseBody } from '../http.ts';
import {
  checkAssertion,
  checkAuthentication,
  hasRepeatedParams,
  steamLoginUrl,
  steamReturnTo,
} from '../steam-openid.ts';
import { type SteamPageKind, steamPage } from '../steam-page.ts';

const MAX_BODY = 1024;
/** Una vuelta de Steam lleva ≈1 KB de consulta; lo que pase de esto no es suyo. */
const MAX_CALLBACK_QUERY = 8 * 1024;

const PAGE_STATUS: Readonly<Record<SteamPageKind, ContentfulStatusCode>> = {
  done: 200,
  cancelled: 200,
  invalid: 400,
  expired: 410,
  unavailable: 502,
};

function page(c: Context<AppEnv>, kind: SteamPageKind): Response {
  return c.html(steamPage(kind), PAGE_STATUS[kind]);
}

export function steamRoutes(api: Hono<AppEnv>, deps: Deps): void {
  const steamFetch = deps.steamFetch ?? ((url, init) => fetch(url, init));

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

  api.get('/steam/callback', async (c) => {
    const url = new URL(c.req.url);
    if (url.search.length > MAX_CALLBACK_QUERY) return page(c, 'invalid');
    const query = url.searchParams;
    // Un parámetro repetido podría leerse distinto aquí y en Steam (p. ej., dos `claimed_id`).
    if (hasRepeatedParams(query)) return page(c, 'invalid');
    const ticket = query.get('t') ?? '';
    if (!STEAM_SECRET_PATTERN.test(ticket)) return page(c, 'expired');
    const db = c.env.DB;
    const hash = await sha256Hex(ticket);
    const pending = await db
      .prepare(
        'SELECT 1 AS ok FROM steam_ticket WHERE ticket_hash = ?1 AND expires_at > ?2 AND steam_id IS NULL',
      )
      .bind(hash, iso(deps.now()))
      .first();
    // Comprobación 5: un ticket caducado, inventado o que ya tiene su login no admite otro.
    if (pending === null) return page(c, 'expired');

    const burn = () =>
      db.prepare('DELETE FROM steam_ticket WHERE ticket_hash = ?1').bind(hash).run();
    // Comprobaciones 2, 3 y 4, sin llamar a nadie. Una aserción que no vale gasta el ticket.
    const check = checkAssertion(query, steamReturnTo(url.origin, ticket));
    if (!check.ok) {
      await burn();
      return page(c, check.reason === 'cancel' ? 'cancelled' : 'invalid');
    }
    // Comprobación 1. Si Steam no contesta, el ticket se queda: recargar la página lo reintenta.
    const verdict = await checkAuthentication(query, steamFetch);
    if (verdict === 'failed') return page(c, 'unavailable');
    if (verdict === 'invalid') {
      await burn();
      return page(c, 'invalid');
    }
    // Solo una vuelta gana, aunque lleguen dos a la vez con la misma aserción.
    const saved = await db
      .prepare(
        'UPDATE steam_ticket SET steam_id = ?1 WHERE ticket_hash = ?2 AND steam_id IS NULL AND expires_at > ?3',
      )
      .bind(check.steamId, hash, iso(deps.now()))
      .run();
    return page(c, saved.meta.changes === 1 ? 'done' : 'expired');
  });
}
