// Lo que hace la app con la respuesta de `POST /api/v1/sync` (§7.4 y §7.7; ADR-011), sin E/S:
// convertir los cambios en operaciones, volver a sellar las acciones rechazadas por reloj, el
// criterio de la purga de D1 y qué sube una entrada al unirse a una agenda.

import type { Entry, EntryFields } from '../entries/model.ts';
import { formatHlc, maxHlc } from './hlc.ts';
import { merge, opsFromEntry } from './merge.ts';
import type { JsonValue, NewOpId, Op } from './op.ts';

/**
 * Un cambio que baja del servidor: una fila de `op` de D1. Es `SyncChange` de
 * `@gameagenda/core/api`, escrito aquí sin Zod para que la agenda no lo arrastre.
 */
export interface RemoteChange {
  entryId: string;
  field: string;
  value: JsonValue;
  hlc: string;
}

/** Los cambios del servidor como operaciones, para `applyOps()` (el `opId` no viaja). */
export function opsFromChanges(changes: readonly RemoteChange[], newOpId: NewOpId): Op[] {
  return changes.map((c) => ({
    opId: newOpId(),
    entryId: c.entryId,
    field: c.field,
    value: c.value,
    hlc: c.hlc,
  }));
}

/** Agrupa operaciones por entrada, en su orden. */
export function groupByEntry(ops: readonly Op[]): Map<string, Op[]> {
  const groups = new Map<string, Op[]>();
  for (const o of ops) {
    const group = groups.get(o.entryId);
    if (group) group.push(o);
    else groups.set(o.entryId, [o]);
  }
  return groups;
}

// --- Volver a sellar (rechazo `clock`) ---

/**
 * Cada HLC vieja (una por acción) → una nueva de `next()`, en orden ascendente: dos acciones
 * rechazadas que tocaban el mismo campo siguen en el mismo orden. Quien llama ya ha corregido el
 * desfase del reloj y le ha hecho recibir todo lo que conoce del servidor, para que las nuevas
 * vayan por delante de cualquier HLC que el servidor pueda tener en esos campos.
 */
export function planReseal(oldHlcs: Iterable<string>, next: () => string): Map<string, string> {
  const plan = new Map<string, string>();
  for (const old of [...new Set(oldHlcs)].sort()) plan.set(old, next());
  return plan;
}

/**
 * Las operaciones de las acciones del plan, con su HLC nueva. Conservan el `opId`: es la misma
 * operación (misma entrada, campo y valor), el servidor no guarda los `opId` (solo sirven para
 * casar `accepted` y `rejected` en una respuesta) y así se sustituye en la `outbox` en el sitio.
 * Las que no están en el plan no se devuelven.
 */
export function resealOps(ops: readonly Op[], plan: ReadonlyMap<string, string>): Op[] {
  const out: Op[] = [];
  for (const o of ops) {
    const hlc = plan.get(o.hlc);
    if (hlc !== undefined) out.push({ ...o, hlc });
  }
  return out;
}

/**
 * La entrada con la HLC nueva en cada campo que tenía la vieja (y `lastHlc` recalculado), o `null`
 * si no tiene ninguna. Hace falta: si la entrada conservara la HLC futura, un cambio remoto con
 * una HLC entre la nueva y la vieja perdería aquí y ganaría en el servidor, y las réplicas
 * divergirían. Los valores no cambian, así que `view` tampoco.
 */
export function resealEntry(entry: Entry, plan: ReadonlyMap<string, string>): Entry | null {
  let hlc: Record<string, string> | null = null;
  for (const [field, h] of Object.entries(entry.hlc)) {
    const fresh = plan.get(h);
    if (fresh === undefined) continue;
    hlc ??= { ...entry.hlc };
    hlc[field] = fresh;
  }
  if (hlc === null) return null;
  return { ...entry, flags: { ...entry.flags }, hlc, lastHlc: maxHlc(Object.values(hlc)) };
}

