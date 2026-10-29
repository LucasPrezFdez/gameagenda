// Medidas de la §12.4 con `performance.measure`. «Fotograma» es el `requestAnimationFrame` tras
// el *commit* de React: quien llama lo hace desde un efecto de *layout* ya confirmado.

export type MeasureName =
  | 'ui:feedback'
  | 'capture:palette-to-confirm'
  | 'search:keystroke-to-results'
  | 'search:ready'
  | 'search:full'
  | 'app:list-visible';

/** Mide desde el inicio de la navegación hasta ahora (`search:ready`, `search:full`). */
export function measureSinceNavigation(name: MeasureName): void {
  try {
    performance.measure(name, { start: 0, end: performance.now() });
  } catch {
    // Sin `performance.measure` con opciones: la medida se descarta.
  }
}

/** Mide desde `start` (un `event.timeStamp` o `performance.now()`) hasta el próximo fotograma. */
export function measureToNextFrame(name: MeasureName, start: number): void {
  requestAnimationFrame(() => {
    try {
      performance.measure(name, { start, end: performance.now() });
    } catch {
      // `start` fuera de rango (p. ej., de otra navegación): la medida se descarta.
    }
  });
}

// `app:list-visible` solo vale en el primer *commit* de la app (al abrirla o recargarla), no al
// volver a Mi lista desde otra pantalla: `App` cierra la ventana en su efecto de *layout*, que
// React ejecuta después de los de sus hijos.
let firstCommit = true;

/** `app:list-visible`: del inicio de la navegación al fotograma con Mi lista y sus datos. */
export function measureListVisible(): void {
  if (firstCommit) measureToNextFrame('app:list-visible', 0);
}

/** Lo llama `App` tras su primer *commit*. */
export function endFirstCommit(): void {
  firstCommit = false;
}

/** Momentos de inicio que acompañan a una acción hasta que se pinta su confirmación. */
export interface FeedbackTiming {
  /** Evento que actúa: Intro, `pointerup`, clic… */
  readonly feedbackStart: number;
  /** Apertura de la paleta, solo para lo que se apunta desde ella. */
  readonly captureStart?: number;
}

export function measureFeedback(timing: FeedbackTiming): void {
  measureToNextFrame('ui:feedback', timing.feedbackStart);
  if (timing.captureStart !== undefined) {
    measureToNextFrame('capture:palette-to-confirm', timing.captureStart);
  }
}
