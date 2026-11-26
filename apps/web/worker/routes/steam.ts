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
// - `POST /steam/redeem` `{ ticket, verifier }`: lo canjea la app, con el verificador del
//   `challenge`. Sin login aún, 202 `pending` (no lo gasta). Con él, lo gasta y trae la biblioteca
//   y la lista de deseados (`steam-library.ts`), tal cual, en *streaming*, con el pase de los
//   logros delante (`steam-token.ts`, 15 min). Es la primera llamada a la Web API de Steam, y solo
//   con un login verificado (§10).
// - `POST /steam/achievements` `{ token, appids }` (parte 3): con el pase de `redeem`, si cada
//   juego tiene todos sus logros (`steam-achievements.ts`), hasta `STEAM_ACHIEVEMENTS_BATCH` por
//   petición. Sin el pase, o caducado, 410 `steam_token_invalid`, sin llamar a Steam.
// - Steam vinculado (ADR-014), con la cookie y `ACCOUNTS_ENABLED`: `POST /steam/link`
//   `{ ticket, verifier }` canjea como `redeem` y guarda el SteamID64 en `steam_link`;
//   `POST /steam/refresh` trae la biblioteca de la cuenta vinculada sin login, como mucho una vez
//   cada 20 h por agenda (si no, 202 `too_soon`; sin vínculo, 202 `unlinked`);
//   `POST /steam/unlink` borra el vínculo.
//
// Con `STEAM_ENABLED` distinto de `'1'`, o sin `STEAM_WEB_API_KEY`, todas dan 503
// `steam_disabled` sin tocar D1. `start` y `redeem` tienen límite por IP (`RL_STEAM`), los lotes
// de logros, el suyo (`RL_STEAM_ACH`), y las llamadas a Steam, un tope diario (`steam-quota.ts`).
//
// Nada de estas rutas se registra: ni la URL (lleva el ticket y la aserción), ni los cuerpos (el
// pase, los juegos), ni el SteamID64 (§10.4).

