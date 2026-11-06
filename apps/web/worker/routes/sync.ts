// `POST /api/v1/sync` (§5.3 y §7.7; ADR-011): sube la `outbox` y baja los cambios desde el cursor,
// en una sola ida y vuelta.
//
// 1. Cada operación pasa por Zod y por el reloj (más de 5 min por delante: `clock`). Una acción no
//    se parte: si una de sus operaciones (las de la misma HLC) no vale, no vale ninguna.
// 2. Se leen, en una transacción, la `seq` de la agenda y las filas de las entradas tocadas.
// 3. `planSync()` decide con la `applyOps()` de core qué filas cambian, también por derivadas
//    (Platinado ⇒ Completado, reenvíos de manuales vinculados: si tocan otra entrada, se lee).
// 4. Un `batch()` reserva las `seq` y escribe las filas solo si la `seq` sigue siendo la leída
//    (concurrencia optimista con `write_id`); si otro dispositivo escribió entre medias, se repite.
//    En el mismo `batch()` se lee la página de cambios, así que nadie ve la `seq` N+1 sin la N.

import {
  MAX_SYNC_BODY,
  SYNC_PAGE_SIZE,
  type SyncChange,
  type SyncRequest,
  type SyncResponse,
  syncRequestSchema,
} from '@gameagenda/core/api';
import { strictOpSchema } from '@gameagenda/core/schemas';
import { isTooFarAhead, type Op } from '@gameagenda/core/sync';
import type { Context, Hono } from 'hono';
import { clearDeviceCookies, requireDevice, setDeviceCookies } from '../device.ts';
import type { AppEnv, D1Database, D1PreparedStatement, Deps } from '../env.ts';
import { apiError, iso, parseBody } from '../http.ts';
import { type OpRow, planSync, type RowWrite } from '../sync-plan.ts';

/** Intentos si otro dispositivo de la agenda escribe a la vez. */
const MAX_ATTEMPTS = 3;
/** Saltos de reenvío entre entradas, como `applyOps()` (ADR-004). */
const MAX_HOPS = 8;

const INSERT_SQL = `INSERT INTO op (agenda_id, entry_id, field, value, hlc, seq)
SELECT ?1, j.value ->> '$.e', j.value ->> '$.f', j.value ->> '$.v', j.value ->> '$.h',
  ?2 + j.key + 1
FROM json_each(?3) AS j
WHERE (SELECT write_id FROM agenda WHERE id = ?1) = ?4
ON CONFLICT (agenda_id, entry_id, field) DO UPDATE
  SET value = excluded.value, hlc = excluded.hlc, seq = excluded.seq`;

// Desde dónde se baja: desde 0 si la app se quedó atrás de una purga que no ha visto (`reset`) o
// si su cursor va por delante del servidor (D1 vuelto atrás con Time Travel: la app lo nota
// porque el cursor nuevo es menor y vuelve a subirlo todo). `reset`, abajo, sale de lo mismo.
const CHANGES_SQL = `SELECT entry_id, field, value, hlc, seq FROM op
WHERE agenda_id = ?1 AND seq > (
  SELECT CASE
    WHEN ?2 > a.seq THEN 0
    WHEN ?2 > 0 AND ?2 < a.purged_seq AND ?3 < a.purged_seq THEN 0
    ELSE ?2 END
  FROM agenda AS a WHERE a.id = ?1)
ORDER BY seq
LIMIT ?4`;

type Rejected = SyncResponse['rejected'][number];

export interface ScreenedOps {
  ops: Op[];
  accepted: string[];
  rejected: Rejected[];
}

function field(raw: unknown, name: string): unknown {
  return typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>)[name] : null;
}

/** Paso 1: qué operaciones se aplican, cuáles se descartan y cuáles hay que volver a sellar. */
export function screenOps(raw: readonly unknown[], nowMs: number): ScreenedOps {
  const parsed = raw.map((r) => strictOpSchema.safeParse(r));
  const badActions = new Set<string>();
  raw.forEach((r, i) => {
    const hlc = field(r, 'hlc');
    if (!parsed[i]?.success && typeof hlc === 'string') badActions.add(hlc);
  });
  const out: ScreenedOps = { ops: [], accepted: [], rejected: [] };
  parsed.forEach((p, index) => {
    const opId = field(raw[index], 'opId');
    const id = typeof opId === 'string' ? opId : null;
    if (!p.success || badActions.has(p.data.hlc)) {
      out.rejected.push({ index, opId: id, reason: 'invalid' });
    } else if (isTooFarAhead(p.data.hlc, nowMs)) {
      out.rejected.push({ index, opId: id, reason: 'clock' });
    } else {
      out.ops.push(p.data as Op);
      out.accepted.push(p.data.opId);
    }
  });
  return out;
}

/** La `seq` de la agenda y las filas de `ids`, en una transacción; `null` si ya no existe. */
async function readSnapshot(
  db: D1Database,
  agendaId: string,
  ids: readonly string[],
): Promise<{ seq: number; rows: OpRow[] } | null> {
  const [agenda, rows] = await db.batch([
    db.prepare('SELECT seq FROM agenda WHERE id = ?1').bind(agendaId),
    db
      .prepare(
        `SELECT entry_id, field, value, hlc FROM op
         WHERE agenda_id = ?1 AND entry_id IN (SELECT value FROM json_each(?2))`,
      )
      .bind(agendaId, JSON.stringify(ids)),
  ]);
  const seq = agenda?.results[0]?.seq;
  if (typeof seq !== 'number') return null;
  return { seq, rows: (rows?.results ?? []) as unknown as OpRow[] };
}