// --- Purga de lápidas y esqueletos (§7.7) ---
//
// Solo purga D1, los lunes (`apps/web/worker/maintenance.ts`); la app no purga por su cuenta, y la
// purga le llega con un `reset`: si purgara con su propio calendario, una escritura vieja subida
// después dejaría réplicas distintas a la vista. La app usa el criterio para no subir al unirse a
// una agenda el contenido de lo que D1 purgaría (`uploadOf`).

/** Días tras los que se purgan las lápidas y los esqueletos sin cambios. */
export const PURGE_AFTER_DAYS = 90;
const DAY_MS = 86_400_000;

export interface PurgeCutoff {
  /** Instante ISO 8601 UTC: las lápidas con un `deletedAt` anterior se purgan. */
  deletedBefore: string;
  /** HLC: los esqueletos cuya mayor HLC es anterior se purgan. */
  unchangedBefore: string;
}

/** El corte de la purga a `nowMs` (la hora del servidor, si se conoce el desfase). */
export function purgeCutoff(nowMs: number, days = PURGE_AFTER_DAYS): PurgeCutoff {
  const ms = Math.max(0, Math.floor(nowMs - days * DAY_MS));
  return {
    deletedBefore: new Date(ms).toISOString(),
    unchangedBefore: formatHlc({ ms, counter: 0, node: '00000000' }),
  };
}

/** ¿Una lápida borrada antes del corte? */
function isOldTombstone(e: Pick<EntryFields, 'deletedAt'>, cutoff: PurgeCutoff): boolean {
  return e.deletedAt !== null && e.deletedAt < cutoff.deletedBefore;
}

/**
 * ¿Se purga? El criterio de la purga semanal de D1 (`apps/web/worker/maintenance.ts`, que usa
 * `purgeCutoff`): una lápida con `deletedAt` anterior al corte, o un esqueleto (sin HLC de
 * `status` o de `title`) cuya mayor HLC es anterior al corte.
 */
export function isPurgeable(
  e: Pick<EntryFields, 'deletedAt' | 'hlc'>,
  cutoff: PurgeCutoff,
): boolean {
  if (isOldTombstone(e, cutoff)) return true;
  const skeleton = e.hlc.status === undefined || e.hlc.title === undefined;
  return skeleton && maxHlc(Object.values(e.hlc)) < cutoff.unchangedBefore;
}

/** Lo que sube una lápida purgable: lo que decide el borrado y el reenvío de un manual vinculado. */
const TOMBSTONE_UPLOAD: ReadonlySet<string> = new Set(['deletedAt', 'mergedInto']);

export interface Upload {
  /** Operaciones para la `outbox`. */
  ops: Op[];
  /** La entrada en local: la misma, reducida a lo que sube o `null` (se borra). */
  local: Entry | null;
}

/**
 * Lo que sube una entrada al unirse a una agenda (activar, emparejar, recuperar o restaurar) o al
 * volver a subirlo todo tras un D1 vuelto atrás (§7.7 y §11.2), con el corte de `purgeCutoff`:
 * - Una lápida purgable sube solo `deletedAt` y, si lo tiene, `mergedInto`, con sus HLC. Basta
 *   para que el borrado gane por LWW y para que el servidor reenvíe a la entrada de Steam lo que
 *   otro dispositivo aún tenga en el manual vinculado. Su contenido (la nota, el título…) no sale
 *   del dispositivo: D1 lo purgaría el lunes siguiente.
 * - Un esqueleto purgable no sube nada.
 * - Lo demás sube entero (`opsFromEntry`).
 * En local, la entrada queda como quedará en el servidor (la app ya no purga por su cuenta).
 */
export function uploadOf(e: Entry, cutoff: PurgeCutoff, newOpId: NewOpId): Upload {
  if (!isPurgeable(e, cutoff)) return { ops: opsFromEntry(e, newOpId), local: e };
  const ops = isOldTombstone(e, cutoff)
    ? opsFromEntry(e, newOpId).filter((o) => TOMBSTONE_UPLOAD.has(o.field))
    : [];
  return { ops, local: ops.length === 0 ? null : merge(undefined, ops, newOpId).entry };
}
