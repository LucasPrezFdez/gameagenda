// Movimiento de Mi lista (pulido visual, DECISIONES §10.44).
//
// «Deslizar»: cuando un cambio de la agenda recoloca las filas (un juego pasa a otra sección o
// cambia de prioridad), cada fila recorre la diferencia hasta su sitio nuevo en vez de saltar
// (FLIP: se mide antes y después, y se anima con `transform`). «Destello»: la fila de un juego
// recién apuntado nace teñida del color de su estado y se apaga.
//
// Solo con cambios de la agenda y con los mismos filtros, vista y orden: filtrar, ordenar y
// cambiar de vista siguen siendo instantáneos. Se miden nada más que las filas cercanas a la
// pantalla, y el «antes» se toma en el aviso de la agenda, con la maquetación ya hecha, así que no
// fuerza ninguna. No bloquea nada: las filas responden mientras se mueven.
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { AgendaEntry, AgendaStore } from '../../agenda/types.ts';
import { EASE, motionMs } from '../../lib/motion.ts';

/** Lo que se mide por encima y por debajo de la pantalla. */
const MARGIN_PX = 600;
/** Más filas moviéndose a la vez no explican nada: se deja saltar. */
const MAX_MOVING = 80;
/** Un alta suelta (o un Deshacer) destella; una importación, no. */
const MAX_NEW = 3;
const FLASH_MS = 1400;

interface Before {
  readonly layoutKey: string;
  readonly scrollY: number;
  readonly rects: ReadonlyMap<string, { readonly left: number; readonly top: number }>;
}

function keyOf(element: HTMLElement): string | null {
  const id = element.dataset.entryId;
  if (id !== undefined) return `row:${id}`;
  const heading = element.querySelector('h2')?.id;
  return heading ? `head:${heading}` : null;
}

/** Filas y cabeceras cercanas a la pantalla, con su sitio. Van en orden de arriba abajo. */
function measure(
  container: HTMLElement,
): Map<string, { el: HTMLElement; left: number; top: number }> {
  const all = container.querySelectorAll<HTMLElement>('.entry-row, .list-section__header');
  const found = new Map<string, { el: HTMLElement; left: number; top: number }>();
  // Búsqueda binaria de la primera que asoma: con cientos de filas se leen unas pocas cajas.
  let low = 0;
  let high = all.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const element = all[middle];
    if (element && element.getBoundingClientRect().bottom < -MARGIN_PX) low = middle + 1;
    else high = middle;
  }
  const limit = window.innerHeight + MARGIN_PX;
  for (let i = low; i < all.length; i += 1) {
    const element = all[i];
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    if (rect.top > limit) break;
    const key = keyOf(element);
    if (key !== null) found.set(key, { el: element, left: rect.left, top: rect.top });
  }
  return found;
}

export interface ListMotion {
  /** El próximo cambio no se anima: soltar una fila arrastrada ya la deja en su sitio. */
  readonly skipNext: () => void;
}

export function useListMotion(
  container: RefObject<HTMLElement | null>,
  agenda: AgendaStore,
  entries: readonly AgendaEntry[],
  /** Vista, filtros y orden: si cambian a la vez que la agenda, no se anima. */
  layoutKey: string,
): ListMotion {
  const before = useRef<Before | null>(null);
  const skip = useRef(false);
  const known = useRef<ReadonlyMap<string, string> | null>(null);
  const currentKey = useRef(layoutKey);
  currentKey.current = layoutKey;

  // El «antes»: al avisar la agenda, React aún no ha repintado.
  useEffect(
    () =>
      agenda.subscribe(() => {
        const element = container.current;
        if (before.current || !element || skip.current || motionMs() === 0) return;
        const rects = new Map<string, { left: number; top: number }>();
        for (const [key, { left, top }] of measure(element)) rects.set(key, { left, top });
        before.current = { layoutKey: currentKey.current, scrollY: window.scrollY, rects };
      }),
    [agenda, container],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: `layoutKey` cambia sin `entries` y entonces solo hay que tirar el «antes».
  useLayoutEffect(() => {
    const previous = known.current;
    const snapshot = before.current;
    const skipped = skip.current;
    known.current = new Map(entries.map((entry) => [entry.id, entry.lastHlc]));
    before.current = null;
    skip.current = false;
    const element = container.current;
    const ms = motionMs();
    if (!previous || !element || ms === 0) return;

    const added: string[] = [];
    const changed = new Set<string>();
    for (const entry of entries) {
      const hlc = previous.get(entry.id);
      if (hlc === undefined) added.push(entry.id);
      else if (hlc !== entry.lastHlc) changed.add(entry.id);
    }

    if (snapshot && !skipped && snapshot.layoutKey === layoutKey) {
      const scrolled = window.scrollY - snapshot.scrollY;
      const moves: { el: HTMLElement; dx: number; dy: number; key: string }[] = [];
      for (const [key, now] of measure(element)) {
        const was = snapshot.rects.get(key);
        if (!was) continue;
        const dx = was.left - now.left;
        const dy = was.top - scrolled - now.top;
        if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) moves.push({ el: now.el, dx, dy, key });
      }
      if (moves.length <= MAX_MOVING) {
        for (const { el, dx, dy, key } of moves) {
          // La fila que ha cambiado viaja por encima de las demás, con su fondo (list.css).
          const lifted = key.startsWith('row:') && changed.has(key.slice(4));
          if (lifted) el.classList.add('is-moving');
          const animation = el.animate(
            [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
            { duration: ms * 1.6, easing: EASE },
          );
          if (lifted) {
            const done = () => el.classList.remove('is-moving');
            animation.addEventListener('finish', done);
            animation.addEventListener('cancel', done);
          }
        }
      }
    }

    if (added.length > 0 && added.length <= MAX_NEW) {
      for (const id of added) {
        const row = element.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(id)}"]`);
        const body = row?.querySelector<HTMLElement>('.entry-row__body');
        const status = row?.dataset.status;
        if (!body || !status) continue;
        body.animate(
          [
            { backgroundColor: `color-mix(in srgb, var(--${status}) 20%, transparent)` },
            { backgroundColor: 'transparent' },
          ],
          { duration: FLASH_MS, easing: 'ease-out' },
        );
      }
    }
  }, [entries, layoutKey]);

  // Siempre el mismo objeto: va en las dependencias del efecto que engancha los gestos.
  return useMemo(
    () => ({
      skipNext() {
        skip.current = true;
        before.current = null;
      },
    }),
    [],
  );
}
