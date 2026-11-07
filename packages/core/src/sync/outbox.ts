// Compactación de la `outbox` por (entryId, field) y lotes que no parten acciones (§7.4).

import { beats, type Op } from './op.ts';

/**
 * Tamaño de lote de la sincronización (§7.7). Era 500; con 200, filtrar y planificar el lote en el
 * Worker cuesta ≈1,4 ms (p50) y ≈2,3 ms (p99) en Node, lejos de los 10 ms de CPU del plan gratuito
 * también en frío (con 500, 8,5 ms en frío; ADR-011 y CA4.6).
 */
export const SYNC_BATCH_SIZE = 200;

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

/** Orden de subida: HLC ascendente y, a igual HLC, `opId`. */
function uploadOrder(a: Op, b: Op): number {
  return a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : a.opId < b.opId ? -1 : a.opId > b.opId ? 1 : 0;
}

/** Una copia de `ops` en orden de subida (el de `takeBatch`). */
export function sortForUpload(ops: readonly Op[]): Op[] {
  return [...ops].sort(uploadOrder);
}

/**
 * El lote que empieza en `start` de una lista ya en orden de subida (`sortForUpload`), con las
 * reglas de `takeBatch` y sin reordenar nada: quien sube muchos lotes ordena la `outbox` una vez,
 * no en cada lote (subirla entera tras activar o emparejar sería cuadrático).
 */
export function takeSortedBatch(sorted: readonly Op[], max = SYNC_BATCH_SIZE, start = 0): Op[] {
  let end = start;
  while (end < sorted.length) {
    const hlc = (sorted[end] as Op).hlc;
    let j = end;
    while (j < sorted.length && (sorted[j] as Op).hlc === hlc) j++;
    if (end > start && j - start > max) break;
    end = j;
    if (end - start >= max) break;
  }
  return sorted.slice(start, end);
}

/**
 * Primer lote de la `outbox`: por HLC ascendente y sin partir nunca una acción (todas sus
 * operaciones comparten HLC). Si una sola acción supera `max`, va entera en su lote.
 */
export function takeBatch(ops: readonly Op[], max = SYNC_BATCH_SIZE): Op[] {
  return takeSortedBatch(sortForUpload(ops), max);
}
