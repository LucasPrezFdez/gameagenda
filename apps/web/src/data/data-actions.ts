// Ajustes › Datos (*chunk* diferido, ver §6.2): exportar e importar JSON y CSV (§7.5), «Borrar
// todos mis datos» (§11.2) y exportar el registro de errores (§12.7). Zod y los esquemas de
// `@gameagenda/core/schemas` solo se cargan aquí, al pulsar un botón.
import {
  createExport,
  type ExportFile,
  entriesToCsv,
  type ImportCounts,
  importCsv,
  importExport,
  parseCsv,
  parseExport,
  stringifyExport,
} from '@gameagenda/core/schemas';
import { localDay } from '../agenda/agenda.ts';
import { type AgendaStore, compareRank, STATUSES } from '../agenda/types.ts';
import { clearErrorLog, readErrorLog } from '../errors/error-log.ts';
import { es } from '../i18n/es.ts';
import { yieldToMain } from '../lib/yield.ts';
import {
  DEFAULT_SETTINGS,
  type SettingsStore,
  settingsPatch,
  settingsRecord,
} from '../settings/settings-store.ts';
import type { CopyReminderStore } from './copy-reminder.ts';

/** Importar admite ficheros de hasta 10 MB (§7.5). */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

export interface DataServices {
  readonly agenda: AgendaStore;
  readonly settings: SettingsStore;
  /** Versión de la app (`__APP_VERSION__`), para el fichero exportado. */
  readonly appVersion: string;
  /** Exportar (JSON o CSV) vuelve a contar los 30 días del aviso de copia (RNF-08). */
  readonly copyReminder?: Pick<CopyReminderStore, 'copied'>;
}

export type ImportOutcome =
  | { readonly kind: 'done'; readonly counts: ImportCounts; readonly skipped: number }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'tooBig' };

export interface ExportedFile {
  readonly name: string;
  readonly type: string;
  readonly content: string;
}

function stamp(now: Date): string {
  return localDay(now);
}

function copyOf(services: DataServices, now: Date): ExportFile {
  return createExport({
    entries: services.agenda.allEntries(),
    settings: settingsRecord(services.settings.getSnapshot()),
    exportedAt: now.toISOString(),
    appVersion: services.appVersion,
  });
}

/** Copia completa en JSON: todas las entradas (lápidas incluidas) con sus HLC, y los ajustes. */
export function buildJsonExport(services: DataServices, now = new Date()): ExportedFile {
  return {
    name: `gameagenda-${stamp(now)}.json`,
    type: 'application/json',
    content: stringifyExport(copyOf(services, now)),
  };
}

const STATUS_ORDER = new Map(STATUSES.map((status, i) => [status, i]));

/** Mi lista en CSV para hojas de cálculo: por estado y, dentro, en el orden manual. */
export function buildCsvExport(services: DataServices, now = new Date()): ExportedFile {
  const entries = [...services.agenda.allEntries()].sort(
    (a, b) =>
      (STATUS_ORDER.get(a.status) ?? 0) - (STATUS_ORDER.get(b.status) ?? 0) || compareRank(a, b),
  );
  return {
    name: `gameagenda-${stamp(now)}.csv`,
    type: 'text/csv;charset=utf-8',
    content: entriesToCsv(entries, es.status),
  };
}

function looksLikeJson(name: string, text: string): boolean {
  const lower = name.toLowerCase();
  if (lower.endsWith('.json')) return true;
  if (lower.endsWith('.csv')) return false;
  return text.replace(/^﻿/, '').trimStart().startsWith('{');
}

/**
 * Juegos por lote al importar una copia JSON (Fase 2; DECISIONES §10.48). Con 5 000 de una vez,
 * fusionar, pintar y guardar dejaba tareas largas de más de un segundo.
 */
export const IMPORT_BATCH = 250;

export interface ImportOptions {
  readonly now?: Date;
  /** Para las pruebas: otro tamaño de lote. */
  readonly batchSize?: number;
  /** Entre lote y lote (por defecto, `yieldToMain`). */
  readonly pause?: () => Promise<void>;
}

/**
 * Las entradas de la copia en lotes de unas `size`, con todas las de un mismo `id` en el mismo
 * lote: así cada juego se fusiona de una vez y los recuentos salen como en una sola pasada.
 */
export function importBatches<T extends { readonly id: string }>(
  entries: readonly T[],
  size: number,
): T[][] {
  const byId = new Map<string, T[]>();
  for (const entry of entries) {
    const group = byId.get(entry.id);
    if (group) group.push(entry);
    else byId.set(entry.id, [entry]);
  }
  const batches: T[][] = [];
  let batch: T[] = [];
  for (const group of byId.values()) {
    if (batch.length > 0 && batch.length + group.length > size) {
      batches.push(batch);
      batch = [];
    }
    batch.push(...group);
  }
  batches.push(batch);
  return batches;
}

