// Lo que comparten los gestos de la §9.4 en el DOM: quién cuenta como dedo, la vibración y el
// clic que llega al soltar un gesto (no debe abrir la ficha ni pulsar un botón).
import { HAPTIC_MS } from './gesture-model.ts';

/** Deslizar y mantener pulsado son del dedo y del lápiz: con el ratón ya están los botones. */
export function isTouchLike(event: PointerEvent): boolean {
  return event.pointerType === 'touch' || event.pointerType === 'pen';
}

/** 10 ms de vibración donde la hay (Android); en iOS y en el PC no hace nada. */
export function vibrate(): void {
  try {
    navigator.vibrate?.(HAPTIC_MS);
  } catch {
    // Sin permiso o sin activación del usuario: no pasa nada.
  }
}

/** Cuánto se descarta el clic después de un gesto. */
const CLICK_GUARD_MS = 400;

/**
 * Descarta en `container` el clic que el navegador manda al soltar un gesto (en la fase de
 * captura, antes que React). `guard()` lo arma para los próximos 400 ms. Lo que está dentro de
 * `exempt` (p. ej., la bandeja que acaba de abrir el gesto) no se descarta nunca: ese clic no
 * puede venir del gesto, que empezó en otro sitio.
 */
export function createClickGuard(
  container: HTMLElement,
  exempt?: string,
): {
  guard(): void;
  dispose(): void;
} {
  let until = 0;
  const onClick = (event: MouseEvent) => {
    if (performance.now() > until) return;
    if (exempt && event.target instanceof Element && event.target.closest(exempt)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  container.addEventListener('click', onClick, true);
  return {
    guard() {
      until = performance.now() + CLICK_GUARD_MS;
    },
    dispose() {
      container.removeEventListener('click', onClick, true);
    },
  };
}
