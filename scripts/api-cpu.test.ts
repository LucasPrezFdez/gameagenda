// `scripts/api-cpu.ts` no se ejecuta en el CI (son ≈20 s de medidas), y se rompió sin que nadie lo
// viera: desde el 19-11-2026, el arnés bajaba el tope de `redeem` a 1 MiB y el escenario de Steam
// manda 1,7 MB. Esto pasa una vez por cada escenario, sin medir, para que no vuelva a pasar.
import { describe, expect, it } from 'vitest';
import { harness, measure, SCENARIOS } from './api-cpu.ts';

describe('api-cpu', () => {
  it.each(SCENARIOS.map((s) => [s.name, s] as const))(
    'el escenario %s responde bien',
    async (_, scenario) => {
      const { h, db } = harness();
      const call = await scenario.setup(h);
      // `measure` lanza un error si la respuesta es 400 o más.
      expect(await measure(db, call)).toBeGreaterThanOrEqual(0);
    },
  );
});
