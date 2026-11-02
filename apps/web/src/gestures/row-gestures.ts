// Gestos de las filas de Mi lista (§9.4): deslizar a la derecha avanza el estado, a la izquierda
// muestra las marcas, y mantener pulsado abre el selector de estado. Solo con el dedo o el lápiz.
// Un juego de escuchas en el contenedor de la lista, no uno por fila, y nada de React mientras se
// mueve el dedo: se desplaza `.entry-row__body` con `transform`, y detrás asoma el fondo de la
// fila con lo que va a pasar (`data-swipe` y `data-swipe-label`; ver `list.css`). En vertical,
// el navegador desplaza la lista como siempre (`touch-action: pan-y pinch-zoom`).
import type { Status } from '../agenda/types.ts';
import type { FeedbackTiming } from '../perf/measures.ts';
import { advanceStatus, createSwipe, inEdgeZone, type Swipe } from './gesture-model.ts';
import { attachLongPress } from './long-press.ts';
import { createClickGuard, isTouchLike, vibrate } from './touch.ts';

export interface RowGestureOptions {
  /** Ajustes › Teclado y gestos › «Gestos táctiles». */
  enabled(): boolean;
  /** Lo que se lee detrás de la fila al deslizarla a la derecha, p. ej. «Empezar». */
  advanceLabel(from: Status): string;
  /** Lo que se lee al deslizarla a la izquierda. */
  readonly flagsLabel: string;
  onAdvance(id: string, status: Status, timing: FeedbackTiming): void;
  onRevealFlags(id: string): void;
  onLongPress(id: string, row: HTMLElement): void;
}

const ROW = '.entry-row[data-entry-id]';
/** Ni el asa `::` (arrastra), ni la bandeja de marcas, ni un menú abierto. */
const NOT_A_GESTURE = '[data-drag-handle], .entry-row__tray, [role="menu"]';
/** Lo que tarda la fila en volver a su sitio (`--motion` y un poco más). */
const SETTLE_MS = 220;

interface ActiveSwipe {
  readonly pointerId: number;
  readonly row: HTMLElement;
  readonly body: HTMLElement;
  readonly id: string;
  readonly next: Status | null;
  readonly swipe: Swipe;
  swiping: boolean;
}

export function attachRowGestures(container: HTMLElement, options: RowGestureOptions): () => void {
  const clicks = createClickGuard(container, '.entry-row__tray');
  const settling = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();
  let active: ActiveSwipe | null = null;

  const longPress = attachLongPress(container, {
    selector: ROW,
    ignore: NOT_A_GESTURE,
    exemptClicks: '[role="menu"]',
    enabled: options.enabled,
    onLongPress(row) {
      if (active?.row === row) active = null;
      const id = row.dataset.entryId;
      if (id !== undefined) options.onLongPress(id, row);
    },
  });

  function clearSwipeLook(row: HTMLElement): void {
    delete row.dataset.swipe;
    delete row.dataset.swipeLabel;
    delete row.dataset.armed;
  }

  /** La fila vuelve a su sitio (o a la bandeja abierta) con la transición de la hoja de estilos. */
  function settle(current: ActiveSwipe): void {
    const { row, body } = current;
    row.classList.remove('is-swiping');
    body.style.transform = '';
    // El fondo sigue a la vista mientras vuelve.
    settling.set(
      row,
      setTimeout(() => clearSwipeLook(row), SETTLE_MS),
    );
  }

  function onPointerDown(event: PointerEvent): void {
    if (active || !event.isPrimary || !isTouchLike(event) || !options.enabled()) return;
    const origin = event.target as Element;
    if (origin.closest(NOT_A_GESTURE)) return;
    const row = origin.closest<HTMLElement>(ROW);
    const body = row?.querySelector<HTMLElement>(':scope > .entry-row__body');
    const id = row?.dataset.entryId;
    const status = row?.dataset.status as Status | undefined;
    // Con la bandeja abierta, el toque la cierra (lo hace la pantalla).
    if (!row || !body || id === undefined || !status || row.classList.contains('is-tray-open')) {
      return;
    }
    // Junto a los bordes, el gesto «atrás» del sistema.
    if (inEdgeZone(event.clientX, window.innerWidth)) return;
    clearTimeout(settling.get(row));
    clearSwipeLook(row);
    const next = advanceStatus(status);
    active = {
      pointerId: event.pointerId,
      row,
      body,
      id,
      next,
      swipe: createSwipe(event.clientX, event.clientY, {
        width: row.getBoundingClientRect().width,
        canAdvance: next !== null,
      }),
      swiping: false,
    };
  }

  function onPointerMove(event: PointerEvent): void {
    const current = active;
    if (!current || event.pointerId !== current.pointerId) return;
    const frame = current.swipe.move(event.clientX, event.clientY);
    if (frame.phase === 'pending') return;
    if (frame.phase === 'ignored') {
      active = null;
      return;
    }
    const { row, body } = current;
    if (!current.swiping) {
      current.swiping = true;
      longPress.cancel();
      row.classList.add('is-swiping');
    }
    if (frame.side !== null && row.dataset.swipe !== frame.side) {
      row.dataset.swipe = frame.side;
      row.dataset.swipeLabel =
        frame.side === 'flags'
          ? options.flagsLabel
          : current.next
            ? options.advanceLabel(row.dataset.status as Status)
            : '';
    }
    row.toggleAttribute('data-armed', frame.armed);
    body.style.transform = `translateX(${frame.offset}px)`;
    if (frame.justArmed) vibrate();
  }

  function onPointerUp(event: PointerEvent): void {
    const current = active;
    if (!current || event.pointerId !== current.pointerId) return;
    active = null;
    if (!current.swiping) return;
    clicks.guard();
    const side = current.swipe.end();
    settle(current);
    if (side === 'advance' && current.next !== null) {
      options.onAdvance(current.id, current.next, { feedbackStart: event.timeStamp });
    } else if (side === 'flags') {
      options.onRevealFlags(current.id);
    }
  }

  function onPointerCancel(event: PointerEvent): void {
    const current = active;
    if (!current || event.pointerId !== current.pointerId) return;
    active = null;
    if (current.swiping) settle(current);
  }

  /**
   * Con el deslizamiento ya en marcha, el `touchmove` (que llega tras su `pointermove`) no es del
   * navegador. Sin esto, Chrome trata el gesto como un desplazamiento lanzado y se traga el
   * siguiente toque, que es el de la bandeja.
   */
  function onTouchMove(event: TouchEvent): void {
    if (active?.swiping && event.cancelable) event.preventDefault();
  }

  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', onPointerUp);
  container.addEventListener('pointercancel', onPointerCancel);
  container.addEventListener('touchmove', onTouchMove, { passive: false });
  return () => {
    container.removeEventListener('touchmove', onTouchMove);
    longPress.dispose();
    clicks.dispose();
    container.removeEventListener('pointerdown', onPointerDown);
    container.removeEventListener('pointermove', onPointerMove);
    container.removeEventListener('pointerup', onPointerUp);
    container.removeEventListener('pointercancel', onPointerCancel);
  };
}
