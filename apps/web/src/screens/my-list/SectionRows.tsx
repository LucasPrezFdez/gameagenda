// Las filas de una sección de Mi lista (Fase 2, preparar la importación de Steam; DECISIONES
// §10.48). Con una agenda normal se pintan todas, como siempre. Con muchas (`VIRTUAL_FROM` filas a
// la vista entre todas las secciones), solo las que están cerca de la pantalla: con 5 000 juegos,
// pintarlas todas costaba 8 s al abrir Mi lista y 2,4 s al cambiar un estado con CPU ×4.
//
// Las filas siguen en el flujo de la página, entre dos huecos (`li` vacíos con el alto de las que
// no se pintan), y no colocadas con `transform` como en el Catálogo: así el deslizado de las filas
// (`list-motion.ts`, FLIP), el asa `::` y los estilos de la lista funcionan igual. Todas las filas
// miden lo mismo (`--row-h`: la portada manda y el título va en una línea), así que qué filas tocan
// es una división, sin medirlas una a una y sin librería: TanStack Virtual, la del Catálogo, sumaba
// 9 KB brotli al JS inicial, donde va Mi lista.
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { AgendaEntry } from '../../agenda/types.ts';

/** Desde cuántas filas a la vista (sumando las secciones) se pintan solo las cercanas. */
export const VIRTUAL_FROM = 300;
/** Filas de más por encima y por debajo de la pantalla. */
const OVERSCAN = 12;
/** El alto de `--row-h` (tokens.css), hasta medir una fila de verdad. */
const ROW_ESTIMATE = 76;

/** Lo que necesita una fila pintada en una sección virtual. */
export interface VirtualRowProps {
  /** Posición en la sección, para `data-index`, `aria-posinset` y la prioridad. */
  readonly index: number;
  /** Total de la sección, para `aria-setsize`: el lector sabe cuántas hay. */
  readonly setSize: number;
}

interface SectionRowsProps {
  readonly id: string;
  readonly hidden: boolean;
  readonly entries: readonly AgendaEntry[];
  readonly virtual: boolean;
  /** La fila del *tabindex* itinerante: nunca se desmonta (ver §9.7, 4.1.2). */
  readonly keepId: string | null;
  /** Mientras se arrastra con el asa, las filas pintadas no cambian. */
  readonly frozen: RefObject<boolean>;
  readonly renderRow: (entry: AgendaEntry, index: number, virtual?: VirtualRowProps) => ReactNode;
}

export function SectionRows({
  id,
  hidden,
  entries,
  virtual,
  keepId,
  frozen,
  renderRow,
}: SectionRowsProps) {
  if (virtual && !hidden) {
    return (
      <WindowRows id={id} entries={entries} keepId={keepId} frozen={frozen} renderRow={renderRow} />
    );
  }
  return (
    <ol id={id} className="entry-list" hidden={hidden}>
      {hidden ? null : entries.map((entry, index) => renderRow(entry, index))}
    </ol>
  );
}

interface Range {
  /** Primera y última fila pintadas (sin la que se conserva por el foco). */
  readonly start: number;
  readonly end: number;
}

/** Las filas que tocan la ventana, con `OVERSCAN` de más (`listTop`, relativo a la ventana). */
export function visibleRange(
  listTop: number,
  viewport: number,
  rowSize: number,
  count: number,
): Range {
  if (count === 0) return { start: 0, end: -1 };
  const first = Math.floor(-listTop / rowSize) - OVERSCAN;
  const last = Math.ceil((viewport - listTop) / rowSize) + OVERSCAN;
  const start = Math.max(0, Math.min(count - 1, first));
  const end = Math.max(start, Math.min(count - 1, last));
  return { start, end };
}

interface WindowRowsProps {
  readonly id: string;
  readonly entries: readonly AgendaEntry[];
  readonly keepId: string | null;
  readonly frozen: RefObject<boolean>;
  readonly renderRow: SectionRowsProps['renderRow'];
}

function WindowRows({ id, entries, keepId, frozen, renderRow }: WindowRowsProps) {
  // El `<ol>` va aquí y no en `SectionRows`: React pone la *ref* de un padre después de los
  // efectos de sus hijos, y entonces el efecto que escucha el desplazamiento la veía vacía.
  const listRef = useRef<HTMLOListElement>(null);
  const count = entries.length;
  const [rowSize, setRowSize] = useState(ROW_ESTIMATE);
  // Antes de medir: lo que cabe en la ventana desde arriba, que es donde se abre la lista.
  const [range, setRange] = useState<Range>(() =>
    visibleRange(0, window.innerHeight, ROW_ESTIMATE, count),
  );
  const sizeRef = useRef(rowSize);
  sizeRef.current = rowSize;
  const countRef = useRef(count);
  countRef.current = count;

  /** Recalcula qué filas tocan; con el asa en marcha, nada cambia. */
  const update = useCallback(() => {
    const list = listRef.current;
    if (!list || frozen.current) return;
    const padding = Number.parseFloat(getComputedStyle(list).paddingTop) || 0;
    const top = list.getBoundingClientRect().top + padding;
    const next = visibleRange(top, window.innerHeight, sizeRef.current, countRef.current);
    setRange((current) =>
      current.start === next.start && current.end === next.end ? current : next,
    );
  }, [frozen]);

  // Al desplazar (una vez por fotograma), al cambiar el tamaño de la ventana y si cambia lo que hay
  // encima de la lista (otra sección, un aviso, los filtros).
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    let frame = 0;
    const schedule = () => {
      if (frame === 0) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          update();
        });
      }
    };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(list.closest('.screen') ?? document.body);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer.disconnect();
    };
  }, [update]);

  // Tras cada pintado: el alto de una fila de verdad (en el móvil, otra maquetación) y las filas
  // que tocan con el número de entradas de ahora. Antes de pintar, así nunca se ve un hueco.
  useLayoutEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(':scope > .entry-row');
    const height = row ? Math.round(row.getBoundingClientRect().height) : 0;
    if (height > 0 && height !== sizeRef.current) {
      sizeRef.current = height;
      setRowSize(height);
    }
    update();
  });

  const indexes: number[] = [];
  for (let index = range.start; index <= Math.min(range.end, count - 1); index += 1) {
    indexes.push(index);
  }
  const keep = keepId === null ? -1 : entries.findIndex((entry) => entry.id === keepId);
  if (keep >= 0 && !indexes.includes(keep)) {
    indexes.push(keep);
    indexes.sort((a, b) => a - b);
  }

  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const [position, index] of indexes.entries()) {
    const entry = entries[index];
    if (!entry) continue;
    if (index > cursor) {
      nodes.push(
        <li
          key={position === 0 ? 'hueco-inicio' : `hueco-${entry.id}`}
          className="entry-list__gap"
          aria-hidden="true"
          style={{ height: (index - cursor) * rowSize }}
        />,
      );
    }
    nodes.push(renderRow(entry, index, { index, setSize: count }));
    cursor = index + 1;
  }
  if (count > cursor) {
    nodes.push(
      <li
        key="hueco-final"
        className="entry-list__gap"
        aria-hidden="true"
        style={{ height: (count - cursor) * rowSize }}
      />,
    );
  }
  return (
    <ol ref={listRef} id={id} className="entry-list">
      {nodes}
    </ol>
  );
}
