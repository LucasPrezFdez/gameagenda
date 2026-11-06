// CA4.1 a través de la micro-API (§12.2; ADR-011), con 1 000 casos cada propiedad: cualquier orden
// o repetición de las mismas operaciones da el mismo estado en D1, Platinado ⇒ Completado se
// cumple tras cada fusión, y dos réplicas que sincronizan por el servidor acaban iguales que él.
// Los generadores son los de las propiedades de `merge()` en core: mismas entradas, mismos
// campos, HLC de un rango pequeño para que haya empates y manuales que se vinculan.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { NUM_RUNS, opsArb, runBatches, split } from '../../../../packages/core/test/arbitraries.ts';
import { sorted } from '../../../../packages/core/test/helpers.ts';
import { type Client, createAgenda, createHarness, type Harness } from './harness.ts';
import {
  agendaOf,
  Replica,
  serverEntries,
  storedPlatinumViolations,
  sync,
} from './sync-support.ts';

/** 1 000 casos por la micro-API tardan unos segundos; en el *runner* del CI, más. */
const TIMEOUT = 120_000;

/** Una agenda nueva con dos dispositivos, en la D1 compartida por todos los casos. */
async function pairedAgenda(h: Harness): Promise<{ pc: Client; phone: Client; agendaId: string }> {
  const pc = h.client();
  const { deviceId } = await createAgenda(pc);
  const { code } = (await pc.post('/api/v1/pairing')).json;
  const phone = h.client();
  await phone.post('/api/v1/pairing/redeem', { code, label: 'Safari en iPhone' });
  return { pc, phone, agendaId: agendaOf(h.db, deviceId) };
}

/** Las mismas operaciones, barajadas, con repeticiones, en lotes y desde cualquiera de los dos. */
function reordered(asActions: boolean) {
  return opsArb(undefined, 25, asActions).chain((ops) =>
    fc.subarray(ops).chain((extra) => {
      const all = [...ops, ...extra];
      return fc.record({
        ops: fc.constant(ops),
        seq: fc.shuffledSubarray(all, { minLength: all.length, maxLength: all.length }),
        cuts: fc.array(fc.nat(), { maxLength: 6 }),
        senders: fc.array(fc.boolean(), { minLength: 7, maxLength: 7 }),
      });
    }),
  );
}

describe('CA4.1 en el servidor', () => {
  it(
    'las mismas operaciones, en cualquier orden, en lotes, repetidas y desde dos dispositivos, dan el mismo estado en D1',
    async () => {
      const h = createHarness();
      await fc.assert(
        fc.asyncProperty(reordered(true), async ({ ops, seq, cuts, senders }) => {
          const { pc, phone, agendaId } = await pairedAgenda(h);
          const batches = split(seq, cuts);
          for (const [i, batch] of batches.entries()) {
            const { status, json } = await sync(senders[i % senders.length] ? pc : phone, batch);
            expect(status).toBe(200);
            expect(json.rejected).toEqual([]);
            expect(storedPlatinumViolations(h.db, agendaId)).toEqual([]);
          }
          expect(serverEntries(h.db, agendaId)).toEqual(sorted(runBatches([ops]).state.values()));
        }),
        { numRuns: NUM_RUNS },
      );
    },
    TIMEOUT,
  );

  it(
    'con datos incompletos (la marca sin su estado), Platinado ⇒ Completado se cumple en D1 tras cada petición',
    async () => {
      const h = createHarness();
      await fc.assert(
        fc.asyncProperty(reordered(false), async ({ seq, cuts, senders }) => {
          const { pc, phone, agendaId } = await pairedAgenda(h);
          for (const [i, batch] of split(seq, cuts).entries()) {
            await sync(senders[i % senders.length] ? pc : phone, batch);
            expect(storedPlatinumViolations(h.db, agendaId)).toEqual([]);
          }
        }),
        { numRuns: NUM_RUNS },
      );
    },
    TIMEOUT,
  );

  it(
    'dos réplicas que apuntan sin red y sincronizan en cualquier orden acaban iguales entre sí y con D1',
    async () => {
      const h = createHarness({}, { pageSize: 7 });
      const scenario = fc.record({
        a: opsArb(undefined, 15, false),
        b: opsArb(undefined, 15, false),
        cutsA: fc.array(fc.nat(), { maxLength: 4 }),
        cutsB: fc.array(fc.nat(), { maxLength: 4 }),
        steps: fc.array(fc.constantFrom('a', 'b', 'syncA', 'syncB'), { maxLength: 14 }),
        batchSize: fc.integer({ min: 1, max: 30 }),
      });
      await fc.assert(
        fc.asyncProperty(scenario, async ({ a, b, cutsA, cutsB, steps, batchSize }) => {
          const { pc, phone, agendaId } = await pairedAgenda(h);
          const ra = new Replica(pc);
          const rb = new Replica(phone);
          const chunksA = split(a, cutsA);
          const chunksB = split(b, cutsB);
          for (const step of steps) {
            if (step === 'a' && chunksA.length > 0) ra.local(chunksA.shift() ?? []);
            if (step === 'b' && chunksB.length > 0) rb.local(chunksB.shift() ?? []);
            if (step === 'syncA') await ra.sync(batchSize);
            if (step === 'syncB') await rb.sync(batchSize);
          }
          for (const chunk of chunksA) ra.local(chunk);
          for (const chunk of chunksB) rb.local(chunk);
          for (let round = 0; round < 3; round++) {
            await ra.sync(batchSize);
            await rb.sync(batchSize);
          }
          expect(ra.outbox).toEqual([]);
          expect(rb.outbox).toEqual([]);
          expect(rb.entries()).toEqual(ra.entries());
          expect(serverEntries(h.db, agendaId)).toEqual(ra.entries());
        }),
        { numRuns: NUM_RUNS },
      );
    },
    TIMEOUT,
  );
});
