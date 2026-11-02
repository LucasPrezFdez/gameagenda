// `meta.perfSamples` (panel de rendimiento, M3): las muestras de este dispositivo. Si guardarlas
// falla, solo se anota en el registro de errores: no es la agenda.
import type { PerfSamplesStorage } from '../perf/sampler.ts';
import { parsePerfSamples } from '../perf/samples.ts';
import { type GameAgendaDb, META_KEYS } from './database.ts';

export function createDexiePerfSamplesStorage(
  db: GameAgendaDb,
  onError: (error: unknown) => void,
): PerfSamplesStorage {
  return {
    async load() {
      return parsePerfSamples((await db.meta.get(META_KEYS.perfSamples))?.value);
    },
    save(samples) {
      db.meta.put({ key: META_KEYS.perfSamples, value: samples }).catch(onError);
    },
    async clear() {
      await db.meta.delete(META_KEYS.perfSamples);
    },
  };
}
