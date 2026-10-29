// Utilidades de las pruebas de core (no es un fichero de pruebas).

import type { Entry } from '../src/entries/index.ts';
import { formatHlc, type JsonValue, type Op } from '../src/sync/index.ts';

export const NODE_A = 'aaaaaaaa';
export const NODE_B = 'bbbbbbbb';
export const TODAY = '2026-10-29';
export const UUID_M1 = '0190b6e2-7f3a-7c4e-9d2a-1b2c3d4e5f60';
export const UUID_M2 = '0190b6e2-7f3a-7c4e-9d2a-1b2c3d4e5f61';
export const MANUAL_1 = `manual:${UUID_M1}`;
export const MANUAL_2 = `manual:${UUID_M2}`;

/** Generador determinista de uuidv7 válidos (para `opId` e ids manuales). */
export function uuids(prefix = 0): () => string {
  let n = 0;
  const p = prefix.toString(16).padStart(8, '0');
  return () => `${p}-0000-7000-8000-${(n++).toString(16).padStart(12, '0')}`;
}

export function hlc(ms: number, counter = 0, node = NODE_A): string {
  return formatHlc({ ms, counter, node });
}

let opCounter = 0;
export function op(entryId: string, field: string, value: JsonValue, h: string): Op {
  return {
    opId: `ffffffff-0000-7000-8000-${(opCounter++).toString(16).padStart(12, '0')}`,
    entryId,
    field,
    value,
    hlc: h,
  };
}

/** Entradas de un mapa, ordenadas por id, para comparar estados. */
export function sorted(entries: Iterable<Entry>): Entry[] {
  return [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Sin `opId`: para comparar operaciones que solo difieren en él. */
export function withoutOpId(ops: readonly Op[]): Array<Omit<Op, 'opId'>> {
  return ops.map(({ opId: _, ...rest }) => rest);
}
