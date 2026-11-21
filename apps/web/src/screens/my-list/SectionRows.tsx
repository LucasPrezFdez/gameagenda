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
//
// En la cuadrícula (DECISIONES §10.53), lo mismo con filas de tarjetas: se pinta o se salta una
// fila entera, así que cada tarjeta sigue en su columna, y los huecos ocupan todo el ancho.
import {
  type CSSProperties,
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
  /** Tarjetas por fila en la cuadrícula; sin ella, la lista de siempre. */
  readonly columns?: number | null;
}

/** El `<ol>` de la lista o el de la cuadrícula, con sus columnas en `--grid-columns`. */
function listProps(columns: number | null): { className: string; style?: CSSProperties } {
  if (columns === null) return { className: 'entry-list' };
  return { className: 'entry-grid', style: { '--grid-columns': columns } as CSSProperties };
}

export function SectionRows({
  id,
  hidden,
  entries,
  virtual,
  keepId,
  frozen,
  renderRow,
  columns = null,
}: SectionRowsProps) {
  if (virtual && !hidden) {
    return (
      <WindowRows
        id={id}
        entries={entries}
        keepId={keepId}
        frozen={frozen}
        renderRow={renderRow}
        columns={columns}
      />
    );
  }
  return (
    <ol id={id} hidden={hidden} {...listProps(columns)}>
      {hidden ? null : entries.map((entry, index) => renderRow(entry, index))}
    </ol>
  );
}

interface Range {
  /** Primera y última fila pintadas (sin la que se conserva por el foco). */
  readonly start: number;
  readonly end: number;
}

/**
 * Las filas que tocan la ventana, con `OVERSCAN` de más (`listTop`, relativo a la ventana). En la
 * cuadrícula, `count` son las filas de tarjetas.
 */
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
  readonly columns: number | null;
}

function WindowRows({ id, entries, keepId, frozen, renderRow, columns }: WindowRowsProps) {
  // El `<ol>` va aquí y no en `SectionRows`: React pone la *ref* de un padre después de los
  // efectos de sus hijos, y entonces el efecto que escucha el desplazamiento la veía vacía.
  const listRef = useRef<HTMLOListElement>(null);
  const count = entries.length;
  const perRow = columns ?? 1;
  /** Filas de la lista, o filas de tarjetas de la cuadrícula. */
  const rows = Math.ceil(count / perRow);
  const [rowSize, setRowSize] = useState(ROW_ESTIMATE);
  // Antes de medir: lo que cabe en la ventana desde arriba, que es donde se abre la lista.
  const [range, setRange] = useState<Range>(() =>
    visibleRange(0, window.innerHeight, ROW_ESTIMATE, rows),
  );
  const sizeRef = useRef(rowSize);
  sizeRef.current = rowSize;
  const countRef = useRef(rows);
  countRef.current = rows;

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

  // Tras cada pintado: el alto de una fila de verdad (en el móvil, otra maquetación; en la
  // cuadrícula, el de una tarjeta, que cambia con el ancho) y las filas que tocan con el número de
  // entradas de ahora. Antes de pintar, así nunca se ve un hueco. Sin redondear: la tarjeta mide
  // fracciones de píxel (la portada es 2:3 de su ancho), y redondeada, los huecos de cientos de
  // filas se descuadraban.
  useLayoutEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(':scope > [data-entry-id]');
    const height = row ? row.getBoundingClientRect().height : 0;
    if (height > 0 && Math.abs(height - sizeRef.current) > 0.01) {
      sizeRef.current = height;
      setRowSize(height);
    }
    update();
  });

  // Las filas que se pintan; la del foco, aunque esté lejos (en la cuadrícula, entera).
  const rowIndexes: number[] = [];
  for (let row = range.start; row <= Math.min(range.end, rows - 1); row += 1) {
    rowIndexes.push(row);
  }
  const keep = keepId === null ? -1 : entries.findIndex((entry) => entry.id === keepId);
  const keepRow = keep < 0 ? -1 : Math.floor(keep / perRow);
  if (keepRow >= 0 && !rowIndexes.includes(keepRow)) {
    rowIndexes.push(keepRow);
    rowIndexes.sort((a, b) => a - b);
  }

  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const [position, row] of rowIndexes.entries()) {
    const first = entries[row * perRow];
    if (!first) continue;
    if (row > cursor) {
      nodes.push(
        <li
          key={position === 0 ? 'hueco-inicio' : `hueco-${first.id}`}
          className="entry-list__gap"
          aria-hidden="true"
          style={{ height: (row - cursor) * rowSize }}
        />,
      );
    }
    const end = Math.min(count, (row + 1) * perRow);
    for (let index = row * perRow; index < end; index += 1) {
      const entry = entries[index];
      if (entry) nodes.push(renderRow(entry, index, { index, setSize: count }));
    }
    cursor = row + 1;
  }
  if (rows > cursor) {
    nodes.push(
      <li
        key="hueco-final"
        className="entry-list__gap"
        aria-hidden="true"
        style={{ height: (rows - cursor) * rowSize }}
      />,
    );
  }
  return (
    <ol ref={listRef} id={id} {...listProps(columns)}>
      {nodes}
    </ol>
  );
}
