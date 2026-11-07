// Propiedad del cliente de la sincronización (M4; CA4.1 de punta a punta): réplicas de la app de
// verdad (Dexie, `outbox`, motor de `src/sync/`) que actúan sin red y sincronizan en cualquier
// orden, con lotes y páginas pequeños, acaban iguales entre sí y con D1, y como aplicar todas las
// operaciones de una vez. Los generadores son los de las propiedades de `merge()` en core.
//
// Las réplicas no tienen agenda en memoria (actúan sobre su almacén, como la agenda), porque cada
// `agenda.whenIdle()` espera un `setTimeout(0)`, ≈15 ms en Windows; la agenda con la
// sincronización se prueba con ejemplos en `sync-client.test.ts`. El reloj del servidor va a 1 s
// de 1970, donde están las HLC de los generadores: así nada se rechaza por reloj ni se purga.

import fc from 'fast-check';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it } from 'vitest';
import { opsArb, runBatches } from '../../../../packages/core/test/arbitraries.ts';
import { sorted } from '../../../../packages/core/test/helpers.ts';
import { createHarness } from './harness.ts';
import { Replica } from './sync-client-support.ts';
import { agendaOf, serverEntries } from './sync-support.ts';

/** ≥200 casos (lo pide el encargo); cada uno abre 2 o 3 IndexedDB y hace decenas de peticiones. */
const NUM_RUNS = 200;
const TIMEOUT = 240_000;

describe('CA4.1 con las réplicas de la app', () => {
  it(
    'réplicas que actúan y sincronizan en cualquier orden acaban iguales entre sí, con D1 y con aplicarlo todo de una vez',
    async () => {
      const h = createHarness({}, { pageSize: 5 });
      h.clock.ms = 1000;
      const step = (complete: boolean) =>
        fc.oneof(
          {
            weight: 3,
            arbitrary: fc.record({
              kind: fc.constant('act' as const),
              who: fc.nat(2),
              ops: opsArb(undefined, 6, complete),
            }),
          },
          {
            weight: 2,
            arbitrary: fc.record({ kind: fc.constant('sync' as const), who: fc.nat(2) }),
          },
        );
      // Con acciones completas (cada Platinado con su Completado, como las escribe la app), además
      // da lo mismo que aplicarlo todo de una vez; con datos incompletos, merge() no lo promete
      // (solo Platinado ⇒ Completado), pero las réplicas convergen igual.
      const scenario = fc.boolean().chain((complete) =>
        fc.record({
          complete: fc.constant(complete),
          replicas: fc.integer({ min: 2, max: 3 }),
          before: fc.array(opsArb(undefined, 4, complete), { maxLength: 2 }),
          steps: fc.array(step(complete), { maxLength: 10 }),
          batchSize: fc.integer({ min: 1, max: 30 }),
        }),
      );
      await fc.assert(
        fc.asyncProperty(scenario, async ({ complete, replicas: n, before, steps, batchSize }) => {
          const rs: Replica[] = [];
          const acted: ReturnType<typeof reId>[] = [];
          try {
            for (let i = 0; i < n; i++)
              rs.push(await Replica.open(h, { withAgenda: false, batchSize }));
            const [a, ...others] = rs as [Replica, ...Replica[]];
            // Lo que había antes de emparejarse también se sube y se fusiona.
            for (const [i, ops] of before.entries()) {
              const r = rs[i % n] as Replica;
              const own = reId(ops);
              acted.push(own);
              await r.act(own);
            }
            await a.activate();
            for (const r of others) await a.pair(r);
            for (const s of steps) {
              const r = rs[s.who % n] as Replica;
              if (s.kind === 'act') {
                const own = reId(s.ops);
                acted.push(own);
                await r.act(own);
              } else {
                await r.syncNow();
              }
            }
            for (let round = 0; round < 2; round++) for (const r of rs) await r.syncNow();
            const reference = await a.stored();
            for (const r of rs) {
              expect(await r.outboxSize()).toBe(0);
              expect(await r.stored()).toEqual(reference);
              expect(r.errors).toEqual([]);
            }
            const deviceId = a.sync.getSnapshot().deviceId ?? '';
            expect(serverEntries(h.db, agendaOf(h.db, deviceId))).toEqual(reference);
            if (complete) {
              expect(reference).toEqual(sorted(runBatches([acted.flat()]).state.values()));
            }
          } finally {
            for (const r of rs) await r.closeTab();
          }
        }),
        { numRuns: NUM_RUNS },
      );
    },
    TIMEOUT,
  );
});

/** Los generadores reutilizan los `opId` entre casos: cada acción lleva los suyos. */
function reId(ops: ReturnType<typeof opsArb> extends fc.Arbitrary<infer T> ? T : never) {
  return ops.map((o) => ({ ...o, opId: uuidv7() }));
}
