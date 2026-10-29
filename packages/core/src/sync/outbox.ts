// Compactación de la `outbox` por (entryId, field) y lotes que no parten acciones (§7.4).

import { beats, type Op } from './op.ts';

/** Tamaño de lote de la sincronización (§7.7). */
export const SYNC_BATCH_SIZE = 500;

function key(o: Op): string {
  return `${o.entryId}\u0000${o.field}`;
}

/**
 * Deja, por (entryId, field), solo la operación que ganaría por LWW: las demás no cambiarían
 * nada en ninguna réplica. Conserva el orden relativo de las que quedan.
 */
export function compactOutbox(ops: readonly Op[]): { keep: Op[]; drop: Op[] } {
  const winners = new Map<string, Op>();
  for (const o of ops) {
    const cur = winners.get(key(o));
    // A igualdad total, se queda la de menor opId, para que el resultado no dependa del orden.
    const better =
      cur === undefined ||
      beats(o, cur) ||
      (o.hlc === cur.hlc && !beats(cur, o) && o.opId < cur.opId);
    if (better) winners.set(key(o), o);
  }
  const keep: Op[] = [];
  const drop: Op[] = [];
  for (const o of ops) (winners.get(key(o)) === o ? keep : drop).push(o);
  return { keep, drop };
}

/**
 * Primer lote de la `outbox`: por HLC ascendente y sin partir nunca una acción (todas sus
 * operaciones comparten HLC). Si una sola acción supera `max`, va entera en su lote.
 */
export function takeBatch(ops: readonly Op[], max = SYNC_BATCH_SIZE): Op[] {
  const sorted = [...ops].sort((a, b) =>
    a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : a.opId < b.opId ? -1 : a.opId > b.opId ? 1 : 0,
  );
  const batch: Op[] = [];
  let i = 0;
  while (i < sorted.length) {
    const hlc = (sorted[i] as Op).hlc;
    let j = i;
    while (j < sorted.length && (sorted[j] as Op).hlc === hlc) j++;
    if (batch.length > 0 && batch.length + (j - i) > max) break;
    batch.push(...sorted.slice(i, j));
    i = j;
    if (batch.length >= max) break;
  }
  return batch;
}
