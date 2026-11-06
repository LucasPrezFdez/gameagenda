// Mantenimiento de D1 (§7.7 y §11.2; ADR-011), con un Cron Trigger diario y un solo `batch()`:
// - a diario, fuera los *tokens* de emparejamiento caducados y las agendas sin sincronizar en
//   13 meses (con todo lo suyo, en cascada);
// - los lunes, la purga semanal: las entradas borradas hace más de 90 días, y los esqueletos (sin
//   `status` o sin `title`) sin cambios en 90 días. `purged_seq` sube a la mayor `seq` de lo
//   purgado: una app con el cursor por debajo no ha visto esas lápidas, y en su siguiente `sync`
//   recibe `reset`. La `seq` sube 1, para que un `sync` que leyó antes de la purga lo note.

import { formatHlc } from '@gameagenda/core/sync';
import type { D1Database, D1PreparedStatement } from './env.ts';
import { iso } from './http.ts';

export const TOMBSTONE_TTL_DAYS = 90;
export const AGENDA_TTL_MONTHS = 13;
const DAY_MS = 86_400_000;

// ?1: instante ISO de corte de las lápidas; ?2: HLC de corte de los esqueletos.
const PURGEABLE = `WITH e AS (
  SELECT agenda_id, entry_id,
    MAX(CASE WHEN field = 'deletedAt' THEN value END) AS del,
    SUM(field IN ('status', 'title')) AS base,
    MAX(hlc) AS last,
    MAX(seq) AS top
  FROM op GROUP BY agenda_id, entry_id
), p AS (
  SELECT agenda_id, entry_id, top FROM e
  WHERE (del IS NOT NULL AND del <> 'null' AND (del ->> '$') < ?1)
     OR (base < 2 AND last < ?2)
)`;

const PURGE_AGENDAS = `${PURGEABLE}
UPDATE agenda
SET purged_seq = MAX(purged_seq, (SELECT MAX(top) FROM p WHERE p.agenda_id = agenda.id)),
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
  ];
  if (new Date(nowMs).getUTCDay() === 1) {
    const purgeMs = nowMs - TOMBSTONE_TTL_DAYS * DAY_MS;
    const purgeHlc = formatHlc({ ms: purgeMs, counter: 0, node: '00000000' });
    statements.push(
      db.prepare(PURGE_AGENDAS).bind(iso(purgeMs), purgeHlc),
      db.prepare(PURGE_OPS).bind(iso(purgeMs), purgeHlc),
    );
  }
  return statements;
}

export async function runMaintenance(db: D1Database, nowMs: number): Promise<void> {
  await db.batch(maintenanceStatements(db, nowMs));
}
