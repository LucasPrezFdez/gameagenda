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
  /**
   * Primera visita con la caché vacía (RNF-05, M3): de `init` a `boot` (`null` si el catálogo no
   * trae núcleo de arranque), a `scan` y a `full`, en ms. Deja el catálogo en Cache Storage.
   */
  firstVisit(): Promise<{
    hasBoot: boolean;
    bootMs: number | null;
    scanMs: number;
    fullMs: number;
  }>;
  prime(): Promise<{ version: string; count: number }>;
  restart(hold: 'scan' | null): Promise<{ scanMs: number; fullMs: number | null }>;
  release(): Promise<{ fullMs: number }>;
  /**
   * Cache Storage + sha256, lectura del TSV, recientes (leer `recent` y `applyRecent`) y claves
   * hasta `scan`, sin ceder el turno.
   */
  breakdown(): Promise<{ cacheMs: number; readMs: number; recentMs: number; keysMs: number }>;
  type(options: { fuzzy: boolean }): Promise<TypingReport>;
  /** Construye el índice sin estrangular y lo guarda en `meta.searchIndex` (M3). */
  persist(): Promise<{ fullMs: number; persistMs: number; megabytes: number }>;
  /**
   * Reinicio con caché y el índice guardado (CA3.2): de `init` a la primera consulta respondida,
   * y lo que tarda el host en restaurarlo (mensaje `restored`).
   */
  restoreIndex(): Promise<{ readyMs: number; restoredMs: number; firstQueryMs: number }>;
  /** El mismo camino por fases: Cache Storage, IndexedDB, restaurar y la primera consulta. */
  restoreBreakdown(): Promise<{
    cacheMs: number;
    idbMs: number;
    restoreMs: number;
    queryMs: number;
  }>;
}

declare global {
  var gaPerfBench: BenchApi | undefined;
}
