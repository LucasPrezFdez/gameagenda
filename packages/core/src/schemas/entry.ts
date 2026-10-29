// Esquemas Zod de la agenda: ids (§7.3), fechas parciales (§7.4), Entry y Op.

import '../zod-config.ts';
import * as z from 'zod';
import { isValidDay } from '../entries/day.ts';
import { MANUAL_ENTRY_ID_PATTERN, STEAM_ENTRY_ID_PATTERN } from '../entries/ids.ts';
import {
  type EntryFields,
  type Field,
  FLAG_NAME_PATTERN,
  flagNameOf,
  isField,
  NOTE_MAX_LENGTH,
  PLATFORMS,
  type ScalarField,
  STATUSES,
} from '../entries/model.ts';
import { isRankKey } from '../entries/rank.ts';
import { HLC_PATTERN } from '../sync/hlc.ts';

export const steamEntryIdSchema = z.string().regex(STEAM_ENTRY_ID_PATTERN);
export const manualEntryIdSchema = z.string().regex(MANUAL_ENTRY_ID_PATTERN);
export const entryIdSchema = z.union([steamEntryIdSchema, manualEntryIdSchema]);

/** Fecha parcial que existe de verdad: `'2019'`, `'2019-05'`, `'2020-02-29'`. */
export const partialDateSchema = z
  .string()
  .refine((s) => isValidDay(s), { message: 'Fecha inexistente o fuera de 1900–2100' });
export const daySchema = partialDateSchema.nullable();

export const hlcSchema = z.string().regex(HLC_PATTERN);
export const rankSchema = z
  .string()
  .refine((s) => isRankKey(s), { message: 'Clave de orden no válida' });
export const noteSchema = z.string().max(NOTE_MAX_LENGTH);
export const statusSchema = z.enum(STATUSES);
export const platformSchema = z.enum(PLATFORMS);
export const flagNameSchema = z.string().regex(FLAG_NAME_PATTERN);
export const fieldSchema = z.string().refine((s) => isField(s), { message: 'Campo desconocido' });
/** Instante ISO 8601 UTC (`deletedAt`, `exportedAt`). */
export const instantSchema = z.iso.datetime();
export const opIdSchema = z.uuidv7();

const SCALAR_VALUE_SCHEMAS: Record<ScalarField, z.ZodType> = {
  status: statusSchema,
  rank: rankSchema,
  note: noteSchema,
  platform: platformSchema.nullable(),
  addedAt: daySchema,
  startedAt: daySchema,
  completedAt: daySchema,
  platinumAt: daySchema,
  ownedAt: daySchema,
  title: z.string(),
  cover: z.string().nullable(),
  deletedAt: instantSchema.nullable(),
  mergedInto: entryIdSchema.nullable(),
};

/** Esquema del valor de un campo de `Op.field`. */
export function fieldValueSchema(field: Field): z.ZodType {
  if (flagNameOf(field) !== null) return z.boolean();
  return SCALAR_VALUE_SCHEMAS[field as ScalarField];
}

/** Entrada sin derivados (exportación). `rank` vacío solo en esqueletos. */
export const entrySchema = z
  .object({
    id: entryIdSchema,
    status: statusSchema,
    flags: z.record(flagNameSchema, z.boolean()),
    rank: z.union([z.literal(''), rankSchema]),
    note: noteSchema,
    platform: platformSchema.nullable(),
    addedAt: daySchema,
    startedAt: daySchema,
    completedAt: daySchema,
    platinumAt: daySchema,
    ownedAt: daySchema,
    title: z.string(),
    cover: z.string().nullable(),
    deletedAt: instantSchema.nullable(),
    mergedInto: entryIdSchema.nullable(),
    hlc: z.record(fieldSchema, hlcSchema),
  })
  .superRefine((e, ctx) => {
    if (e.hlc.rank !== undefined && e.rank === '') {
      ctx.addIssue({ code: 'custom', path: ['rank'], message: 'rank vacío con HLC' });
    }
    if (e.mergedInto === e.id) {
      ctx.addIssue({ code: 'custom', path: ['mergedInto'], message: 'vinculado consigo mismo' });
    }
  }) satisfies z.ZodType<EntryFields>;

/** Operación de la `outbox` o de la sincronización, con el valor validado según su campo. */
export const opSchema = z
  .object({
    opId: opIdSchema,
    entryId: entryIdSchema,
    field: fieldSchema,
    value: z.json(),
    hlc: hlcSchema,
  })
  .superRefine((op, ctx) => {
    if (!isField(op.field)) return;
    if (!fieldValueSchema(op.field).safeParse(op.value).success) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: `Valor no válido para ${op.field}`,
      });
    }
  });
