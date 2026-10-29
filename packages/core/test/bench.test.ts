// Conjunto realista para la página de prueba de `perf` (§8.11, §12.4): debe ser el mismo que el
// de las puertas de calidad (`helpers/frozen.ts`), con el que se midió el prototipo.

import { describe, expect, it } from 'vitest';
import {
  latencyStats,
  mulberry32,
  REALISTIC_SEED,
  realisticFinals,
  typedSequences,
} from '../src/bench/index.ts';
import { parseCore } from '../src/catalog-format/index.ts';
import * as frozen from './helpers/frozen.ts';

describe('bench: conjunto realista', () => {
  it('mulberry32 da la misma secuencia que el banco de pruebas', () => {
    const a = mulberry32(REALISTIC_SEED);
    const b = frozen.mulberry32(20261028);
    for (let i = 0; i < 1000; i++) expect(a()).toBe(b());
  });

  it('sobre el núcleo congelado, los mismos 150 nombres y las mismas 2 084 pulsaciones', () => {
    const names = parseCore(frozen.readFrozen().core).name;
    const finals = realisticFinals(names);
    expect(finals).toEqual(frozen.realisticFinals(names));
    expect(finals).toHaveLength(150);
    expect(finals.every((f) => Array.from(f).length <= 25)).toBe(true);
    const seqs = typedSequences(finals);
    expect(seqs).toEqual(frozen.typedSequences(finals));
    // Las 2 084 pulsaciones de la §8.11.
    expect(seqs.reduce((n, s) => n + s.length, 0)).toBe(2084);
  });

  it('typedSequences omite los prefijos que normalizan igual', () => {
    expect(typedSequences(['Hades II'])).toEqual([
      ['H', 'Ha', 'Had', 'Hade', 'Hades', 'Hades I', 'Hades II'],
    ]);
    expect(typedSequences(['a  b'])[0]).toEqual(['a', 'a  b']);
  });

  it('latencyStats usa el rango más cercano', () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(latencyStats(samples)).toEqual({ n: 100, p50: 50, p95: 95, max: 100 });
    expect(latencyStats([])).toEqual({ n: 0, p50: 0, p95: 0, max: 0 });
    expect(latencyStats([3, 1, 2])).toMatchObject({ p50: 2, p95: 3, max: 3 });
  });
});
