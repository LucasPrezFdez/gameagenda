// merge(): LWW por campo con HLC (§7.4). Conmutativo e idempotente, sin claves foráneas.

import {
  type Entry,
  type EntryFields,
  type Field,
  isField,
  isUserField,
  readField,
  skeleton,
  viewOf,
  writeField,
} from '../entries/model.ts';
import { maxHlc } from './hlc.ts';
import { canon, type NewOpId, type Op } from './op.ts';

export interface MergeResult {
  entry: Entry;
  /** Operaciones derivadas: también van a la `outbox`. */
  derived: Op[];
}

function apply(e: Entry, field: Field, value: unknown, hlc: string): void {
  writeField(e, field, value);
  e.hlc[field] = hlc;
}

/** Recalcula los derivados `view` (ausente en lápidas y esqueletos) y `lastHlc`. */
function finish(e: Entry): Entry {
  const view = viewOf(e);
  if (view === undefined) delete e.view;
  else e.view = view;
  e.lastHlc = maxHlc(Object.values(e.hlc));
  return e;
}

/** Campos de usuario con HLC, con su valor y HLC actuales. */
function userFieldOps(e: EntryFields): Array<Pick<Op, 'field' | 'value' | 'hlc'>> {
  const out: Array<Pick<Op, 'field' | 'value' | 'hlc'>> = [];
  for (const [field, hlc] of Object.entries(e.hlc)) {
    if (isField(field) && isUserField(field)) out.push({ field, value: readField(e, field), hlc });
  }
  return out;
}

/**
 * Fusiona `ops` (todas de la misma entrada) sobre `prev`, como el pseudocódigo de la §7.4.
 * Una entrada desconocida empieza como esqueleto. Las operaciones de campos desconocidos se
 * ignoran. `newOpId` da el `opId` de las derivadas.
 *
 * Además del pseudocódigo: cuando `mergedInto` cambia en esta fusión, se reenvía el estado
 * actual de los campos de usuario (no solo las operaciones del lote), y la derivada de
 * Platinado del manual también se reenvía. Así da igual que una operación del manual llegue
 * antes o después que su `mergedInto`.
 */
export function merge(prev: Entry | undefined, ops: readonly Op[], newOpId: NewOpId): MergeResult {
  const id = prev?.id ?? ops[0]?.entryId;
  if (id === undefined) throw new RangeError('merge: sin entrada previa ni operaciones');
  // Copia superficial: basta y evita structuredClone.
  const e: Entry = prev
    ? { ...prev, flags: { ...prev.flags }, hlc: { ...prev.hlc } }
    : skeleton(id);
  const prevTarget = prev?.mergedInto ?? null;

  for (const o of ops) {
    if (o.entryId !== id) throw new RangeError(`merge: operación de ${o.entryId} en ${id}`);
    if (!isField(o.field)) continue;
    const cur = e.hlc[o.field];
    if (
      cur === undefined ||
      o.hlc > cur ||
      (o.hlc === cur && canon(o.value) > canon(readField(e, o.field)))
    ) {
      apply(e, o.field, o.value, o.hlc);
    }
  }

  const derived: Op[] = [];
  // Platinado ⇒ Completado, por relojes, con la HLC de la marca. A igual HLC, cualquier otro
  // estado gana a 'completed' por canon(), así que el resultado no depende del orden.
  const p = e.hlc['flags.platinum'];
  if (
    e.flags.platinum === true &&
    p !== undefined &&
    p > (e.hlc.status ?? '') &&
    e.status !== 'completed'
  ) {
    derived.push({ opId: newOpId(), entryId: id, field: 'status', value: 'completed', hlc: p });
  }
  for (const d of derived) apply(e, 'status', d.value, d.hlc);

  // Manual vinculado: reenviar los campos de usuario a la entrada de Steam (también la
  // derivada de Platinado, para que el destino no dependa del orden de llegada).
  const target = e.mergedInto;
  if (target !== null) {
    const forwarded =
      target !== prevTarget
        ? userFieldOps(e)
        : [...ops.filter((o) => isUserField(o.field)), ...derived];
    for (const o of forwarded) {
      derived.push({
        opId: newOpId(),
        entryId: target,
        field: o.field,
        value: o.value,
        hlc: o.hlc,
      });
    }
  }
  return { entry: finish(e), derived };
}

export interface ApplyResult {
  /** Entradas tocadas, ya fusionadas. */
  entries: Map<string, Entry>;
  /** Todas las derivadas (también las reenviadas), para la `outbox`. */
  derived: Op[];
}

/**
 * Aplica operaciones de varias entradas: agrupa por `entryId`, fusiona cada grupo y sigue
 * las derivadas que van a otra entrada (vinculación) hasta `maxDepth` saltos.
 */
export function applyOps(
  get: (id: string) => Entry | undefined,
  ops: readonly Op[],
  newOpId: NewOpId,
  maxDepth = 8,
): ApplyResult {
  const entries = new Map<string, Entry>();
  const derivedAll: Op[] = [];
  let pending: readonly Op[] = ops;
  for (let depth = 0; pending.length > 0 && depth <= maxDepth; depth++) {
    const groups = new Map<string, Op[]>();
    for (const o of pending) {
      const group = groups.get(o.entryId);
      if (group) group.push(o);
      else groups.set(o.entryId, [o]);
    }
    const next: Op[] = [];
    for (const [id, group] of groups) {
      const { entry, derived } = merge(entries.get(id) ?? get(id), group, newOpId);
      entries.set(id, entry);
      for (const d of derived) {
        derivedAll.push(d);
        if (d.entryId !== id) next.push(d);
      }
    }
    pending = next;
  }
  return { entries, derived: derivedAll };
}

/** Una operación por cada campo con HLC: así se importa una entrada (§7.5). */
export function opsFromEntry(e: EntryFields, newOpId: NewOpId): Op[] {
  const out: Op[] = [];
  for (const [field, hlc] of Object.entries(e.hlc)) {
    if (!isField(field)) continue;
    out.push({ opId: newOpId(), entryId: e.id, field, value: readField(e, field), hlc });
  }
  return out;
}
