// Reordenar Quiero jugar y A continuación arrastrando el asa `::` (RF-15, §9.4), con el ratón, el
// dedo o el lápiz. Las alternativas sin arrastre son `Alt+↑/↓` y «Subir» y «Bajar» en el menú de
// la fila y en la ficha (WCAG 2.5.7). Mientras se arrastra, nada de React: la fila sigue al
// puntero con `transform`, las demás le dejan su hueco, y la página se desplaza sola cerca de los
// bordes. Al soltar, una sola llamada a la agenda (`move` antes o después de otra entrada), con
// su aviso y su Deshacer; `Esc` lo cancela.
import type { FeedbackTiming } from '../perf/measures.ts';
import { autoScrollSpeed, dropIndex, dropTarget, shiftFor } from './gesture-model.ts';
import { isTouchLike, vibrate } from './touch.ts';

export interface DragReorderOptions {
  onDrop(
    id: string,
    to: { readonly before: string } | { readonly after: string },
    timing: FeedbackTiming,
  ): void;
}

/** Hasta aquí es un clic en el asa, no un arrastre. */
const LIFT_PX = 4;

interface Drag {
  readonly pointerId: number;
  readonly handle: HTMLElement;
  readonly row: HTMLElement;
  readonly list: HTMLElement;
  readonly rows: readonly HTMLElement[];
  readonly ids: readonly string[];
  readonly from: number;
  /** Centro de cada fila, en coordenadas del documento, antes de arrastrar. */
  readonly centers: readonly number[];
  /** Alto de la fila arrastrada más la separación: el hueco que dejan las demás. */
  readonly size: number;
  readonly startY: number;
  readonly touch: boolean;
  readonly bounds: { readonly top: number; readonly bottom: number };
  clientY: number;
  to: number;
  lifted: boolean;
  frame: number;
}

/**
 * La parte de la ventana que no tapan la cabecera ni, en el móvil, las barras de abajo
 * (pestañas y captura): ahí empieza el desplazamiento automático.
 */
function visibleBounds(): { top: number; bottom: number } {
  const width = window.innerWidth;
  const height = window.innerHeight;
  let top = 0;
  let bottom = height;
  for (const bar of document.querySelectorAll<HTMLElement>(
    '.app-header, .app-nav, .app-header > .palette',
  )) {
    const rect = bar.getBoundingClientRect();
    // La barra lateral del escritorio no tapa nada por arriba ni por abajo.
    if (rect.height === 0 || rect.width < width / 2) continue;
    if (rect.top <= 0 && rect.bottom < height / 2) top = Math.max(top, rect.bottom);
    else if (rect.top > height / 2) bottom = Math.min(bottom, rect.top);
  }
  return { top, bottom };
}

export function attachDragReorder(container: HTMLElement, options: DragReorderOptions): () => void {
  let drag: Drag | null = null;

  function update(): void {
    const d = drag;
    if (!d) return;
    const dy = d.clientY + window.scrollY - d.startY;
    if (!d.lifted) {
      if (Math.abs(dy) < LIFT_PX) return;
      d.lifted = true;
      d.row.classList.add('is-dragging');
      d.list.classList.add('is-reordering');
      if (d.touch) vibrate();
      d.frame = requestAnimationFrame(autoScroll);
    }
    d.row.style.transform = `translateY(${dy}px)`;
    const to = dropIndex(d.centers, d.from, (d.centers[d.from] ?? 0) + dy);
    if (to === d.to) return;
    d.to = to;
    d.rows.forEach((row, index) => {
      if (index === d.from) return;
      const shift = shiftFor(index, d.from, to, d.size);
      row.style.transform = shift === 0 ? '' : `translateY(${shift}px)`;
    });
  }

  function autoScroll(): void {
    const d = drag;
    if (!d) return;
    const speed = autoScrollSpeed(d.clientY, d.bounds.top, d.bounds.bottom);
    if (speed !== 0) {
      const before = window.scrollY;
      window.scrollBy(0, speed);
      if (window.scrollY !== before) update();
    }
    d.frame = requestAnimationFrame(autoScroll);
  }

  /** Todo a su sitio; con `drop`, se pide el cambio a la agenda. */
  function end(drop: { timeStamp: number } | null): void {
    const d = drag;
    if (!d) return;
    drag = null;
    cancelAnimationFrame(d.frame);
    window.removeEventListener('keydown', onKeyDown, true);
    if (d.handle.hasPointerCapture(d.pointerId)) d.handle.releasePointerCapture(d.pointerId);
    // En el mismo fotograma que el cambio de orden de React: nada salta.
    for (const row of d.rows) row.style.transform = '';
    d.row.classList.remove('is-dragging');
    d.list.classList.remove('is-reordering');
    if (!drop || !d.lifted) return;
    const target = dropTarget(d.ids, d.from, d.to);
    const id = d.ids[d.from];
    if (target && id !== undefined) options.onDrop(id, target, { feedbackStart: drop.timeStamp });
  }

  function onPointerDown(event: PointerEvent): void {
    if (drag || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const handle = (event.target as Element).closest<HTMLElement>('[data-drag-handle]');
    const row = handle?.closest<HTMLElement>('.entry-row[data-entry-id]');
    const list = row?.parentElement;
    if (!handle || !row || !list || !container.contains(list)) return;
    // Ni selección de texto ni cambio de foco con el ratón; con el dedo, `touch-action: none`.
    event.preventDefault();
    const rows = [...list.children].filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child.dataset.entryId !== undefined,
    );
    const from = rows.indexOf(row);
    if (from < 0 || rows.length < 2) return;
    handle.setPointerCapture(event.pointerId);
    const scrollY = window.scrollY;
    const rects = rows.map((element) => element.getBoundingClientRect());
    const first = rects[0];
    const second = rects[1];
    const gap = first && second ? Math.max(0, second.top - first.bottom) : 0;
    drag = {
      pointerId: event.pointerId,
      handle,
      row,
      list,
      rows,
      ids: rows.map((element) => element.dataset.entryId ?? ''),
      from,
      centers: rects.map((rect) => rect.top + scrollY + rect.height / 2),
      size: (rects[from]?.height ?? 0) + gap,
      startY: event.clientY + scrollY,
      touch: isTouchLike(event),
      bounds: visibleBounds(),
      clientY: event.clientY,
      to: from,
      lifted: false,
      frame: 0,
    };
    window.addEventListener('keydown', onKeyDown, true);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.clientY = event.clientY;
    update();
  }

  function onPointerUp(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) return;
    end({ timeStamp: event.timeStamp });
  }

  function onPointerCancel(event: PointerEvent): void {
    if (drag && event.pointerId === drag.pointerId) end(null);
  }

  /** Como al deslizar una fila: si no, Chrome se traga el toque siguiente (ver `row-gestures`). */
  function onTouchMove(event: TouchEvent): void {
    if (drag && event.cancelable) event.preventDefault();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    end(null);
  }

  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', onPointerUp);
  container.addEventListener('pointercancel', onPointerCancel);
  container.addEventListener('lostpointercapture', onPointerCancel);
  container.addEventListener('touchmove', onTouchMove, { passive: false });
  return () => {
    end(null);
    container.removeEventListener('touchmove', onTouchMove);
    container.removeEventListener('pointerdown', onPointerDown);
    container.removeEventListener('pointermove', onPointerMove);
    container.removeEventListener('pointerup', onPointerUp);
    container.removeEventListener('pointercancel', onPointerCancel);
    container.removeEventListener('lostpointercapture', onPointerCancel);
  };
}