import {
  emptyRequestSchema,
  STEAM_IMPORT_TOKEN_TTL_MS,
  STEAM_REFRESH_MIN_INTERVAL_MS,
  STEAM_SECRET_PATTERN,
  STEAM_TICKET_TTL_MS,
  steamAchievementsRequestSchema,
  steamRedeemRequestSchema,
  steamStartRequestSchema,
  steamTypesRequestSchema,
} from '@gameagenda/core/api';
import type { Context, Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { newSteamTicket, sha256Base64url, sha256Hex } from '../crypto.ts';
import { requireDevice } from '../device.ts';
import type { AppEnv, Deps } from '../env.ts';
import { apiError, iso, parseBody, rateLimited } from '../http.ts';
import { fetchAchievements } from '../steam-achievements.ts';
import { fetchLibrary } from '../steam-library.ts';
import {
  CALLBACK_PATH,
  checkAssertion,
  checkAuthentication,
  hasRepeatedParams,
  steamLoginUrl,
  steamReturnTo,
} from '../steam-openid.ts';
import { type SteamPageKind, steamPage } from '../steam-page.ts';
import { STEAM_DAILY_CALLS, spendSteamCalls } from '../steam-quota.ts';
import { openImportToken, sealImportToken } from '../steam-token.ts';
import { fetchSoftware } from '../steam-types.ts';
import { accountInfo, accountsEnabled } from './account.ts';

const MAX_BODY = 1024;
/** `achievements`: el pase y 40 `appid` de 10 cifras caben de sobra. */
const MAX_ACHIEVEMENTS_BODY = 2048;
/** `types`: el pase y 200 `appid` de 10 cifras (≈2,3 KB). */
const MAX_TYPES_BODY = 4096;
/** Una vuelta de Steam lleva ≈1 KB de consulta; lo que pase de esto no es suyo. */
const MAX_CALLBACK_QUERY = 8 * 1024;

const PAGE_STATUS: Readonly<Record<SteamPageKind, ContentfulStatusCode>> = {
  done: 200,
  cancelled: 200,
  invalid: 400,
  expired: 410,
  unavailable: 502,
  busy: 503,
  disabled: 503,
};

function page(c: Context<AppEnv>, kind: SteamPageKind): Response {
  return c.html(steamPage(kind), PAGE_STATUS[kind]);
}

export function steamRoutes(api: Hono<AppEnv>, deps: Deps): void {
  const steamFetch = deps.steamFetch ?? ((url, init) => fetch(url, init));
  const dailyCalls = deps.steamDailyCalls ?? STEAM_DAILY_CALLS;

  // El interruptor: sin él, ni D1 ni Steam. La vuelta de Steam es una página, no JSON.
  api.use('/steam/*', async (c, next) => {
    const key = c.env.STEAM_WEB_API_KEY;
    if (c.env.STEAM_ENABLED === '1' && key !== undefined && key !== '') return next();
    return c.req.path === CALLBACK_PATH ? page(c, 'disabled') : apiError(c, 'steam_disabled');
  });

  api.post('/steam/start', async (c) => {
    const limited = await rateLimited(c, c.env.RL_STEAM);
    if (limited) return limited;
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
    // El tope del día, antes de la primera llamada a Steam. El ticket se queda (caduca solo).
    if (!(await spendSteamCalls(db, deps.now(), 1, dailyCalls))) return page(c, 'busy');
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

  /**
   * Canjea el ticket de `redeem` o `link` (comprobación 5: un solo uso, y solo con el verificador;
   * el DELETE que lo encuentra es el único que lo canjea). Devuelve el SteamID64, o la respuesta:
   * 202 `pending` si aún no hay login (no lo gasta, y solo se lo dice a quien tiene el verificador)
   * o 410 si no vale.
   */
  async function claimTicket(
    c: Context<AppEnv>,
    ticket: string,
    verifier: string,
  ): Promise<{ steamId: string } | { response: Response }> {
    const db = c.env.DB;
    const hash = await sha256Hex(ticket);
    const challenge = await sha256Base64url(verifier);
    const now = iso(deps.now());
    const redeemed = await db
      .prepare(
        `DELETE FROM steam_ticket
         WHERE ticket_hash = ?1 AND challenge = ?2 AND expires_at > ?3 AND steam_id IS NOT NULL
         RETURNING steam_id`,
      )
      .bind(hash, challenge, now)
      .first<{ steam_id: string }>();
    if (redeemed !== null) return { steamId: redeemed.steam_id };
    const pending = await db
      .prepare(
        'SELECT 1 AS ok FROM steam_ticket WHERE ticket_hash = ?1 AND challenge = ?2 AND expires_at > ?3',
      )
      .bind(hash, challenge, now)
      .first();
    return {
      response:
        pending === null ? apiError(c, 'steam_ticket_invalid') : c.json({ status: 'pending' }, 202),
    };
  }

  /**
   * La biblioteca y la lista de deseados de `steamId`, en *streaming*, con el pase de los logros
   * delante (`redeem`, `link` y `refresh`). `onFailure` corre si Steam no la da.
   */
  async function libraryResponse(
    c: Context<AppEnv>,
    steamId: string,
    onFailure?: () => Promise<unknown>,
  ): Promise<Response> {
    // El interruptor ya ha comprobado que está.
    const key = c.env.STEAM_WEB_API_KEY ?? '';
    if (!(await spendSteamCalls(c.env.DB, deps.now(), 2, dailyCalls))) {
      await onFailure?.();
      return apiError(c, 'steam_busy');
    }
    const token = await sealImportToken(key, steamId, deps.now() + STEAM_IMPORT_TOKEN_TTL_MS);
    const library = await fetchLibrary(steamId, key, token, steamFetch, deps.steamImportMaxBytes);
    if (!library.ok) {
      await onFailure?.();
      // Sin nada de la cuenta: solo el código de Steam, para ver si la clave ya no vale (401 o 403).
      if (library.status === 401 || library.status === 403) {
        console.error(`micro-API: GetOwnedGames respondió ${library.status}`);
      }
      return apiError(c, library.error === 'busy' ? 'steam_busy' : 'steam_unavailable');
    }
    return new Response(library.body, {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  api.post('/steam/redeem', async (c) => {
    const limited = await rateLimited(c, c.env.RL_STEAM);
    if (limited) return limited;
    const body = await parseBody(c, steamRedeemRequestSchema, MAX_BODY);
    if (!body.ok) return body.response;
    const claimed = await claimTicket(c, body.data.ticket, body.data.verifier);
    if ('response' in claimed) return claimed.response;
    return libraryResponse(c, claimed.steamId);
  });

  // Steam vinculado (ADR-014): las tres, con la cookie y con `ACCOUNTS_ENABLED`. El SteamID64 se
  // queda en `steam_link` hasta desvincularlo o borrar la agenda (cascada).
  const linkEnabled = accountsEnabled(false);
  api.use('/steam/link', linkEnabled);
  api.use('/steam/refresh', linkEnabled);
  api.use('/steam/unlink', linkEnabled);

  // Como `redeem`, y además guarda el vínculo: la primera importación sale con su resumen.
  api.post('/steam/link', requireDevice, async (c) => {
    const limited = await rateLimited(c, c.env.RL_STEAM);
    if (limited) return limited;
    const body = await parseBody(c, steamRedeemRequestSchema, MAX_BODY);
    if (!body.ok) return body.response;
    const claimed = await claimTicket(c, body.data.ticket, body.data.verifier);
    if ('response' in claimed) return claimed.response;
    const at = iso(deps.now());
    await c.env.DB.prepare(
      `INSERT INTO steam_link (agenda_id, steam_id, linked_at, refreshed_at) VALUES (?1, ?2, ?3, ?3)
       ON CONFLICT (agenda_id) DO UPDATE SET
         steam_id = excluded.steam_id, linked_at = excluded.linked_at, refreshed_at = excluded.refreshed_at`,
    )
      .bind(c.var.device.agendaId, claimed.steamId, at)
      .run();
    return libraryResponse(c, claimed.steamId);
  });

  // La biblioteca de la cuenta vinculada, sin login: como mucho una vez cada 20 h por agenda, así
  // que con varios dispositivos solo uno la trae cada día. Si Steam no la da, la vez no cuenta.
  // «Sin vínculo» y «ya se trajo hace poco» no son errores: 202 con `status` (`unlinked` o
  // `too_soon`), como el «aún no» de `redeem`, para que la comprobación diaria de cada dispositivo
  // no deje errores en la consola.
  api.post('/steam/refresh', requireDevice, async (c) => {
    const limited = await rateLimited(c, c.env.RL_STEAM);
    if (limited) return limited;
    const body = await parseBody(c, emptyRequestSchema, MAX_BODY);
    if (!body.ok) return body.response;
    const db = c.env.DB;
    const { agendaId } = c.var.device;
    const link = await db
      .prepare('SELECT steam_id, refreshed_at FROM steam_link WHERE agenda_id = ?1')
      .bind(agendaId)
      .first<{ steam_id: string; refreshed_at: string | null }>();
    if (link === null) return c.json({ status: 'unlinked' }, 202);
    const now = deps.now();
    if (
      link.refreshed_at !== null &&
      link.refreshed_at > iso(now - STEAM_REFRESH_MIN_INTERVAL_MS)
    ) {
      return c.json({ status: 'too_soon' }, 202);
    }
    // Solo gana una de dos a la vez: la que encuentra la fecha que leyó.
    const at = iso(now);
    const { meta } = await db
      .prepare(
        'UPDATE steam_link SET refreshed_at = ?2 WHERE agenda_id = ?1 AND refreshed_at IS ?3',
      )
      .bind(agendaId, at, link.refreshed_at)
      .run();
    if (meta.changes !== 1) return c.json({ status: 'too_soon' }, 202);
    return libraryResponse(c, link.steam_id, () =>
      db
        .prepare(
          'UPDATE steam_link SET refreshed_at = ?2 WHERE agenda_id = ?1 AND refreshed_at = ?3',
        )
        .bind(agendaId, link.refreshed_at, at)
        .run(),
    );
  });

  api.post('/steam/unlink', requireDevice, async (c) => {
    const body = await parseBody(c, emptyRequestSchema, MAX_BODY);
    if (!body.ok) return body.response;
    const { agendaId } = c.var.device;
    await c.env.DB.prepare('DELETE FROM steam_link WHERE agenda_id = ?1').bind(agendaId).run();
    return c.json(await accountInfo(c.env.DB, agendaId));
  });

  api.post('/steam/achievements', async (c) => {
    const limited = await rateLimited(c, c.env.RL_STEAM_ACH);
    if (limited) return limited;
    const body = await parseBody(c, steamAchievementsRequestSchema, MAX_ACHIEVEMENTS_BODY);
    if (!body.ok) return body.response;
    // El interruptor ya ha comprobado que está.
    const key = c.env.STEAM_WEB_API_KEY ?? '';
    const steamId = await openImportToken(key, body.data.token, deps.now());
    if (steamId === null) return apiError(c, 'steam_token_invalid');
    const { appids } = body.data;
    if (!(await spendSteamCalls(c.env.DB, deps.now(), appids.length, dailyCalls))) {
      return apiError(c, 'steam_busy');
    }
    const games = await fetchAchievements(steamId, appids, key, steamFetch);
    return c.json({ games });
  });

  // Software (DECISIONES §10.57): qué apps son programas y no juegos. Una llamada a la tienda de
  // Steam por petición, sin clave y sin el SteamID64: el pase solo dice que viene de una importación.
  api.post('/steam/types', async (c) => {
    const limited = await rateLimited(c, c.env.RL_STEAM_ACH);
    if (limited) return limited;
    const body = await parseBody(c, steamTypesRequestSchema, MAX_TYPES_BODY);
    if (!body.ok) return body.response;
    // El interruptor ya ha comprobado que está.
    const key = c.env.STEAM_WEB_API_KEY ?? '';
    if ((await openImportToken(key, body.data.token, deps.now())) === null) {
      return apiError(c, 'steam_token_invalid');
    }
    if (!(await spendSteamCalls(c.env.DB, deps.now(), 1, dailyCalls))) {
      return apiError(c, 'steam_busy');
    }
    const software = await fetchSoftware(body.data.appids, steamFetch);
    if (software === null) return apiError(c, 'steam_unavailable');
    return c.json({ software });
  });
}
