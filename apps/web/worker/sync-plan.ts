// Lo que hace `POST /api/v1/sync` con las operaciones, sin E/S (§7.7; ADR-011). D1 guarda la
// operación ganadora de cada campo; el servidor reconstruye cada entrada tocada a partir de sus
// filas, le aplica el lote con la misma `applyOps()` que la app (LWW por campo, Platinado ⇒
// Completado y reenvío de los manuales vinculados) y escribe las filas que cambian. Así el LWW
// tiene una sola implementación: en SQL, el desempate por valor compararía UTF-8, y en
// JavaScript se compara UTF-16.

import { type Entry, isField, readField } from '@gameagenda/core/entries';
import { applyOps, canon, merge, type NewOpId, type Op } from '@gameagenda/core/sync';

/** Una fila de `op` tal como sale de D1: `value` es el JSON canónico (`canon()`). */
export interface OpRow {
  entry_id: string;
  field: string;
  value: string;
  hlc: string;
}

/** Una fila que escribir, con nombres cortos porque viaja como JSON a `json_each()`. */
export interface RowWrite {
  e: string;
  f: string;
  v: string;
  h: string;
}

export interface SyncPlan {
  writes: RowWrite[];
  /** Entradas que las derivadas tocan y cuyas filas no se han leído: hay que leerlas y repetir. */
  missing: string[];
}

/** `opId` de las derivadas: en el servidor no se guardan, así que basta un contador. */
export function counterOpIds(): NewOpId {
  let n = 0;
  return () => `00000000-0000-7000-8000-${(n++).toString(16).padStart(12, '0')}`;
}

function rowKey(entryId: string, field: string): string {
  return `${entryId}\u0000${field}`;
}

/** Cada entrada, a partir de sus filas (las derivadas de reconstruir no se usan). */
export function entriesFromRows(rows: readonly OpRow[], newOpId: NewOpId): Map<string, Entry> {
  const groups = new Map<string, Op[]>();
  for (const r of rows) {
    const op: Op = {
      opId: newOpId(),
      entryId: r.entry_id,
      field: r.field,
      value: JSON.parse(r.value),
      hlc: r.hlc,
    };
    const group = groups.get(r.entry_id);
    if (group) group.push(op);
    else groups.set(r.entry_id, [op]);
  }
  const out = new Map<string, Entry>();
  for (const [id, ops] of groups) out.set(id, merge(undefined, ops, newOpId).entry);
  return out;
}

/**
 * Las filas que cambian al aplicar `ops` sobre lo que dicen `rows`. `loaded` son las entradas
 * cuyas filas se han leído (aunque no tengan ninguna): si una derivada toca otra, va en `missing`.
 */
export function planSync(
  rows: readonly OpRow[],
  loaded: ReadonlySet<string>,
  ops: readonly Op[],
): SyncPlan {
  const newOpId = counterOpIds();
  const known = entriesFromRows(rows, newOpId);
  const { entries } = applyOps((id) => known.get(id), ops, newOpId);
  const missing = [...entries.keys()].filter((id) => !loaded.has(id));
  if (missing.length > 0) return { writes: [], missing };

  const stored = new Map<string, OpRow>();
  for (const r of rows) stored.set(rowKey(r.entry_id, r.field), r);
  const writes: RowWrite[] = [];
  for (const [id, entry] of entries) {
    for (const [field, hlc] of Object.entries(entry.hlc)) {
      if (!isField(field)) continue;
      const value = canon(readField(entry, field));
      const row = stored.get(rowKey(id, field));
      if (row === undefined || row.hlc !== hlc || row.value !== value) {
        writes.push({ e: id, f: field, v: value, h: hlc });
      }
    }
  }
  return { writes, missing: [] };
}
