// Exportación e importación JSON (§7.5): importar es fusionar con merge().

import * as z from 'zod';
import {
  type Entry,
  type EntryFields,
  type Field,
  isField,
  isLive,
  readField,
  SCALAR_FIELDS,
} from '../entries/model.ts';
import { hlcTime, MAX_DRIFT_MS, maxHlc } from '../sync/hlc.ts';
import { applyOps, opsFromEntry } from '../sync/merge.ts';
import { canon, type JsonValue, type NewOpId, type Op } from '../sync/op.ts';
import { entrySchema, instantSchema } from './entry.ts';

export const EXPORT_FORMAT = 'gameagenda-export';
export const EXPORT_VERSION = 1;

export const exportFileSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  exportedAt: instantSchema,
  appVersion: z.string().min(1),
  entries: z.array(entrySchema),
  settings: z.record(z.string(), z.json()),
});

export type ExportFile = z.infer<typeof exportFileSchema>;

export interface ExportInput {
  /** Todas las entradas de Dexie, lápidas y esqueletos incluidos. */
  entries: Iterable<EntryFields>;
  /** `settings` como clave → valor. */
  settings?: Readonly<Record<string, JsonValue>>;
  /** Instante ISO 8601 UTC (core no tiene reloj). */
  exportedAt: string;
  appVersion: string;
}

/** Solo los campos de `Entry` que no son derivados, en un orden fijo. */
function exportedEntry(e: EntryFields): EntryFields {
  return {
    id: e.id,
    status: e.status,
    flags: { ...e.flags },
    rank: e.rank,
    note: e.note,
    platform: e.platform,
    addedAt: e.addedAt,
    startedAt: e.startedAt,
    completedAt: e.completedAt,
    platinumAt: e.platinumAt,
    ownedAt: e.ownedAt,
    title: e.title,
    cover: e.cover,
    deletedAt: e.deletedAt,
    mergedInto: e.mergedInto,
    hlc: { ...e.hlc },
  };
}

/** Copia completa, con las HLC y sin `view` ni `lastHlc`; ordenada por `id`. */
export function createExport(input: ExportInput): ExportFile {
  const entries = [...input.entries]
    .map(exportedEntry)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: input.exportedAt,
    appVersion: input.appVersion,
    entries,
    settings: { ...(input.settings ?? {}) },
  };
}

export function stringifyExport(file: ExportFile): string {
  return JSON.stringify(file);
}

export type ParseExportResult =
  | { ok: true; file: ExportFile }
  | { ok: false; error: 'json' | 'format' | 'schema'; message: string };

/** Valida un objeto ya leído: formato y versión primero, luego cada campo. */
export function validateExport(data: unknown): ParseExportResult {
  const head = z.object({ format: z.literal(EXPORT_FORMAT), version: z.literal(EXPORT_VERSION) });
  const h = head.safeParse(data);
  if (!h.success) return { ok: false, error: 'format', message: z.prettifyError(h.error) };
  const r = exportFileSchema.safeParse(data);
  if (!r.success) return { ok: false, error: 'schema', message: z.prettifyError(r.error) };
  return { ok: true, file: r.data };
}

/** Lee el texto del fichero (el límite de 10 MB lo pone la web antes). */
export function parseExport(text: string): ParseExportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: 'json', message: String(err) };
  }
  return validateExport(data);
}

/** Ids que la web tiene que leer de Dexie antes de importar (entradas y destinos). */
export function exportEntryIds(file: ExportFile): string[] {
  const ids = new Set<string>();
  for (const e of file.entries) {
    ids.add(e.id);
    if (e.mergedInto !== null) ids.add(e.mergedInto);
  }
  return [...ids];
}

export interface ImportCounts {
  /** No estaban en Mi lista y ahora sí. */
  added: number;
  /** Estaban y han cambiado algún valor. */
  changed: number;
  /** Estaban y ahora son lápidas. */
  removed: number;
  /** Entradas con alguna HLC más de 5 min por delante de `now + desfase`. */
  rejected: number;
}

export interface ImportContext {
  /** `Date.now()` de la web. */
  nowMs: number;
  /** Desfase con el servidor (0 hasta M4). */
  offsetMs?: number;
  newOpId: NewOpId;
}

export interface ImportResult {
  /** Entradas que cambian, ya fusionadas: van a `entries`. */
  entries: Entry[];
  /** Las operaciones que ganan (también derivadas): van a la `outbox`. */
  ops: Op[];
  counts: ImportCounts;
  /** La mayor HLC aceptada, para `clock.receive()`; `null` si no hay ninguna. */
  maxHlc: string | null;
  settings: Record<string, JsonValue>;
}

/** Campos cuya HLC o valor cambian de `before` a `after`. */
function changedFields(before: Entry | undefined, after: Entry): Field[] {
  const out: Field[] = [];
  for (const [field, hlc] of Object.entries(after.hlc)) {
    if (!isField(field)) continue;
    if (
      before === undefined ||
      before.hlc[field] !== hlc ||
      canon(readField(before, field)) !== canon(readField(after, field))
    ) {
      out.push(field);
    }
  }
  return out;
}

function activeFlags(e: Entry): string {
  return Object.keys(e.flags)
    .filter((name) => e.flags[name] === true)
    .sort()
    .join(',');
}

function valuesDiffer(before: Entry, after: Entry): boolean {
  return (
    activeFlags(before) !== activeFlags(after) || SCALAR_FIELDS.some((f) => before[f] !== after[f])
  );
}

/**
 * Importar es fusionar (§7.5): cada entrada se convierte en operaciones (una por campo con
 * HLC) que pasan por `merge()`; se rechazan las HLC más de 5 min por delante de
 * `nowMs + offsetMs`. Importar dos veces no cambia nada. `current` da la entrada actual de
 * cada id de `exportEntryIds(file)`.
 */
export function importExport(
  file: ExportFile,
  current: (id: string) => Entry | undefined,
  ctx: ImportContext,
): ImportResult {
  const limit = ctx.nowMs + (ctx.offsetMs ?? 0) + MAX_DRIFT_MS;
  const accepted: Op[] = [];
  const rejected = new Set<string>();
  for (const e of file.entries) {
    for (const o of opsFromEntry(e, ctx.newOpId)) {
      if (hlcTime(o.hlc) > limit) rejected.add(e.id);
      else accepted.push(o);
    }
  }

  const { entries: merged } = applyOps(current, accepted, ctx.newOpId);
  const entries: Entry[] = [];
  const ops: Op[] = [];
  const counts: ImportCounts = { added: 0, changed: 0, removed: 0, rejected: rejected.size };
  for (const [id, after] of merged) {
    const before = current(id);
    const fields = changedFields(before, after);
    if (fields.length === 0) continue;
    entries.push(after);
    for (const field of fields) {
      ops.push({
        opId: ctx.newOpId(),
        entryId: id,
        field,
        value: readField(after, field),
        hlc: after.hlc[field] as string,
      });
    }
    const wasLive = before !== undefined && isLive(before);
    const isNowLive = isLive(after);
    if (!wasLive && isNowLive) counts.added++;
    else if (wasLive && !isNowLive) counts.removed++;
    else if (before !== undefined && wasLive && valuesDiffer(before, after)) counts.changed++;
  }

  const top = maxHlc(accepted.map((o) => o.hlc));
  return {
    entries,
    ops,
    counts,
    maxHlc: top === '' ? null : top,
    settings: { ...(file.settings as Record<string, JsonValue>) },
  };
}
