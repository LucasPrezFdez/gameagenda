// Propiedades de merge() de la §12.2, con 1 000 casos cada una.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Entry } from '../src/entries/index.ts';
import { compactOutbox, merge, type Op, opsFromEntry } from '../src/sync/index.ts';
import {
  exchange,
  MANUAL_IDS,
  NUM_RUNS,
  opsArb,
  runBatches,
  STEAM_IDS,
  split,
} from './arbitraries.ts';
import { sorted, uuids } from './helpers.ts';

/** Platinado ⇒ Completado salvo que el estado cambiara después (o en la misma acción). */
function platinumInvariant(e: Entry): boolean {
  if (e.flags.platinum !== true || e.status === 'completed') return true;
  return (e.hlc.status ?? '') >= (e.hlc['flags.platinum'] ?? '');
}

/** Las mismas operaciones, barajadas, con repeticiones y partidas en lotes. */
function reordered(asActions: boolean) {
  return opsArb(undefined, 25, asActions).chain((ops) =>
    fc.subarray(ops).chain((extra) => {
      const all = [...ops, ...extra];
      return fc.record({
        ops: fc.constant(ops),
        seq: fc.shuffledSubarray(all, { minLength: all.length, maxLength: all.length }),
        cuts: fc.array(fc.nat(), { maxLength: 6 }),
      });
    }),
  );
}

describe('propiedades de merge()', () => {
  it('las mismas operaciones, en cualquier orden, en lotes o repetidas, dan el mismo estado', () => {
    fc.assert(
      fc.property(reordered(true), ({ ops, seq, cuts }) => {
        const reference = sorted(runBatches([ops]).state.values());
        const other = sorted(runBatches(split(seq, cuts)).state.values());
        expect(other).toEqual(reference);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('con datos incompletos, las réplicas convergen al intercambiar sus derivadas', () => {
    fc.assert(
      fc.property(reordered(false), ({ ops, seq, cuts }) => {
        const [a, b] = exchange(runBatches([ops]), runBatches(split(seq, cuts)));
        expect(sorted(b.values())).toEqual(sorted(a.values()));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('merge(a, b) = merge(b, a): fusionar dos réplicas da lo mismo en los dos sentidos', () => {
    const scenario = fc
      .constantFrom(...STEAM_IDS, ...MANUAL_IDS)
      .chain((id) => fc.record({ a: opsArb([id], 15), b: opsArb([id], 15) }));
    fc.assert(
      fc.property(scenario, ({ a, b }) => {
        const next = uuids(1);
        const ea = merge(undefined, a, next).entry;
        const eb = merge(undefined, b, next).entry;
        const ab = merge(ea, opsFromEntry(eb, next), next).entry;
        const ba = merge(eb, opsFromEntry(ea, next), next).entry;
        expect(ab).toEqual(ba);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('con operaciones de acciones, merge(a, b) también es fusionar todo de una vez', () => {
    const scenario = fc
      .constantFrom(...STEAM_IDS, ...MANUAL_IDS)
      .chain((id) => fc.record({ a: opsArb([id], 15, true), b: opsArb([id], 15, true) }));
    fc.assert(
      fc.property(scenario, ({ a, b }) => {
        const next = uuids(1);
        const ea = merge(undefined, a, next).entry;
        const eb = merge(undefined, b, next).entry;
        const ab = merge(ea, opsFromEntry(eb, next), next).entry;
        expect(ab).toEqual(merge(undefined, [...a, ...b], next).entry);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('Platinado ⇒ Completado (según los relojes) se cumple tras cada fusión', () => {
    const scenario = opsArb().chain((ops) =>
      fc.record({ ops: fc.constant(ops), cuts: fc.array(fc.nat(), { maxLength: 6 }) }),
    );
    fc.assert(
      fc.property(scenario, ({ ops, cuts }) => {
        let state = new Map<string, Entry>();
        for (const batch of split(ops, cuts)) {
          state = runBatches([batch], state).state;
          for (const e of state.values()) expect(platinumInvariant(e)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('compactar la outbox no cambia el estado al que lleva', () => {
    fc.assert(
      fc.property(opsArb(), (ops: Op[]) => {
        const { keep } = compactOutbox(ops);
        expect(sorted(runBatches([keep]).state.values())).toEqual(
          sorted(runBatches([ops]).state.values()),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
