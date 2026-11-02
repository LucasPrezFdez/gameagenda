// Mantener pulsado (§9.4): 500 ms sin moverse más de 10 px, con el dedo o el lápiz. En Mi lista
// abre el selector de estado y en la paleta, «Apuntar como…» (RF-06, como Alt+Intro). Al
// soltar no llega el clic, y Android no saca su menú de enlace (`contextmenu`); el de iOS lo
// quita `-webkit-touch-callout: none` en la hoja de estilos.
import { LONG_PRESS_MS, lockAxis } from './gesture-model.ts';
import { createClickGuard, isTouchLike, vibrate } from './touch.ts';

export interface LongPressOptions {
  /** Lo que se puede mantener pulsado: el más cercano al dedo. */
  readonly selector: string;
  /** Dentro de esto, no (p. ej., el asa `::` o un menú abierto). */
  readonly ignore?: string;
  /**
   * Lo que abre la pulsación y se puede tocar enseguida (p. ej., el menú de estado): sus clics no
   * se descartan. El que manda el navegador al soltar va a lo que se pulsó, no ahí.
   */
  readonly exemptClicks?: string;
  enabled(): boolean;
  onLongPress(target: HTMLElement, timeStamp: number): void;
}

export interface LongPress {
  /** Otro gesto (deslizar) se queda con el dedo: ya no hay pulsación larga. */
  cancel(): void;
  dispose(): void;
}

export function attachLongPress(container: HTMLElement, options: LongPressOptions): LongPress {
  const clicks = createClickGuard(container, options.exemptClicks);
  let press: {
    readonly pointerId: number;
    readonly x: number;
    readonly y: number;
    readonly timer: ReturnType<typeof setTimeout>;
    fired: boolean;
  } | null = null;

  function cancel(): void {
    if (press) clearTimeout(press.timer);
    press = null;
  }

  function onPointerDown(event: PointerEvent): void {
    cancel();
    if (!event.isPrimary || !isTouchLike(event) || !options.enabled()) return;
    const origin = event.target as Element;
    if (options.ignore && origin.closest(options.ignore)) return;
    const target = origin.closest<HTMLElement>(options.selector);
    if (!target || !container.contains(target)) return;
    const timer = setTimeout(() => {
      if (!press || !target.isConnected) return;
      press.fired = true;
      vibrate();
      options.onLongPress(target, performance.now());
      // Después: `onLongPress` puede pulsar un botón con `click()` (el selector de estado).
      clicks.guard();
    }, LONG_PRESS_MS);
    press = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, timer, fired: false };
  }

  function onPointerMove(event: PointerEvent): void {
    if (!press || press.fired || event.pointerId !== press.pointerId) return;
    if (lockAxis(event.clientX - press.x, event.clientY - press.y) !== null) cancel();
  }

  function onPointerEnd(event: PointerEvent): void {
    if (!press || event.pointerId !== press.pointerId) return;
    // El clic llega después de `pointerup`: se descarta también el de una pulsación larga.
    if (press.fired) clicks.guard();
    cancel();
  }

  function onContextMenu(event: Event): void {
    if (press) event.preventDefault();
  }

  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', onPointerEnd);
  container.addEventListener('pointercancel', onPointerEnd);
  container.addEventListener('contextmenu', onContextMenu);
  return {
    cancel,
    dispose() {
      cancel();
      clicks.dispose();
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerEnd);
      container.removeEventListener('pointercancel', onPointerEnd);
      container.removeEventListener('contextmenu', onContextMenu);
    },
  };
}
