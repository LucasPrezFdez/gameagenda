import { describe, expect, it } from 'vitest';
import {
  addSample,
  BUDGETS,
  EMPTY_SAMPLES,
  MAX_SAMPLES,
  mergeSamples,
  PANEL_METRICS,
  type PerfSamples,
  parsePerfSamples,
  percentile,
  summarize,
} from './samples.ts';

const NOW = 1_793_620_000_000;

describe('muestras del panel de rendimiento', () => {
  it('guarda las 500 últimas de cada medida, redondeadas a 0,1 ms', () => {
    let samples: PerfSamples = EMPTY_SAMPLES;
    for (let i = 0; i < MAX_SAMPLES + 20; i++) {
      samples = addSample(samples, 'ui:feedback', i + 0.123, NOW + i);
    }
    const list = samples.values['ui:feedback'] ?? [];
    expect(list).toHaveLength(MAX_SAMPLES);
    expect(list[0]).toBe(20.1);
    expect(list.at(-1)).toBe(519.1);
    expect(samples.since).toBe(NOW);
    // Lo que no es una duración no cuenta.
    expect(addSample(samples, 'inp', Number.NaN, NOW)).toBe(samples);
    expect(addSample(samples, 'inp', -1, NOW)).toBe(samples);
  });

  it('percentil por rango más cercano, como `perf`', () => {
    const values = [5, 1, 4, 2, 3, 10, 9, 8, 7, 6];
    expect(percentile(values, 50)).toBe(5);
    expect(percentile(values, 75)).toBe(8);
    expect(percentile(values, 95)).toBe(10);
    expect(percentile([42], 95)).toBe(42);
    expect(percentile([], 50)).toBeNull();
  });

  it('resume cada medida frente a su presupuesto de la §3', () => {
    let samples: PerfSamples = EMPTY_SAMPLES;
    for (const v of [20, 30, 40, 45, 60]) {
      samples = addSample(samples, 'search:keystroke-to-results', v, NOW);
    }
    for (const v of [900, 950]) samples = addSample(samples, 'app:list-visible', v, NOW);
    samples = addSample(samples, 'search:full', 4000, NOW);
    const rows = summarize(samples);
    expect(rows.map((r) => r.metric)).toEqual([...PANEL_METRICS]);
    const byMetric = Object.fromEntries(rows.map((r) => [r.metric, r]));
    expect(byMetric['search:keystroke-to-results']).toMatchObject({
      n: 5,
      p50: 40,
      p95: 60,
      budget: { stat: 'p95', limit: 50 },
      passes: false,
    });
    expect(byMetric['app:list-visible']).toMatchObject({ n: 2, passes: true });
    expect(byMetric['search:full']).toMatchObject({ n: 1, budget: null, passes: null });
    expect(byMetric.inp).toMatchObject({ n: 0, p50: null, passes: null });
    expect(BUDGETS.inp).toEqual({ stat: 'p75', limit: 200 });
    // RNF-04 (reinicio) y RNF-05 (primera visita, con el núcleo de arranque; M3).
    expect(BUDGETS['search:ready']).toEqual({ stat: 'p95', limit: 2000 });
    expect(BUDGETS['search:boot']).toEqual({ stat: 'p95', limit: 1500 });
  });

  it('suma lo guardado y lo de esta sesión, y lee con cuidado lo guardado', () => {
    const stored = parsePerfSamples({
      since: NOW - 1000,
      values: { 'ui:feedback': [10, 'x', 20], otra: [1], inp: 'no' },
    });
    expect(stored).toEqual({ since: NOW - 1000, values: { 'ui:feedback': [10, 20] } });
    const session = addSample(EMPTY_SAMPLES, 'ui:feedback', 30, NOW);
    expect(mergeSamples(stored, session)).toEqual({
      since: NOW - 1000,
      values: { 'ui:feedback': [10, 20, 30] },
    });
    expect(parsePerfSamples(null)).toEqual(EMPTY_SAMPLES);
    expect(parsePerfSamples({ since: 'ayer' })).toEqual(EMPTY_SAMPLES);
  });
});
