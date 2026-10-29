// La agenda sobre Dexie: cada lote es una transacción `rw` que escribe `entries`, `outbox` y
// `meta.hlcClock` (§7.4). Si otra pestaña ha tocado la entrada entretanto, se fusionan las
// operaciones del lote sobre la guardada con `merge()`: así nunca se pisa un cambio ajeno.
import type { Entry } from '@gameagenda/core/entries';
import { merge, type NewOpId, type Op } from '@gameagenda/core/sync';
import { type AgendaStorage, sameEntry, type WriteBatch } from '../agenda/storage.ts';
import { onTableChange } from './changes.ts';
import { type GameAgendaDb, META_KEYS } from './database.ts';

function byEntry(ops: readonly Op[]): Map<string, Op[]> {
  const groups = new Map<string, Op[]>();
  for (const op of ops) {
    const group = groups.get(op.entryId);
    if (group) group.push(op);
    else groups.set(op.entryId, [op]);
  }
  return groups;
}

export function createDexieAgendaStorage(db: GameAgendaDb, newOpId: NewOpId): AgendaStorage {
  return {
    write(batch: WriteBatch) {
      return db.transaction('rw', db.entries, db.outbox, db.meta, async () => {
        const stored = await db.entries.bulkGet(batch.entries.map((entry) => entry.id));
        const written: Entry[] = [];
        const derived: Op[] = [];
        let groups: Map<string, Op[]> | null = null;
        batch.entries.forEach((entry, i) => {
          const current = stored[i];
          if (sameEntry(current, batch.before.get(entry.id))) {
            written.push(entry);
            return;
          }
          // Otra pestaña la ha cambiado: LWW campo a campo sobre lo guardado.
          groups ??= byEntry(batch.ops);
          const ops = groups.get(entry.id) ?? [];
          if (ops.length === 0) {
            written.push(entry);
            return;
          }
          const result = merge(current, ops, newOpId);
          written.push(result.entry);
          derived.push(...result.derived);
        });
        await db.entries.bulkPut(written);
        const ops = derived.length > 0 ? [...batch.ops, ...derived] : batch.ops;
        if (ops.length > 0) await db.outbox.bulkAdd([...ops]);
        await db.meta.put({ key: META_KEYS.hlcClock, value: batch.clock });
        return written;
      });
    },
    read: (ids) => db.entries.bulkGet([...ids]),
    readAll: () => db.entries.toArray(),
    async backup(copy) {
      await db.meta.put({ key: META_KEYS.backup, value: copy });
    },
    clear() {
      return db.transaction('rw', db.entries, db.outbox, db.settings, db.meta, async () => {
        await Promise.all([
          db.entries.clear(),
          db.outbox.clear(),
          db.settings.clear(),
          db.meta.clear(),
        ]);
      });
    },
    subscribe: (listener) => onTableChange(db, 'entries', listener),
  };
}
