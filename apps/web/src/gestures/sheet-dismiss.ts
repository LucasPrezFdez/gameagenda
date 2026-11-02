// ↓ cierra la hoja (§9.4): en el móvil, la paleta abierta ocupa la pantalla; deslizarla hacia
// abajo pasado el 40 % del ancho la cierra, como su botón «Cerrar» o Atrás. Solo empieza con la
// lista de resultados arriba del todo (si no, el dedo la desplaza) y fuera de las zonas muertas
// de los bordes. Va con `touchmove` no pasivo, no con *pointer events*: para quitarle el gesto al
// navegador hay que llamar a `preventDefault()`, y con *pointer events* llegaría `pointercancel`.
// Si el navegador ya había empezado a desplazar, la lista no pasa de su borde
// (`overscroll-behavior: contain`) y la hoja baja igual.
import { inEdgeZone, isArmed, lockAxis } from './gesture-model.ts';
import { vibrate } from './touch.ts';

export interface SheetDismissOptions {
  enabled(): boolean;
  /** La lista que se desplaza dentro de la hoja. */
  scroller(): HTMLElement | null;
  onDismiss(): void;
}

export function attachSheetDismiss(sheet: HTMLElement, options: SheetDismissOptions): () => void {
  let start: { readonly id: number; readonly x: number; readonly y: number } | null = null;
  let width = 0;
  let pulling = false;
  let armed = false;

  function reset(): void {
    start = null;
    armed = false;
    if (!pulling) return;
    pulling = false;
    sheet.classList.remove('is-pulling');
    sheet.style.transform = '';
  }

  function touchOf(event: TouchEvent): Touch | undefined {
    return [...event.changedTouches].find((touch) => touch.identifier === start?.id);
  }

  function onTouchStart(event: TouchEvent): void {
    reset();
    const touch = event.touches[0];
    if (event.touches.length !== 1 || !touch || !options.enabled()) return;
    const scroller = options.scroller();
    if (scroller?.contains(event.target as Node) && scroller.scrollTop > 0) return;
    if (inEdgeZone(touch.clientX, window.innerWidth)) return;
    start = { id: touch.identifier, x: touch.clientX, y: touch.clientY };
    width = sheet.getBoundingClientRect().width;
  }

  function onTouchMove(event: TouchEvent): void {
    const touch = start && touchOf(event);
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (!pulling) {
      // Dentro del margen de un toque no se toca nada: así el toque en un resultado lo apunta.
      const axis = lockAxis(dx, dy);
      if (axis === null) return;
      if (axis !== 'vertical' || dy <= 0) {
        start = null;
        return;
      }
      pulling = true;
      sheet.classList.add('is-pulling');
    }
    if (event.cancelable) event.preventDefault();
    const offset = Math.max(0, dy);
    sheet.style.transform = `translateY(${offset}px)`;
    const now = isArmed(offset, width);
    if (now && !armed) vibrate();
    armed = now;
  }

  function onTouchEnd(event: TouchEvent): void {
    if (!start || !touchOf(event)) return;
    const dismiss = pulling && armed;
    reset();
    if (dismiss) options.onDismiss();
  }

  function onTouchCancel(): void {
    reset();
  }

  sheet.addEventListener('touchstart', onTouchStart, { passive: true });
  sheet.addEventListener('touchmove', onTouchMove, { passive: false });
  sheet.addEventListener('touchend', onTouchEnd);
  sheet.addEventListener('touchcancel', onTouchCancel);
  return () => {
    reset();
    sheet.removeEventListener('touchstart', onTouchStart);
    sheet.removeEventListener('touchmove', onTouchMove);
    sheet.removeEventListener('touchend', onTouchEnd);
    sheet.removeEventListener('touchcancel', onTouchCancel);
  };
}
