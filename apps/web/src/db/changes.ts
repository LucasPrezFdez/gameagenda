// Cambios de otras pestañas (y de esta) con el evento `storagemutated` de Dexie: Dexie lo emite
// al confirmar cada transacción y lo reenvía a las demás pestañas por `BroadcastChannel`.
import { Dexie, type ObservabilitySet, RangeSet } from 'dexie';
import type { GameAgendaDb, SCHEMA_V1 } from './database.ts';
import { tablePart } from './database.ts';

/** Claves primarias cambiadas, o `all` si no se saben (un `clear()`, un lote grande o bfcache). */
export type TableChange = { readonly ids: readonly string[] } | { readonly all: true };

const ALL: TableChange = { all: true };

function changeOf(parts: ObservabilitySet, part: string): TableChange | null {
  // Dexie manda `{ all }` al volver de la bfcache: hay que releer todo.
  if (parts.all !== undefined) return ALL;
  const tree = parts[part];
  if (tree === undefined) return null;
  const ids: string[] = [];
  for (const node of RangeSet(tree)) {
    if (typeof node.from !== 'string' || node.from !== node.to) return ALL;
    ids.push(node.from);
  }
  return ids.length > 0 ? { ids } : null;
}

export function onTableChange(
  db: GameAgendaDb,
  table: keyof typeof SCHEMA_V1,
  listener: (change: TableChange) => void,
): () => void {
  const part = tablePart(db, table);
  const handler = (parts: ObservabilitySet) => {
    const change = changeOf(parts, part);
    if (change !== null) listener(change);
  };
  Dexie.on('storagemutated', handler);
  return () => Dexie.on.storagemutated.unsubscribe(handler);
}
