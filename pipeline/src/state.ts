// Etapa 0 · Estado (§4.6): `pipeline/state/master.ndjson.gz`, una fila por `appid` con nombre,
// marcas de cambio, clase (visible, retirado o bloqueado por región) y último enriquecimiento
// fechado, con sus detalles (la reserva si falla Query) y los días de alta y renombrado de los
// últimos 14 días (`recent`). Desde M2, la primera línea es una cabecera con la versión publicada
// y el día del último enriquecimiento (`enrichmentAgeDays`); el estado de M1, sin cabecera, se
// sigue leyendo. Sin estado, todo es alta. Transporte: *Release* `catalog-state` (§4.5).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { gameDetailsSchema } from '@gameagenda/core/catalog-format';
import { z } from 'zod';
import type { StateRow } from './derive.ts';

const uint = z.int().nonnegative();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const stateRowSchema = z.object({
  appid: z.int().positive(),
  name: z.string().min(1),
  nameEs: z.string().optional(),
  cls: z.enum(['visible', 'retired', 'blocked']),
  flags: uint,
  year: uint,
  reviews: uint,
  enrichedOn: day,
  lastModified: uint.optional(),
  priceChangeNumber: uint.optional(),
  details: gameDetailsSchema.optional(),
  addedOn: day.optional(),
  renamedOn: day.optional(),
});

export const STATE_FORMAT = 'gacat-state';

/** Cabecera del estado (desde M2). */
const stateMetaSchema = z.object({
  format: z.literal(STATE_FORMAT),
  v: z.literal(2),
  /** Última versión publicada (`AAAAMMDD.N`): da el `.N` de la siguiente sin leer el *manifest*. */
  version: z.string().regex(/^\d{8}\.[1-9]\d*$/),
  /** Día de la última pasada de Query correcta: `enrichmentAgeDays` cuenta desde él. */
  enrichedOn: day,
});

export interface StateMeta {
  readonly version: string | null;
  readonly enrichedOn: string | null;
}

export interface PipelineState {
  readonly rows: Map<number, StateRow>;
  readonly meta: StateMeta;
}

/** Lee el estado (`.ndjson.gz`, o `.ndjson` sin comprimir en los *fixtures*). */
export function readState(path: string | null): PipelineState {
  const rows = new Map<number, StateRow>();
  let meta: StateMeta = { version: null, enrichedOn: null };
  if (!path || !existsSync(path)) return { rows, meta };
  const raw = readFileSync(path);
  const text = path.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  let line = 0;
  let latest = '';
  for (const l of text.split('\n')) {
    line++;
    if (!l.trim()) continue;
    const json = JSON.parse(l) as unknown;
    if (line === 1 && (json as { format?: unknown }).format === STATE_FORMAT) {
      const head = stateMetaSchema.safeParse(json);
      if (!head.success) throw new Error(`Cabecera del estado no válida en ${path}`);
      meta = { version: head.data.version, enrichedOn: head.data.enrichedOn };
      continue;
    }
    const parsed = stateRowSchema.safeParse(json);
    if (!parsed.success) throw new Error(`Estado no válido en ${path}:${line}`);
    rows.set(parsed.data.appid, parsed.data);
    if (parsed.data.enrichedOn > latest) latest = parsed.data.enrichedOn;
  }
  // Estado de M1: sin cabecera, el último enriquecimiento es el de las filas.
  if (meta.enrichedOn === null && latest) meta = { ...meta, enrichedOn: latest };
  return { rows, meta };
}

export function serializeState(
  rows: readonly StateRow[],
  meta?: { version: string; enrichedOn: string },
): string {
  const head = meta ? `${JSON.stringify({ format: STATE_FORMAT, v: 2, ...meta })}\n` : '';
  return head + rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length > 0 ? '\n' : '');
}

export function writeState(
  path: string,
  rows: readonly StateRow[],
  meta?: { version: string; enrichedOn: string },
): void {
  mkdirSync(dirname(path), { recursive: true });
  const text = serializeState(rows, meta);
  writeFileSync(path, path.endsWith('.gz') ? gzipSync(text, { level: 9 }) : text);
}
