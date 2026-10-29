// CSV para hojas de cálculo (§7.5): UTF-8 con BOM, `;`, CRLF y comillas RFC 4180.
// Sin HLC: importarlo solo crea entradas nuevas (DECISIONES.md §10, punto 11).

import { type ActionResult, addEntryExact } from '../entries/actions.ts';
import { isValidDay } from '../entries/day.ts';
import { isEntryId, manualEntryId } from '../entries/ids.ts';
import {
  DAY_FIELDS,
  type Day,
  type DayField,
  DEFAULT_STATUS,
  type Entry,
  type EntryFields,
  isLive,
  isPlatform,
  isStatus,
  NOTE_MAX_LENGTH,
  type Platform,
  type Status,
} from '../entries/model.ts';
import { keyBetween } from '../entries/rank.ts';
import type { NewOpId, Op } from '../sync/op.ts';
import type { ImportCounts } from './export.ts';

export const CSV_COLUMNS = [
  'id',
  'title',
  'status',
  'statusLabel',
  'platinum',
  'owned',
  'next',
  'platform',
  'addedAt',
  'startedAt',
  'completedAt',
  'platinumAt',
  'ownedAt',
  'note',
] as const;
export type CsvColumn = (typeof CSV_COLUMNS)[number];

/** Etiquetas de estado de la interfaz («Quiero jugar»…): viven en la web. */
export type StatusLabels = Readonly<Record<Status, string>>;

const BOM = '﻿';
const SEPARATOR = ';';
const EOL = '\r\n';
/** Inyección de fórmulas: `'` delante de lo que empieza por `=`, `+`, `-` o `@` (OWASP). */
const FORMULA_START = /^'*[=+\-@]/;
const ESCAPED_FORMULA = /^'+[=+\-@]/;

function cell(value: string): string {
  // También se protege lo que ya empezaba por `'` + fórmula, para que importar sea exacto.
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function bool(value: boolean | undefined): string {
  return value === true ? '1' : '0';
}

/** Mi lista en CSV (solo las entradas visibles, en el orden recibido). */
export function entriesToCsv(entries: Iterable<EntryFields>, statusLabels: StatusLabels): string {
  const lines: string[] = [CSV_COLUMNS.join(SEPARATOR)];
  for (const e of entries) {
    if (!isLive(e)) continue;
    const row = [
      e.id,
      e.title,
      e.status,
      statusLabels[e.status],
      bool(e.flags.platinum),
      bool(e.flags.owned),
      bool(e.flags.next),
      e.platform ?? '',
      ...DAY_FIELDS.map((d) => e[d] ?? ''),
      e.note,
    ];
    lines.push(row.map(cell).join(SEPARATOR));
  }
  return BOM + lines.map((line) => line + EOL).join('');
}

/**
 * Registros de un CSV con `;` y comillas RFC 4180 (admite CRLF, LF y saltos de línea dentro
 * de comillas). Quita el BOM y las líneas vacías. `null` si unas comillas no se cierran.
 */
export function parseCsv(text: string): string[][] | null {
  const src = text.startsWith(BOM) ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let atStart = true;
  const endRecord = () => {
    record.push(field);
    if (record.length > 1 || record[0] !== '') records.push(record);
    record = [];
    field = '';
    atStart = true;
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src.charAt(i);
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (src.charAt(i + 1) === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"' && atStart) {
      quoted = true;
      atStart = false;
    } else if (ch === SEPARATOR) {
      record.push(field);
      field = '';
      atStart = true;
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && src.charAt(i + 1) === '\n') i++;
      endRecord();
    } else {
      field += ch;
      atStart = false;
    }
  }
  if (quoted) return null;
  if (field !== '' || record.length > 0) endRecord();
  return records;
}

export type CsvRowErrorReason =
  | 'invalid-id'
  | 'missing-title'
  | 'invalid-status'
  | 'invalid-boolean'
  | 'invalid-platform'
  | 'invalid-date'
  | 'note-too-long';

export interface CsvRowError {
  /** Fila de la hoja (la cabecera es la 1). */
  row: number;
  column: CsvColumn;
  reason: CsvRowErrorReason;
}

export interface CsvImportContext {
  /** Fecha local de hoy, `AAAA-MM-DD` (para `addedAt` vacío). */
  today: string;
  /** La mayor `rank` de Quiero jugar: las altas van detrás, en el orden del fichero. */
  lastRank: string | null;
  /** Una HLC nueva por fila (`clock.next`): cada fila es una acción. */
  nextHlc: () => string;
  newOpId: NewOpId;
  /** uuidv7 para las filas sin `id` (juegos manuales nuevos). */
  newManualId: () => string;
}

