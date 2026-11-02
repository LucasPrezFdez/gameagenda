// Muestras del panel de rendimiento (Ajustes › Rendimiento, M3; §12.4 y §12.7), sin DOM: las
// medidas de la §12.4 que hace la app con `performance.measure`, el INP y el LCP, con las 500
// últimas de cada una y sus p50, p75 y p95 frente a los presupuestos de la §3. Se guardan en
// `meta.perfSamples` para sumar sesiones (cada reinicio da una sola muestra de arranque). No sale
// nada del dispositivo: el informe se copia a mano.

export const PANEL_METRICS = [
  'search:keystroke-to-results',
  'ui:feedback',
  'capture:palette-to-confirm',
  'inp',
  'lcp',
  'app:list-visible',
  'search:ready',
  'search:full',
  'search:index-restored',
] as const;
export type PanelMetric = (typeof PANEL_METRICS)[number];

/** Muestras por medida, como mucho. */
export const MAX_SAMPLES = 500;

export type Stat = 'p50' | 'p75' | 'p95';

export interface Budget {
  readonly stat: Stat;
  readonly limit: number;
}

/**
 * Presupuestos de la §3 en el móvil, que es para lo que está el panel (CA3.1): RNF-01 (apuntar),
 * RNF-02 (tecla → resultados; en escritorio, ≤2 fotogramas), RNF-03 (toque → respuesta e INP) y
 * RNF-04 (LCP, Mi lista y poder buscar tras un reinicio). El resto solo informa.
 */
export const BUDGETS: Readonly<Record<PanelMetric, Budget | null>> = {
  'search:keystroke-to-results': { stat: 'p95', limit: 50 },
  'ui:feedback': { stat: 'p95', limit: 100 },
  'capture:palette-to-confirm': { stat: 'p50', limit: 3000 },
  inp: { stat: 'p75', limit: 200 },
  lcp: { stat: 'p75', limit: 2500 },
  'app:list-visible': { stat: 'p95', limit: 1000 },
  'search:ready': { stat: 'p95', limit: 2000 },
  'search:full': null,
  'search:index-restored': null,
};

export interface PerfSamples {
  /** Desde cuándo hay muestras (ms desde 1970), o `null` si no hay ninguna. */
  readonly since: number | null;
  readonly values: Readonly<Partial<Record<PanelMetric, readonly number[]>>>;
}

export const EMPTY_SAMPLES: PerfSamples = { since: null, values: {} };

export function isPanelMetric(name: string): name is PanelMetric {
  return (PANEL_METRICS as readonly string[]).includes(name);
}

/** Añade una muestra (redondeada a 0,1 ms); si pasa de 500, se va la más antigua. */
export function addSample(
  samples: PerfSamples,
  metric: PanelMetric,
  value: number,
  now: number,
): PerfSamples {
  if (!Number.isFinite(value) || value < 0) return samples;
  const list = [...(samples.values[metric] ?? []), Math.round(value * 10) / 10];
  if (list.length > MAX_SAMPLES) list.splice(0, list.length - MAX_SAMPLES);
  return { since: samples.since ?? now, values: { ...samples.values, [metric]: list } };
}

/** Las de `older` (guardadas) y después las de `newer` (de esta sesión), con el mismo límite. */
export function mergeSamples(older: PerfSamples, newer: PerfSamples): PerfSamples {
  const values: Partial<Record<PanelMetric, number[]>> = {};
  for (const metric of PANEL_METRICS) {
    const list = [...(older.values[metric] ?? []), ...(newer.values[metric] ?? [])];
    if (list.length > 0) values[metric] = list.slice(-MAX_SAMPLES);
  }
  const starts = [older.since, newer.since].filter((t): t is number => t !== null);
  return { since: starts.length > 0 ? Math.min(...starts) : null, values };
}

/** Lo guardado, si tiene la forma esperada; si no, vacío. */
export function parsePerfSamples(value: unknown): PerfSamples {
  if (typeof value !== 'object' || value === null) return EMPTY_SAMPLES;
  const { since, values } = value as { since?: unknown; values?: unknown };
  const out: Partial<Record<PanelMetric, number[]>> = {};
  if (typeof values === 'object' && values !== null) {
    for (const metric of PANEL_METRICS) {
      const list = (values as Record<string, unknown>)[metric];
      if (!Array.isArray(list)) continue;
      const numbers = list.filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
      if (numbers.length > 0) out[metric] = numbers.slice(-MAX_SAMPLES);
    }
  }
  return {
    since: typeof since === 'number' && Number.isFinite(since) ? since : null,
    values: out,
  };
}

/** Percentil por rango más cercano (el de `perf`), o `null` sin muestras. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1] ?? null;
}

export interface MetricSummary {
  readonly metric: PanelMetric;
  readonly n: number;
  readonly p50: number | null;
  readonly p75: number | null;
  readonly p95: number | null;
  readonly budget: Budget | null;
  /** `null` sin presupuesto o sin muestras. */
  readonly passes: boolean | null;
}

export function summarize(samples: PerfSamples): MetricSummary[] {
  return PANEL_METRICS.map((metric) => {
    const values = samples.values[metric] ?? [];
    const stats = {
      p50: percentile(values, 50),
      p75: percentile(values, 75),
      p95: percentile(values, 95),
    };
    const budget = BUDGETS[metric];
    const value = budget ? stats[budget.stat] : null;
    return {
      metric,
      n: values.length,
      ...stats,
      budget,
      passes: budget && value !== null ? value <= budget.limit : null,
    };
  });
}
