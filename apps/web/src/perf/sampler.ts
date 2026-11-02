// Recoge las muestras del panel de rendimiento (ver `samples.ts`) mientras se usa la app, con
// `PerformanceObserver`: las medidas de la app (`measure`), el INP (Event Timing: la entrada más
// lenta de cada interacción, por `interactionId`) y el LCP (el último antes de la primera tecla o
// toque). Donde el navegador no da un tipo (Safari no tiene Event Timing), esa medida no tiene
// muestras. Se guarda en segundo plano, 2 s después del último cambio y al ocultar la página.
import {
  addSample,
  EMPTY_SAMPLES,
  isPanelMetric,
  mergeSamples,
  type PanelMetric,
  type PerfSamples,
} from './samples.ts';

export interface PerfSamplesStorage {
  load(): Promise<PerfSamples>;
  save(samples: PerfSamples): void;
  clear(): Promise<void>;
}

export interface PerfSampler {
  /** Lo guardado más lo de esta sesión. */
  getSnapshot(): PerfSamples;
  subscribe(listener: () => void): () => void;
  /** «Borrar las medidas». */
  clear(): Promise<void>;
}

const SAVE_DELAY_MS = 2000;
/** Las entradas de una interacción llegan juntas: se espera un poco antes de cerrarla. */
const INTERACTION_FLUSH_MS = 1000;

function supports(type: string): boolean {
  return (
    typeof PerformanceObserver !== 'undefined' &&
    (PerformanceObserver.supportedEntryTypes ?? []).includes(type)
  );
}

export function startPerfSampler(
  storage: PerfSamplesStorage | null,
  now: () => number = Date.now,
): PerfSampler {
  let stored: PerfSamples = EMPTY_SAMPLES;
  let session: PerfSamples = EMPTY_SAMPLES;
  let snapshot: PerfSamples = EMPTY_SAMPLES;
  let loaded = storage === null;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  function save(): void {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    if (storage && loaded && session.since !== null) storage.save(snapshot);
  }

  function changed(): void {
    snapshot = mergeSamples(stored, session);
    for (const listener of listeners) listener();
    if (!storage || !loaded) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DELAY_MS);
  }

  function add(metric: PanelMetric, value: number): void {
    session = addSample(session, metric, value, now());
  }

  if (supports('measure')) {
    new PerformanceObserver((list) => {
      let any = false;
      for (const entry of list.getEntries()) {
        if (!isPanelMetric(entry.name)) continue;
        add(entry.name, entry.duration);
        any = true;
      }
      if (any) changed();
    }).observe({ type: 'measure', buffered: true });
  }

  if (supports('event')) {
    const pending = new Map<number, number>();
    let flush: ReturnType<typeof setTimeout> | undefined;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceEventTiming[]) {
        if (!entry.interactionId) continue;
        pending.set(
          entry.interactionId,
          Math.max(pending.get(entry.interactionId) ?? 0, entry.duration),
        );
      }
      clearTimeout(flush);
      flush = setTimeout(() => {
        for (const duration of pending.values()) add('inp', duration);
        pending.clear();
        changed();
      }, INTERACTION_FLUSH_MS);
    }).observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
  }

  if (supports('largest-contentful-paint')) {
    let lcp: number | null = null;
    let done = false;
    const observer = new PerformanceObserver((list) => {
      const last = list.getEntries().at(-1);
      if (last && !done) lcp = last.startTime;
    });
    observer.observe({ type: 'largest-contentful-paint', buffered: true });
    const finish = (): void => {
      if (done) return;
      done = true;
      observer.disconnect();
      removeEventListener('keydown', finish, true);
      removeEventListener('pointerdown', finish, true);
      if (lcp !== null) {
        add('lcp', lcp);
        changed();
      }
    };
    addEventListener('keydown', finish, true);
    addEventListener('pointerdown', finish, true);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') finish();
    });
  }

  // Al ocultar la página (cambiar de app, cerrar la pestaña), lo pendiente se guarda ya.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') save();
  });

  storage
    ?.load()
    .catch(() => EMPTY_SAMPLES)
    .then((older) => {
      stored = older;
      loaded = true;
      changed();
    });

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async clear() {
      clearTimeout(saveTimer);
      stored = EMPTY_SAMPLES;
      session = EMPTY_SAMPLES;
      snapshot = EMPTY_SAMPLES;
      for (const listener of listeners) listener();
      await storage?.clear();
    },
  };
}