export type CsvImportResult =
  | {
      ok: true;
      /** Entradas nuevas: van a `entries`. */
      entries: Entry[];
      /** Sus operaciones: van a la `outbox`. */
      ops: Op[];
      /** `added` y `rejected`; importar CSV nunca cambia ni quita. */
      counts: ImportCounts;
      /** Filas que ya estaban en Mi lista (o repetidas) y no se tocan. */
      skipped: number;
      errors: CsvRowError[];
    }
  | { ok: false; error: 'unterminated-quote' | 'empty' | 'missing-title-column' };

/** Quita la `'` que puso la exportación delante de una fórmula. */
function unescapeFormula(value: string): string {
  return ESCAPED_FORMULA.test(value) ? value.slice(1) : value;
}

class RowError extends Error {
  readonly column: CsvColumn;
  readonly reason: CsvRowErrorReason;
  constructor(column: CsvColumn, reason: CsvRowErrorReason) {
    super(reason);
    this.column = column;
    this.reason = reason;
  }
}

function parseBool(column: CsvColumn, value: string): boolean {
  const v = value.trim();
  if (v === '1') return true;
  if (v === '0' || v === '') return false;
  throw new RowError(column, 'invalid-boolean');
}

function parseDay(column: DayField, value: string): Day {
  const v = value.trim();
  if (v === '') return null;
  if (!isValidDay(v)) throw new RowError(column, 'invalid-date');
  return v;
}

/**
 * Importa un CSV: cada fila con `title` es un alta (manual si no trae `id`) con sus valores
 * tal cual; las que ya están en Mi lista se saltan. `statusLabel` se ignora. `current` da la
 * entrada actual de un id.
 */
export function importCsv(
  text: string,
  current: (id: string) => Entry | undefined,
  ctx: CsvImportContext,
): CsvImportResult {
  const records = parseCsv(text);
  if (records === null) return { ok: false, error: 'unterminated-quote' };
  const [header, ...rows] = records;
  if (header === undefined) return { ok: false, error: 'empty' };
  const index = new Map(header.map((name, i) => [name.trim(), i]));
  if (!index.has('title')) return { ok: false, error: 'missing-title-column' };

  const entries: Entry[] = [];
  const ops: Op[] = [];
  const errors: CsvRowError[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let lastRank = ctx.lastRank;

  for (const [r, row] of rows.entries()) {
    const get = (column: CsvColumn): string => {
      const i = index.get(column);
      return i === undefined ? '' : unescapeFormula(row[i] ?? '');
    };
    try {
      const rawId = get('id').trim();
      if (rawId !== '' && !isEntryId(rawId)) throw new RowError('id', 'invalid-id');
      const title = get('title').trim();
      if (title === '') throw new RowError('title', 'missing-title');
      const rawStatus = get('status').trim();
      if (rawStatus !== '' && !isStatus(rawStatus)) throw new RowError('status', 'invalid-status');
      const status: Status = rawStatus === '' ? DEFAULT_STATUS : (rawStatus as Status);
      const flags = {
        platinum: parseBool('platinum', get('platinum')),
        owned: parseBool('owned', get('owned')),
        next: parseBool('next', get('next')),
      };
      const rawPlatform = get('platform').trim();
      if (rawPlatform !== '' && !isPlatform(rawPlatform)) {
        throw new RowError('platform', 'invalid-platform');
      }
      const platform = rawPlatform === '' ? null : (rawPlatform as Platform);
      const days = Object.fromEntries(DAY_FIELDS.map((d) => [d, parseDay(d, get(d))])) as Record<
        DayField,
        Day
      >;
      const note = get('note');
      if (note.length > NOTE_MAX_LENGTH) throw new RowError('note', 'note-too-long');

      const id = rawId === '' ? manualEntryId(ctx.newManualId()) : rawId;
      const prev = current(id);
      if (seen.has(id) || isLive(prev)) {
        skipped++;
        continue;
      }
      seen.add(id);
      const rank = keyBetween(lastRank, null);
      const result: ActionResult | null = addEntryExact(
        prev,
        {
          id,
          title,
          cover: null,
          status,
          flags,
          rank,
          note,
          platform,
          ...days,
          addedAt: days.addedAt ?? ctx.today,
        },
        { hlc: ctx.nextHlc(), today: ctx.today, newOpId: ctx.newOpId },
      );
      if (result === null) {
        skipped++;
        continue;
      }
      lastRank = rank;
      entries.push(result.entry);
      ops.push(...result.ops);
    } catch (err) {
      if (!(err instanceof RowError)) throw err;
      errors.push({ row: r + 2, column: err.column, reason: err.reason });
    }
  }

  return {
    ok: true,
    entries,
    ops,
    counts: { added: entries.length, changed: 0, removed: 0, rejected: errors.length },
    skipped,
    errors,
  };
}
