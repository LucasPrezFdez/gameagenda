// API de la página de prueba (`perf/bench/bench.ts`) que usa `perf/search.perf.ts`.
import type { LatencyStats } from '@gameagenda/core/bench';

export interface TypingReport {
  /** Estado del buscador mientras se teclea. */
  readonly state: string;
  /** Pulsación → `results`, en ms. */
  readonly keystrokes: LatencyStats;
  readonly over16: number;
  readonly over50: number;
  /** Nivel 4 entero (todos sus bloques), en ms; `n` = 0 si no se pidió. */
  readonly suggest: LatencyStats;
}

export interface BenchApi {
  readonly marker: string;
  prime(): Promise<{ version: string; count: number }>;
  restart(hold: 'scan' | null): Promise<{ scanMs: number; fullMs: number | null }>;
  release(): Promise<{ fullMs: number }>;
  /**
   * Cache Storage + sha256, lectura del TSV, recientes (leer `recent` y `applyRecent`) y claves
   * hasta `scan`, sin ceder el turno.
   */
  breakdown(): Promise<{ cacheMs: number; readMs: number; recentMs: number; keysMs: number }>;
  type(options: { fuzzy: boolean }): Promise<TypingReport>;
}

declare global {
  var gaPerfBench: BenchApi | undefined;
}
