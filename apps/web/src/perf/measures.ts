// Medidas de la §12.4 con `performance.measure`. «Fotograma» es el `requestAnimationFrame` tras
// el *commit* de React: quien llama lo hace desde un efecto de *layout* ya confirmado.

export type MeasureName =
  | 'ui:feedback'
  | 'capture:palette-to-confirm'
  | 'search:keystroke-to-results';

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
