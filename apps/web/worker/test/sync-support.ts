// Utilidades de las pruebas de `sync`: operaciones de ejemplo y una réplica que sincroniza como lo
// hará la app (subir la `outbox` por lotes, aplicar los cambios con `applyOps()`, meter las
// derivadas en la `outbox` y seguir mientras haya páginas).

import type { SyncResponse } from '@gameagenda/core/api';
import type { Entry } from '@gameagenda/core/entries';
import {
  applyOps,
  formatHlc,
  type JsonValue,
  type Op,
  SYNC_BATCH_SIZE,
  takeBatch,
} from '@gameagenda/core/sync';
import { entriesFromRows, type OpRow } from '../sync-plan.ts';
import type { SqliteD1 } from './d1-sqlite.ts';
import type { Client } from './harness.ts';

export const NODE_A = 'aaaaaaaa';
export const NODE_B = 'bbbbbbbb';

let opCounter = 0;
/** `opId` uuidv7 válido y único. */
export function nextOpId(): string {
  return `eeeeeeee-0000-7000-8000-${(opCounter++).toString(16).padStart(12, '0')}`;
}

export function hlc(ms: number, counter = 0, node = NODE_A): string {
  return formatHlc({ ms, counter, node });
}

export function op(entryId: string, field: string, value: JsonValue, h: string): Op {
  return { opId: nextOpId(), entryId, field, value, hlc: h };
}

/** Las operaciones de «Apuntar» un juego, todas con la misma HLC. */
export function addOps(entryId: string, title: string, h: string): Op[] {
  return [
    op(entryId, 'status', 'want_to_play', h),
    op(entryId, 'title', title, h),
    op(entryId, 'rank', 'a0', h),
    op(entryId, 'addedAt', '2026-11-06', h),
  ];
}

export async function sync(
  client: Client,
  ops: readonly unknown[],
  cursor = 0,
  purgedSeq = 0,
): Promise<{ status: number; json: SyncResponse }> {
  const response = await client.post('/api/v1/sync', { cursor, purgedSeq, ops });
  return { status: response.status, json: response.json as SyncResponse };
}

/** El estado de cada entrada según las filas de `op` de D1 (de una agenda), ordenado por id. */
export function serverEntries(db: SqliteD1, agendaId?: string): Entry[] {
  const rows =
    agendaId === undefined
      ? db.rows<OpRow>('SELECT entry_id, field, value, hlc FROM op')
      : db.rows<OpRow>('SELECT entry_id, field, value, hlc FROM op WHERE agenda_id = ?', agendaId);
  return sortEntries(entriesFromRows(rows, nextOpId).values());
}

/** La agenda de un dispositivo. */
export function agendaOf(db: SqliteD1, deviceId: string): string {
  const [row] = db.rows<{ agenda_id: string }>(
    'SELECT agenda_id FROM device WHERE id = ?',
    deviceId,
  );
  if (row === undefined) throw new Error(`agendaOf: ${deviceId} no existe`);
  return row.agenda_id;
}

export function sortEntries(entries: Iterable<Entry>): Entry[] {
  return [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Platinado ⇒ Completado en lo que guarda D1, sin reconstruir (reconstruir ya lo repararía): si
 * la marca va por delante del estado, el estado es Completado.
 */
export function storedPlatinumViolations(db: SqliteD1, agendaId = '%'): string[] {
  const rows = db.rows<{ entry_id: string; field: string; value: string; hlc: string }>(
    `SELECT entry_id, field, value, hlc FROM op
     WHERE field IN ('flags.platinum', 'status') AND agenda_id LIKE ?`,
    agendaId,
  );
  const byEntry = new Map<string, Record<string, { value: string; hlc: string }>>();
  for (const r of rows) {
    const e = byEntry.get(r.entry_id) ?? {};
    e[r.field] = { value: r.value, hlc: r.hlc };
    byEntry.set(r.entry_id, e);
  }
  const out: string[] = [];
  for (const [id, e] of byEntry) {
    const p = e['flags.platinum'];
    const s = e.status;
    if (p?.value === 'true' && p.hlc > (s?.hlc ?? '') && s?.value !== '"completed"') out.push(id);
  }
  return out;
}

/** Una réplica de la agenda, como la app: estado, `outbox`, cursor y `purgedSeq`. */
export class Replica {
  readonly client: Client;
  state = new Map<string, Entry>();
  outbox: Op[] = [];
  cursor = 0;
  purgedSeq = 0;
  calls = 0;

  constructor(client: Client) {
    this.client = client;
  }

  /** Una acción (o un lote) local: se aplica y va a la `outbox`, con sus derivadas. */
  local(ops: readonly Op[]): void {
    this.outbox.push(...ops, ...this.apply(ops));
  }

  /** Los cambios que llegan del servidor: solo sus derivadas van a la `outbox`. */
  remote(ops: readonly Op[]): void {
    this.outbox.push(...this.apply(ops));
  }

  private apply(ops: readonly Op[]): Op[] {
    const { entries, derived } = applyOps((id) => this.state.get(id), ops, nextOpId);
    for (const [id, e] of entries) this.state.set(id, e);
    return derived;
  }

  /** Una sincronización completa: lotes de la `outbox` y páginas hasta que no queda nada. */
  async sync(batchSize = SYNC_BATCH_SIZE): Promise<void> {
    for (let guard = 0; guard < 100; guard++) {
      const batch = takeBatch(this.outbox, batchSize);
      const { status, json } = await sync(this.client, batch, this.cursor, this.purgedSeq);
      this.calls++;
      if (status !== 200) throw new Error(`sync: ${status} ${JSON.stringify(json)}`);
      if (json.rejected.length > 0)
        throw new Error(`sync: rechazos ${JSON.stringify(json.rejected)}`);
      const done = new Set(json.accepted);
      this.outbox = this.outbox.filter((o) => !done.has(o.opId));
      const changes: Op[] = json.changes.map((ch) => ({ opId: nextOpId(), ...ch }));
      if (changes.length > 0) this.remote(changes);
      this.cursor = json.cursor;
      this.purgedSeq = json.purgedSeq;
      if (!json.more && this.outbox.length === 0) return;
    }
    throw new Error('sync: no acaba');
  }

  entries(): Entry[] {
    return sortEntries(this.state.values());
  }
}

export type { SyncResponse };