/**
 * Importar es fusionar (§7.5): antes, copia en `meta.backup`; después, recuento de altas,
 * cambios, bajas y rechazos. Un fichero que no es una copia válida no cambia nada.
 */
export async function importText(
  services: DataServices,
  name: string,
  text: string,
  options: ImportOptions = {},
): Promise<ImportOutcome> {
  const { agenda, settings } = services;
  const now = options.now ?? new Date();
  if (looksLikeJson(name, text)) {
    const parsed = parseExport(text);
    if (!parsed.ok) return { kind: 'invalid' };
    await agenda.backup(copyOf(services, now));
    const counts: ImportCounts = { added: 0, changed: 0, removed: 0, rejected: 0 };
    const saved: Promise<void>[] = [];
    const batches = importBatches(parsed.file.entries, options.batchSize ?? IMPORT_BATCH);
    for (const [index, entries] of batches.entries()) {
      // Entre lote y lote, la app pinta y responde. Sin `await` entre fusionar y aplicar un
      // lote: cada uno se fusiona con la agenda tal como está, también si se ha apuntado algo
      // entretanto (calcularlo todo antes y aplicarlo a trozos lo pisaría).
      if (index > 0) await (options.pause ?? yieldToMain)();
      const ctx = agenda.importContext();
      const result = importExport({ ...parsed.file, entries }, agenda.get, {
        nowMs: ctx.nowMs,
        offsetMs: ctx.offsetMs,
        newOpId: ctx.newOpId,
      });
      saved.push(agenda.applyImport(result));
      if (index === 0) settings.update(settingsPatch(result.settings));
      counts.added += result.counts.added;
      counts.changed += result.counts.changed;
      counts.removed += result.counts.removed;
      counts.rejected += result.counts.rejected;
    }
    await Promise.all(saved);
    return { kind: 'done', counts, skipped: 0 };
  }

  // CSV: sin HLC, solo da altas (DECISIONES §10, punto 11). Lo mismo que comprueba `importCsv`
  // antes de la primera fila, para no hacer la copia de seguridad de un fichero no válido.
  const records = parseCsv(text);
  const header = records?.[0]?.map((name) => name.trim());
  if (!header?.includes('title')) return { kind: 'invalid' };
  await agenda.backup(copyOf(services, now));
  const ctx = agenda.importContext();
  const result = importCsv(text, agenda.get, {
    today: ctx.today,
    lastRank: ctx.lastRank,
    nextHlc: ctx.nextHlc,
    newOpId: ctx.newOpId,
    newManualId: ctx.newManualId,
  });
  if (!result.ok) return { kind: 'invalid' };
  await agenda.applyImport({ entries: result.entries, ops: result.ops, maxHlc: null });
  return { kind: 'done', counts: result.counts, skipped: result.skipped };
}

export async function importFile(services: DataServices, file: File): Promise<ImportOutcome> {
  if (file.size > MAX_IMPORT_BYTES) return { kind: 'tooBig' };
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { kind: 'invalid' };
  }
  return importText(services, file.name, text);
}

/** Descarga con `Blob` (sin red ni servidor). */
export function download(file: ExportedFile): void {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportJson(services: DataServices): string {
  const now = new Date();
  const file = buildJsonExport(services, now);
  download(file);
  services.copyReminder?.copied(now.getTime());
  return file.name;
}

export function exportCsv(services: DataServices): string {
  const now = new Date();
  const file = buildCsvExport(services, now);
  download(file);
  services.copyReminder?.copied(now.getTime());
  return file.name;
}

export async function exportErrorLog(appVersion: string): Promise<string> {
  const now = new Date();
  const errors = await readErrorLog();
  const file: ExportedFile = {
    name: `gameagenda-errores-${stamp(now)}.json`,
    type: 'application/json',
    content: JSON.stringify(
      {
        format: 'gameagenda-errors',
        version: 1,
        exportedAt: now.toISOString(),
        appVersion,
        errors,
      },
      null,
      2,
    ),
  };
  download(file);
  return file.name;
}

/** Cachés del catálogo y de las portadas (§7.6, §7.8); la precaché de la app se queda. */
const CATALOG_CACHE_PREFIX = 'gacat-';

async function deleteCatalogCaches(): Promise<void> {
  if (typeof caches === 'undefined') return;
  const names = await caches.keys();
  await Promise.all(
    names
      .filter((name) => name.startsWith(CATALOG_CACHE_PREFIX))
      .map((name) => caches.delete(name)),
  );
}

/**
 * «Borrar todos mis datos» (RF-24, §7.8, §11.2): la agenda, la `outbox`, los ajustes, `meta`
 * (reloj, copia de seguridad, registro de errores y estado del catálogo) y la caché del catálogo.
 */
export async function deleteAllData(services: DataServices): Promise<void> {
  await services.agenda.deleteAll();
  // Borra las filas que pudiera estar guardando todavía (y vuelve a los valores por defecto).
  services.settings.update(DEFAULT_SETTINGS);
  clearErrorLog();
  await deleteCatalogCaches().catch(() => undefined);
}
