// Etapa 0 · Estado (§4.6): `pipeline/state/master.ndjson.gz`, una fila por `appid` con nombre,
// marcas de cambio, clase (visible, retirado o bloqueado por región) y último enriquecimiento
// fechado. En M1 vive en local; la *Release* `catalog-state` de GitHub llega en M2. Sin estado,
// todo es alta.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { z } from 'zod';
import type { StateRow } from './derive.ts';

const uint = z.int().nonnegative();

const stateRowSchema = z.object({
  appid: z.int().positive(),
  name: z.string().min(1),
  nameEs: z.string().optional(),
  cls: z.enum(['visible', 'retired', 'blocked']),
  flags: uint,
  year: uint,
  reviews: uint,
  enrichedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lastModified: uint.optional(),
  priceChangeNumber: uint.optional(),
});

/** Lee el estado (`.ndjson.gz`, o `.ndjson` sin comprimir en los *fixtures*). */
export function readState(path: string | null): Map<number, StateRow> {
  const out = new Map<number, StateRow>();
  if (!path || !existsSync(path)) return out;
  const raw = readFileSync(path);
  const text = path.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  let line = 0;
  for (const l of text.split('\n')) {
    line++;
    if (!l.trim()) continue;
    const parsed = stateRowSchema.safeParse(JSON.parse(l));
    if (!parsed.success) throw new Error(`Estado no válido en ${path}:${line}`);
    out.set(parsed.data.appid, parsed.data);
  }
  return out;
}

export function serializeState(rows: readonly StateRow[]): string {
  return rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length > 0 ? '\n' : '');
}

export function writeState(path: string, rows: readonly StateRow[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const text = serializeState(rows);
  writeFileSync(path, path.endsWith('.gz') ? gzipSync(text, { level: 9 }) : text);
}
