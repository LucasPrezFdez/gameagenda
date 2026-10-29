// Generadores de fast-check compartidos por las pruebas de propiedades.

import fc from 'fast-check';
import { type Entry, STATUSES } from '../src/entries/index.ts';
import { applyOps, formatHlc, type JsonValue, type Op } from '../src/sync/index.ts';
import { MANUAL_1, MANUAL_2, NODE_A, NODE_B, uuids } from './helpers.ts';

export const NUM_RUNS = 1000;

/** Dos de Steam y dos manuales, cada manual con un único destino posible. */
export const STEAM_IDS = ['steam:10', 'steam:20'] as const;
export const MANUAL_IDS = [MANUAL_1, MANUAL_2] as const;
const TARGET: Record<string, string> = { [MANUAL_1]: 'steam:10', [MANUAL_2]: 'steam:20' };

const VALUES: Record<string, readonly JsonValue[]> = {
  status: STATUSES,
  'flags.platinum': [true, false],
  'flags.owned': [true, false],
  'flags.next': [true, false],
  rank: ['a0', 'a1', 'a0V', 'Zz'],
  note: ['', 'x', 'y'],
  platform: [null, 'pc', 'ps5'],
  addedAt: [null, '2019', '2020-02-29'],
  startedAt: [null, '2019-05'],
  completedAt: [null, '2021'],
  platinumAt: [null, '2021-01-01'],
  title: ['A', 'B'],
  cover: [null, 'https://cdn.example/1.jpg'],
  deletedAt: [null, '2026-10-28T09:15:00.000Z'],
};

/** HLC de un rango pequeño, para que haya muchos empates. */
export const hlcArb = fc
  .record({
    ms: fc.integer({ min: 1, max: 6 }),
    counter: fc.integer({ min: 0, max: 1 }),
    node: fc.constantFrom(NODE_A, NODE_B),
  })
  .map(formatHlc);

function fieldValueArb(id: string): fc.Arbitrary<{ field: string; value: JsonValue }> {
  const fields = Object.keys(VALUES);
  const plain = fc
    .constantFrom(...fields)
    .chain((field) =>
      fc.constantFrom(...(VALUES[field] ?? [null])).map((value) => ({ field, value })),
    );
  const target = TARGET[id];
  if (target === undefined) return plain;
  // `mergedInto` solo con su destino: dos destinos distintos no convergen sin sincronizar.
  return fc.oneof(
    { weight: 6, arbitrary: plain },
    { weight: 1, arbitrary: fc.constant({ field: 'mergedInto', value: target }) },
  );
}

/** Operación sin `opId` de una de las cuatro entradas. */
const rawOpArb = (ids: readonly string[]) =>
  fc
    .constantFrom(...ids)
    .chain((entryId) =>
      fc
        .record({ fv: fieldValueArb(entryId), hlc: hlcArb })
        .map(({ fv, hlc }) => ({ entryId, field: fv.field, value: fv.value, hlc })),
    );

/**
 * Lista de operaciones con `opId` únicos. Con `asActions`, cada «Platinado = true» lleva su
 * `status = 'completed'` con la misma HLC, como lo escribe la acción «Marcar Platinado»; sin
 * él, hay datos incompletos (lote partido, copia antigua).
 */
export function opsArb(
  ids: readonly string[] = [...STEAM_IDS, ...MANUAL_IDS],
  maxLength = 25,
  asActions = false,
): fc.Arbitrary<Op[]> {
  return fc.array(rawOpArb(ids), { minLength: 1, maxLength }).map((raw) => {
    const next = uuids(0xabc);
    return raw.flatMap((o) => {
      const ops: Op[] = [{ opId: next(), ...o }];
      if (asActions && o.field === 'flags.platinum' && o.value === true) {
        ops.push({ opId: next(), ...o, field: 'status', value: 'completed' });
      }
      return ops;
    });
  });
}

/** Aplica lotes en orden sobre un estado (vacío por defecto), como lo haría la web. */
export function runBatches(
  batches: readonly (readonly Op[])[],
  initial: ReadonlyMap<string, Entry> = new Map(),
): { state: Map<string, Entry>; derived: Op[] } {
  const state = new Map(initial);
  const derived: Op[] = [];
  const next = uuids(0xdef);
  for (const batch of batches) {
    const result = applyOps((id) => state.get(id), batch, next);
    for (const [id, e] of result.entries) state.set(id, e);
    derived.push(...result.derived);
  }
  return { state, derived };
}

/**
 * Dos réplicas que intercambian sus derivadas (como haría la sincronización a través de la
 * `outbox`) hasta que ninguna produce más.
 */
export function exchange(
  a: { state: Map<string, Entry>; derived: Op[] },
  b: { state: Map<string, Entry>; derived: Op[] },
): [Map<string, Entry>, Map<string, Entry>] {
  let ra = a;
  let rb = b;
  for (let round = 0; round < 20 && (ra.derived.length > 0 || rb.derived.length > 0); round++) {
    const na = runBatches([rb.derived], ra.state);
    const nb = runBatches([ra.derived], rb.state);
    ra = na;
    rb = nb;
  }
  return [ra.state, rb.state];
}

/** Parte `seq` en lotes por los cortes dados. */
export function split<T>(seq: readonly T[], cuts: readonly number[]): T[][] {
  const points = [...new Set(cuts.map((c) => c % (seq.length + 1)))].sort((a, b) => a - b);
  const out: T[][] = [];
  let from = 0;
  for (const p of points) {
    if (p > from) out.push(seq.slice(from, p));
    from = Math.max(from, p);
  }
  out.push(seq.slice(from));
  return out;
}
