// Mantenimiento de D1 (§7.7 y §11.2; ADR-011), con un Cron Trigger diario y un solo `batch()`:
// - a diario, fuera los *tokens* de emparejamiento caducados y las agendas sin sincronizar en
//   13 meses (con todo lo suyo, en cascada), y de Steam, los tickets caducados y los días del
//   contador de llamadas de hace más de una semana (ADR-012);
// - los lunes, la purga semanal: las entradas borradas hace más de 90 días, y los esqueletos (sin
//   `status` o sin `title`) sin cambios en 90 días, con el corte de `purgeCutoff()` de core.
//
// En cada agenda con algo purgado, la `seq` sube 1 y `purged_seq` pasa a ser esa `seq` nueva. Así
// TODA app que sincronizó antes de la purga (su cursor no llega a la `seq` nueva) recibe `reset`
// en su siguiente `sync` y queda igual que D1, sin las lápidas purgadas. La app no purga por su
// cuenta: con su propio calendario, una escritura vieja subida después de una purga dejaría
// réplicas distintas a la vista. Cuesta un `reset` por dispositivo las semanas en que su agenda
// purga algo.
//
// Además, cada 5 min (`STEAM_PURGE_CRON`), fuera los tickets de Steam caducados: así un SteamID64
// está en D1, como mucho, los 10 min del ticket y 5 más (§11.2). Y los retos de las llaves de
// acceso caducados (ADR-013): los de entrar no son de ninguna agenda, y nada más los borraría.

import { purgeCutoff } from '@gameagenda/core/sync';
import type { D1Database, D1PreparedStatement } from './env.ts';
import { iso } from './http.ts';

export const AGENDA_TTL_MONTHS = 13;
/** Días que se guarda el contador de llamadas a Steam (`steam_quota`). */
export const STEAM_QUOTA_KEEP_DAYS = 7;
/** El segundo Cron Trigger de `wrangler.jsonc`: solo borra los tickets de Steam caducados. */
export const STEAM_PURGE_CRON = '*/5 * * * *';

// ?1: instante ISO de corte de las lápidas; ?2: HLC de corte de los esqueletos (`purgeCutoff`).
// El mismo criterio que `isPurgeable()` de core.
const PURGEABLE = `WITH e AS (
  SELECT agenda_id, entry_id,
    MAX(CASE WHEN field = 'deletedAt' THEN value END) AS del,
    SUM(field IN ('status', 'title')) AS base,
    MAX(hlc) AS last
  FROM op GROUP BY agenda_id, entry_id
), p AS (
  SELECT agenda_id, entry_id FROM e
  WHERE (del IS NOT NULL AND del <> 'null' AND (del ->> '$') < ?1)
     OR (base < 2 AND last < ?2)
)`;

// En el SET, `seq` es la de antes: `purged_seq` queda igual a la `seq` nueva.
const PURGE_AGENDAS = `${PURGEABLE}
UPDATE agenda
SET purged_seq = seq + 1,
  seq = seq + 1
WHERE id IN (SELECT agenda_id FROM p)`;

const PURGE_OPS = `${PURGEABLE}
DELETE FROM op WHERE (agenda_id, entry_id) IN (SELECT agenda_id, entry_id FROM p)`;

export function maintenanceStatements(db: D1Database, nowMs: number): D1PreparedStatement[] {
  const cutoff = new Date(nowMs);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - AGENDA_TTL_MONTHS);
  const statements = [
    db.prepare('DELETE FROM pairing_token WHERE expires_at <= ?1').bind(iso(nowMs)),
    db.prepare('DELETE FROM agenda WHERE last_sync_at < ?1').bind(cutoff.toISOString()),
    steamTicketPurge(db, nowMs),
    passkeyChallengePurge(db, nowMs),
    db
      .prepare('DELETE FROM steam_quota WHERE day < ?1')
      .bind(utcDay(nowMs - STEAM_QUOTA_KEEP_DAYS * 86_400_000)),
  ];
  if (new Date(nowMs).getUTCDay() === 1) {
    const { deletedBefore, unchangedBefore } = purgeCutoff(nowMs);
    statements.push(
      db.prepare(PURGE_AGENDAS).bind(deletedBefore, unchangedBefore),
      db.prepare(PURGE_OPS).bind(deletedBefore, unchangedBefore),
    );
  }
  return statements;
}

/** El día UTC de un instante, `YYYY-MM-DD`, como lo guarda `steam_quota`. */
export function utcDay(ms: number): string {
  return iso(ms).slice(0, 10);
}

function steamTicketPurge(db: D1Database, nowMs: number): D1PreparedStatement {
  return db.prepare('DELETE FROM steam_ticket WHERE expires_at <= ?1').bind(iso(nowMs));
}

function passkeyChallengePurge(db: D1Database, nowMs: number): D1PreparedStatement {
  return db.prepare('DELETE FROM webauthn_challenge WHERE expires_at <= ?1').bind(iso(nowMs));
}

/** Lo que hace el *cron* de cada 5 min: fuera los tickets de Steam y los retos caducados. */
export async function purgeSteamTickets(db: D1Database, nowMs: number): Promise<void> {
  await db.batch([steamTicketPurge(db, nowMs), passkeyChallengePurge(db, nowMs)]);
}

export async function runMaintenance(db: D1Database, nowMs: number): Promise<void> {
  await db.batch(maintenanceStatements(db, nowMs));
}