/** Pasos 2 y 3: las filas que escribir y la `seq` sobre la que se calcularon. */
async function plan(
  db: D1Database,
  agendaId: string,
  ops: readonly Op[],
): Promise<{ writes: RowWrite[]; seq: number } | 'gone' | 'conflict'> {
  const ids = [...new Set(ops.map((o) => o.entryId))];
  const snapshot = await readSnapshot(db, agendaId, ids);
  if (snapshot === null) return 'gone';
  const rows = [...snapshot.rows];
  const loaded = new Set(ids);
  for (let hop = 0; ; hop++) {
    const result = planSync(rows, loaded, ops);
    if (result.missing.length === 0) return { writes: result.writes, seq: snapshot.seq };
    if (hop >= MAX_HOPS) throw new Error('sync: demasiados saltos de reenvío');
    const more = await readSnapshot(db, agendaId, result.missing);
    if (more === null) return 'gone';
    if (more.seq !== snapshot.seq) return 'conflict';
    rows.push(...more.rows);
    for (const id of result.missing) loaded.add(id);
  }
}

type Page = Pick<SyncResponse, 'cursor' | 'purgedSeq' | 'reset' | 'more' | 'changes'>;

/** Paso 4. `null` si otro dispositivo escribió entre la lectura y la escritura. */
async function attempt(
  c: Context<AppEnv>,
  request: SyncRequest,
  ops: readonly Op[],
  nowMs: number,
  renew: boolean,
  pageSize: number,
): Promise<Page | 'gone' | null> {
  const db = c.env.DB;
  const { agendaId, deviceId } = c.var.device;
  let writes: RowWrite[] = [];
  let seq = 0;
  if (ops.length > 0) {
    const planned = await plan(db, agendaId, ops);
    if (planned === 'gone') return 'gone';
    if (planned === 'conflict') return null;
    ({ writes, seq } = planned);
  }

  const at = iso(nowMs);
  const statements: D1PreparedStatement[] = [];
  if (writes.length > 0) {
    const writeId = crypto.randomUUID();
    statements.push(
      db
        .prepare(
          `UPDATE agenda SET seq = seq + ?2, write_id = ?3, last_sync_at = ?4
           WHERE id = ?1 AND seq = ?5`,
        )
        .bind(agendaId, writes.length, writeId, at, seq),
      db.prepare(INSERT_SQL).bind(agendaId, seq, JSON.stringify(writes), writeId),
    );
  } else if (renew) {
    statements.push(
      db.prepare('UPDATE agenda SET last_sync_at = ?2 WHERE id = ?1').bind(agendaId, at),
    );
  }
  if (renew) {
    statements.push(
      db.prepare('UPDATE device SET last_seen_at = ?2 WHERE id = ?1').bind(deviceId, at),
    );
  }
  const readAt = statements.length;
  statements.push(
    db.prepare('SELECT seq, purged_seq FROM agenda WHERE id = ?1').bind(agendaId),
    db.prepare(CHANGES_SQL).bind(agendaId, request.cursor, request.purgedSeq, pageSize + 1),
  );

  const results = await db.batch(statements);
  if (writes.length > 0 && results[0]?.meta.changes !== 1) return null;
  const agenda = results[readAt]?.results[0] as { seq: number; purged_seq: number } | undefined;
  if (agenda === undefined) return 'gone';
  const rows = (results[readAt + 1]?.results ?? []) as unknown as Array<OpRow & { seq: number }>;
  const more = rows.length > pageSize;
  const page = more ? rows.slice(0, pageSize) : rows;
  const { cursor, purgedSeq } = request;
  return {
    cursor: more ? (page[page.length - 1]?.seq ?? 0) : agenda.seq,
    purgedSeq: agenda.purged_seq,
    reset:
      cursor > 0 &&
      cursor <= agenda.seq &&
      cursor < agenda.purged_seq &&
      purgedSeq < agenda.purged_seq,
    more,
    changes: page.map((r) => ({
      entryId: r.entry_id,
      // D1 solo guarda campos que pasaron por `strictOpSchema`.
      field: r.field as SyncChange['field'],
      value: JSON.parse(r.value),
      hlc: r.hlc,
    })),
  };
}

export function syncRoutes(api: Hono<AppEnv>, deps: Deps): void {
  api.post('/sync', requireDevice, async (c) => {
    const body = await parseBody(c, syncRequestSchema, MAX_SYNC_BODY);
    if (!body.ok) return body.response;
    const nowMs = deps.now();
    const screened = screenOps(body.data.ops, nowMs);
    const device = c.var.device;
    // La cookie (400 días) y `last_sync_at` (retención de 13 meses), como mucho una vez al día.
    const renew = device.lastSeenAt.slice(0, 10) !== iso(nowMs).slice(0, 10);
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const page = await attempt(
        c,
        body.data,
        screened.ops,
        nowMs,
        renew,
        deps.pageSize ?? SYNC_PAGE_SIZE,
      );
      if (page === 'gone') {
        // La agenda se borró mientras tanto (desde otro dispositivo).
        clearDeviceCookies(c);
        return apiError(c, 'unauthorized');
      }
      if (page === null) continue;
      if (renew) setDeviceCookies(c, device.token);
      const response: SyncResponse = {
        ...page,
        serverTime: nowMs,
        accepted: screened.accepted,
        rejected: screened.rejected,
      };
      return c.json(response);
    }
    return apiError(c, 'busy');
  });
}
