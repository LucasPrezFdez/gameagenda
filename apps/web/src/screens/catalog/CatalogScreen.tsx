// Catálogo (RF-17, RF-18; ver §9.1): contador de lo visible, filtro de texto, filtros sencillos y
// `(+)` en cada fila. Lista virtual (`@tanstack/react-virtual`, en este *chunk* diferido) sobre
// `browse` + `rows`: el Worker da el recuento y las filas en ventanas de ≤200; el catálogo nunca
// pasa entero al hilo principal (se guardan como mucho `MAX_PAGES` ventanas).
// Dos formas de verlo (DECISIONES §10.45): la lista y una cuadrícula de portadas, como la búsqueda
// instantánea de SteamDB. La cuadrícula virtualiza filas de tarjetas: el número de columnas sale
// del ancho, y las teclas, los atajos y `(+)` son los mismos.
import { formatCount } from '@gameagenda/core';
import { defaultRangeExtractor, type Range, useWindowVirtualizer } from '@tanstack/react-virtual';
import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useCommands } from '../../agenda/commands.ts';
import { type Status, steamId } from '../../agenda/types.ts';
import { useCatalogStatus, useEntriesById, useServices, useSettings } from '../../app/services.tsx';
import { Cover, StatusText } from '../../components/bits.tsx';
import { CatalogNotice } from '../../components/CatalogNotice.tsx';
import { Icon } from '../../components/icons.tsx';
import { ScreenHeading } from '../../components/ScreenHeading.tsx';
import { es } from '../../i18n/es.ts';
import { displayName } from '../../palette/palette-model.ts';
import { Link, navigate, useLocation } from '../../router/router.tsx';
import { gamePath, withSearch } from '../../router/routes.ts';
import {
  type BrowseFilters,
  type CoreGame,
  canBrowseCatalog,
  GAME_FLAGS,
} from '../../search-client/index.ts';
import { isShortcutTarget, openSteam, requestNoteFocus } from '../../shortcuts/dom.ts';
import { shortcutFor } from '../../shortcuts/keymap.ts';
import './catalog.css';

const VIEW_ID = 'catalog';
/** Filas por petición `rows` (el máximo del protocolo, §8.7). */
const PAGE_SIZE = 200;
/** Ventanas que se guardan en memoria; las más lejanas se olvidan. */
const MAX_PAGES = 12;
/** Alto fijo de la fila: 196 665 × 72 px ≈ 14,2 Mpx, bajo el límite de Firefox (§9.1). */
const ROW_HEIGHT = 72;
const ROW_GAP = 4;
/** Filas que avanzan RePág y AvPág. */
const PAGE_KEYS_STEP = 10;
/** Filas que se pintan fuera de la vista, por arriba y por abajo. */
const OVERSCAN = 8;
/** Cuadrícula: ancho mínimo de la tarjeta, hueco entre tarjetas y alto del texto bajo la portada. */
const CARD_MIN = 148;
const CARD_GAP = 12;
const CARD_TEXT = 48;
/** Nunca menos de 3 columnas: con 2, en un móvil estrecho el alto total pasaría el límite de
 *  Firefox (§9.1). Con 3 a 320 px son ≈65 600 filas de ≈205 px, unos 13,5 Mpx. */
const MIN_COLUMNS = 3;
const MAX_COLUMNS = 8;
/** Filas de tarjetas fuera de la vista, y las que avanzan RePág y AvPág. */
const GRID_OVERSCAN = 3;
const GRID_PAGE_ROWS = 3;

type Chip = 'all' | 'soon' | 'free' | 'early';

/** Filtros sencillos de M1 (los demás, en M2): en la URL como `?filtro=…`. */
const CHIPS: Readonly<Record<Chip, { readonly param: string; readonly filters: BrowseFilters }>> = {
  all: { param: '', filters: {} },
  soon: {
    param: 'proximamente',
    filters: { flagsAll: GAME_FLAGS.comingSoon, flagsNone: GAME_FLAGS.retired },
  },
  free: { param: 'gratis', filters: { flagsAll: GAME_FLAGS.free, flagsNone: GAME_FLAGS.retired } },
  early: {
    param: 'acceso-anticipado',
    filters: { flagsAll: GAME_FLAGS.earlyAccess, flagsNone: GAME_FLAGS.retired },
  },
};
const CHIP_ORDER: readonly Chip[] = ['all', 'soon', 'free', 'early'];

function chipFromParam(value: string | null): Chip {
  return CHIP_ORDER.find((chip) => CHIPS[chip].param === value && value !== '') ?? 'all';
}

interface View {
  readonly key: string;
  readonly count: number;
}

interface Pages {
  readonly key: string;
  readonly map: ReadonlyMap<number, readonly CoreGame[]>;
}

function GameMeta({ game, showAdult }: { game: CoreGame; showAdult: boolean }) {
  const { flags } = game;
  return (
    <span className="catalog-row__meta">
      {game.year !== null && <span>{game.year}</span>}
      {(flags & GAME_FLAGS.comingSoon) !== 0 && <span>{es.game.comingSoon}</span>}
      {(flags & GAME_FLAGS.free) !== 0 && <span>{es.game.free}</span>}
      {(flags & GAME_FLAGS.earlyAccess) !== 0 && <span>{es.game.earlyAccess}</span>}
      {(flags & GAME_FLAGS.retired) !== 0 && <span>{es.game.retired}</span>}
      {showAdult && (flags & GAME_FLAGS.adult) !== 0 && <span>{es.game.adult}</span>}
    </span>
  );
}

export default function CatalogScreen() {
  const { search, settings: settingsStore } = useServices();
  const status = useCatalogStatus();
  const { showAdult, singleKeyShortcuts, catalogView } = useSettings();
  const grid = catalogView === 'grid';
  const rootRef = useRef<HTMLDivElement>(null);
  /** Ancho del contenido: de él salen las columnas de la cuadrícula. */
  const [width, setWidth] = useState(0);
  const entriesById = useEntriesById();
  const commands = useCommands();
  const { search: query } = useLocation();
  const [text, setText] = useState(() => new URLSearchParams(query).get('q') ?? '');
  const [chip, setChip] = useState<Chip>(() =>
    chipFromParam(new URLSearchParams(query).get('filtro')),
  );
  const [view, setView] = useState<View | null>(null);
  const [pages, setPages] = useState<Pages>({ key: '', map: new Map() });
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLOListElement>(null);
  const activeRef = useRef(0);
  /** Fila que debe recibir el foco en cuanto esté pintada (Fin, ↓…). */
  const wantFocus = useRef<number | null>(null);
  const requested = useRef(new Set<string>());
  /** Ventanas que no se pueden olvidar: las visibles y la de la fila activa. */
  const keepPages = useRef(new Set<number>());
  const [scrollMargin, setScrollMargin] = useState(0);
  // En `boot` (M3) el Worker no responde a `browse` hasta `scan`: aquí cuenta como en `none`.
  const ready = canBrowseCatalog(status.state);
  // Sin el estado (`scan` → `full` no cambia las filas): así el foco no se pierde al pasar a `full`.
  const viewKey = `${text}\u0000${chip}\u0000${showAdult}\u0000${status.version ?? ''}`;
  const current = view !== null && view.key === viewKey ? view : null;
  const count = current?.count ?? 0;

  useEffect(() => {
    if (!ready) return;
    let live = true;
    search
      .browse(VIEW_ID, text, CHIPS[chip].filters)
      .then((total) => {
        if (!live) return;
        requested.current.clear();
        setPages({ key: viewKey, map: new Map() });
        setView({ key: viewKey, count: total });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [search, ready, text, chip, viewKey]);

  useLayoutEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  // Lista: una columna. Cuadrícula: las tarjetas que quepan, todas del mismo ancho, con portada
  // de 2:3 y dos líneas de texto debajo; cada fila virtual es una fila de tarjetas.
  const columns =
    grid && width > 0
      ? Math.max(
          MIN_COLUMNS,
          Math.min(MAX_COLUMNS, Math.floor((width + CARD_GAP) / (CARD_MIN + CARD_GAP))),
        )
      : 1;
  const cardWidth = grid ? Math.floor((width - CARD_GAP * (columns - 1)) / columns) : 0;
  const rowHeight = grid ? Math.round(cardWidth * 1.5) + CARD_TEXT + CARD_GAP : ROW_HEIGHT;
  const rowCount = Math.ceil(count / columns);
  const overscan = grid ? GRID_OVERSCAN : OVERSCAN;
  const columnsRef = useRef(columns);
  columnsRef.current = columns;

  const rangeExtractor = useCallback((range: Range) => {
    // La fila activa nunca se desmonta, aunque quede fuera de la vista (ver §9.7, 4.1.2).
    const indexes = defaultRangeExtractor(range);
    const keep = Math.floor(activeRef.current / columnsRef.current);
    if (keep < range.count && !indexes.includes(keep)) {
      indexes.push(keep);
      indexes.sort((a, b) => a - b);
    }
    return indexes;
  }, []);

  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => rowHeight,
    overscan,
    scrollMargin,
    rangeExtractor,
  });
  const items = virtualizer.getVirtualItems();
  // Vuelve a `false` 150 ms después del último desplazamiento (`isScrollingResetDelay`).
  const scrolling = virtualizer.isScrolling;
  // Lo visible (sin la fila activa, que puede estar lejos): solo esas ventanas se piden.
  const visible = virtualizer.range;
  const firstIndex = Math.max(0, (visible?.startIndex ?? 0) - overscan) * columns;
  const lastIndex = Math.min(count - 1, ((visible?.endIndex ?? -1) + overscan + 1) * columns - 1);

  // Al cambiar el alto de las filas (otra forma de verlo u otro ancho), el virtualizador vuelve a
  // medir. El conmutador está arriba, así que al cambiar de forma siempre se parte del principio.
  // biome-ignore lint/correctness/useExhaustiveDependencies: solo al cambiar la rejilla.
  useLayoutEffect(() => {
    virtualizer.measure();
  }, [rowHeight, columns]);

  // Posición de la lista en la página, para la virtualización sobre la ventana.
  useLayoutEffect(() => {
    const measure = () => {
      const list = listRef.current;
      if (list) setScrollMargin(list.getBoundingClientRect().top + window.scrollY);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  });

  // Pide las ventanas de 200 filas que tocan las filas pintadas (y la activa).
  useEffect(() => {
    if (!current || count === 0 || lastIndex < 0) return;
    const wanted = new Set<number>();
    for (let p = Math.floor(firstIndex / PAGE_SIZE); p <= Math.floor(lastIndex / PAGE_SIZE); p++) {
      wanted.add(p);
    }
    wanted.add(Math.floor(Math.min(activeRef.current, count - 1) / PAGE_SIZE));
    keepPages.current = wanted;
    for (const page of wanted) {
      const id = `${current.key}\u0000${page}`;
      if (pages.key === current.key && pages.map.has(page)) continue;
      if (requested.current.has(id)) continue;
      requested.current.add(id);
      const from = page * PAGE_SIZE;
      search
        .rows(VIEW_ID, from, Math.min(count, from + PAGE_SIZE))
        .then((rows) => {
          setPages((prev) => {
            if (prev.key !== current.key) return prev;
            const map = new Map(prev.map);
            map.set(page, rows);
            // Se olvidan las ventanas más lejanas de la que acaba de llegar, nunca una de las
            // que se ven ni la de la fila activa.
            while (map.size > MAX_PAGES) {
              let far: number | null = null;
              for (const p of map.keys()) {
                if (keepPages.current.has(p)) continue;
                if (far === null || Math.abs(p - page) > Math.abs(far - page)) far = p;
              }
              if (far === null) break;
              map.delete(far);
              requested.current.delete(`${current.key}\u0000${far}`);
            }
            return { key: prev.key, map };
          });
        })
        .catch(() => requested.current.delete(id));
    }
  }, [search, current, count, firstIndex, lastIndex, pages]);

  /** Enfoca la fila pedida si ya está pintada (y otra vez cuando llegan sus datos). */
  function focusWanted(): void {
    const index = wantFocus.current;
    if (index === null) return;
    const title = listRef.current?.querySelector<HTMLElement>(
      `[data-row-title][data-index="${index}"]`,
    );
    if (!title) return;
    if (document.activeElement !== title) title.focus({ preventScroll: true });
    if (title.tagName === 'A') wantFocus.current = null;
  }

  useLayoutEffect(focusWanted);

  function gameAt(index: number): CoreGame | undefined {
    if (pages.key !== current?.key) return undefined;
    return pages.map.get(Math.floor(index / PAGE_SIZE))?.[index % PAGE_SIZE];
  }

  function setActiveIndex(index: number): void {
    activeRef.current = index;
    setActive(index);
  }

  function goTo(index: number): void {
    if (count === 0) return;
    const next = Math.max(0, Math.min(count - 1, index));
    setActiveIndex(next);
    wantFocus.current = next;
    virtualizer.scrollToIndex(Math.floor(next / columns), { align: 'auto' });
    // Si la fila ya está pintada, el foco va ya: puede que no haya otro render (misma fila activa).
    focusWanted();
  }

  function updateUrl(nextText: string, nextChip: Chip): void {
    const params = new URLSearchParams();
    if (nextText !== '') params.set('q', nextText);
    if (nextChip !== 'all') params.set('filtro', CHIPS[nextChip].param);
    navigate(withSearch('/catalogo', params), { replace: true });
  }

  function resetScroll(): void {
    setActiveIndex(0);
    if (window.scrollY > scrollMargin) window.scrollTo({ top: 0 });
  }

  function onFilter(value: string): void {
    setText(value);
    resetScroll();
    updateUrl(value, chip);
  }

  function onChip(next: Chip): void {
    setChip(next);
    resetScroll();
    updateUrl(text, next);
  }

  function onViewMode(next: 'list' | 'grid'): void {
    if (next === catalogView) return;
    settingsStore.update({ catalogView: next });
  }

  function capture(game: CoreGame, timeStamp: number, status?: Status): void {
    commands.capture(
      { id: steamId(game.appid), title: displayName(game) },
      status ? { status } : undefined,
      { feedbackStart: timeStamp },
    );
  }

  /**
   * ↑ ↓ Inicio Fin RePág AvPág entre filas, Intro abre la ficha (enlace) y `+` apunta (§9.4).
   * Desde M3, `J` y `K` como ↓ y ↑, `V` (Ver en Steam) y, sobre un juego de la lista, `1`–`5`,
   * `C`/`P`/`A`, `N` y `Supr`; si aún no está, `1`–`5` lo apuntan en ese estado.
   */
  function onListKeyDown(event: KeyboardEvent<HTMLOListElement>): void {
    const target = event.target as HTMLElement;
    if (!target.matches('[data-row-title]')) return;
    const index = Number(target.dataset.index);
    const move = (next: number) => {
      event.preventDefault();
      goTo(next);
    };
    // En la cuadrícula, ↑ y ↓ cambian de fila de tarjetas y ← y → van a la de al lado.
    const pageStep = grid ? GRID_PAGE_ROWS * columns : PAGE_KEYS_STEP;
    if (event.key === 'ArrowDown') {
      move(grid ? Math.min(count - 1, index + columns) : index + 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      if (!grid || index >= columns) move(index - columns);
      else event.preventDefault();
      return;
    }
    if (grid && event.key === 'ArrowRight') {
      move(index + 1);
      return;
    }
    if (grid && event.key === 'ArrowLeft') {
      move(index - 1);
      return;
    }
    if (event.key === 'PageDown') {
      move(index + pageStep);
      return;
    }
    if (event.key === 'PageUp') {
      move(index - pageStep);
      return;
    }
    if (event.key === 'Home') {
      move(0);
      return;
    }
    if (event.key === 'End') {
      move(count - 1);
      return;
    }
    if (event.defaultPrevented || !isShortcutTarget(target)) return;
    const action = shortcutFor(event, singleKeyShortcuts);
    const game = gameAt(index);
    if (!action || !game) return;
    const id = steamId(game.appid);
    const entry = entriesById.get(id);
    const timing = { feedbackStart: event.timeStamp };
    switch (action.kind) {
      case 'next':
        move(index + 1);
        return;
      case 'previous':
        move(index - 1);
        return;
      case 'capture':
        event.preventDefault();
        if (!entry) capture(game, event.timeStamp);
        return;
      case 'status':
        event.preventDefault();
        if (entry) commands.setStatus(id, action.status, timing);
        else capture(game, event.timeStamp, action.status);
        return;
      case 'flag':
        if (!entry) return;
        event.preventDefault();
        commands.setFlag(id, action.flag, entry.flags[action.flag] !== true, timing);
        return;
      case 'remove':
        if (!entry) return;
        event.preventDefault();
        commands.remove(id, timing);
        return;
      case 'note':
        if (!entry) return;
        event.preventDefault();
        requestNoteFocus(id);
        navigate(gamePath(id));
        return;
      case 'steam':
        event.preventDefault();
        openSteam(game.appid);
        return;
    }
  }

  function onFilterKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    // ↓ desde el filtro baja a la primera fila; Intro nunca apunta (ver §9.1).
    if (event.key === 'ArrowDown' && count > 0) {
      event.preventDefault();
      goTo(0);
    }
  }

  const loading = ready && current === null;
  const roving = Math.min(active, Math.max(0, count - 1));
  const filtered = text.trim() !== '' || chip !== 'all';

  /** Una fila de la lista o una tarjeta de la cuadrícula: el mismo juego, las mismas acciones. */
  function renderItem(index: number, style: CSSProperties) {
    const game = gameAt(index);
    const tab = index === roving ? 0 : -1;
    const common = {
      'aria-setsize': count,
      'aria-posinset': index + 1,
      onFocusCapture: () => setActiveIndex(index),
      style,
    };
    const size = grid ? 'card' : 'row';
    const block = grid ? 'catalog-card' : 'catalog-row';
    if (!game) {
      return (
        <li key={index} className={`${block} ${block}--loading`} {...common}>
          <span className={`cover cover--${size} skeleton`} />
          <span
            className={`${block}__title skeleton skeleton--line`}
            tabIndex={tab}
            data-row-title=""
            data-index={index}
          >
            <span className="visually-hidden">{es.catalog.loadingRow}</span>
          </span>
        </li>
      );
    }
    const entry = entriesById.get(steamId(game.appid));
    const name = displayName(game);
    return (
      <li key={index} className={block} {...common}>
        {/* Con el desplazamiento parado: arrastrar la barra no pide un *shard* por fila. */}
        <Cover title={name} appid={game.appid} size={size} load={!scrolling} />
        <div className={`${block}__main`}>
          <Link
            to={gamePath(steamId(game.appid))}
            className={`${block}__title`}
            tabIndex={tab}
            data-row-title=""
            data-index={index}
            data-appid={game.appid}
          >
            {name}
          </Link>
          <GameMeta game={game} showAdult={showAdult} />
        </div>
        {entry ? (
          <span className={`${block}__status`}>
            <StatusText status={entry.status} />
          </span>
        ) : (
          <button
            type="button"
            className={`icon-btn ${block}__add`}
            aria-label={es.catalog.capture(name)}
            tabIndex={tab}
            onClick={(event) => capture(game, event.timeStamp)}
          >
            <Icon name="plus" />
          </button>
        )}
      </li>
    );
  }

  return (
    <div ref={rootRef} className="screen catalog">
      <header className="screen__header catalog__header">
        <ScreenHeading documentTitle={es.nav.catalog}>{es.catalog.title}</ScreenHeading>
        {current && (
          <p className="catalog__count">
            <strong>{es.catalog.count(count, formatCount(count))}</strong>
            <span className="muted">{showAdult ? es.catalog.scopeAdult : es.catalog.scope}</span>
          </p>
        )}
      </header>

      <label className="catalog__filter">
        <span className="visually-hidden">{es.catalog.filter}</span>
        <Icon name="search" />
        <input
          className="field"
          type="text"
          value={text}
          placeholder={es.catalog.filterPlaceholder}
          data-filter-field=""
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="search"
          onChange={(event) => onFilter(event.target.value)}
          onKeyDown={onFilterKeyDown}
        />
      </label>

      <div className="catalog__bar">
        {/* biome-ignore lint/a11y/useSemanticElements: grupo de botones conmutables, no un formulario. */}
        <div className="chips" role="group" aria-label={es.catalog.chips}>
          {CHIP_ORDER.map((option) => (
            <button
              key={option}
              type="button"
              className="chip-button"
              aria-pressed={chip === option}
              onClick={() => onChip(option)}
            >
              {es.catalog.chip[option]}
            </button>
          ))}
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: grupo de botones conmutables, no un formulario. */}
        <div className="view-toggle" role="group" aria-label={es.catalog.viewMode.label}>
          {(['list', 'grid'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className="icon-btn view-toggle__button"
              aria-pressed={catalogView === mode}
              aria-label={es.catalog.viewMode[mode]}
              title={es.catalog.viewMode[mode]}
              onClick={() => onViewMode(mode)}
            >
              <Icon name={mode === 'list' ? 'list' : 'catalog'} />
            </button>
          ))}
        </div>
      </div>

      <CatalogNotice />

      {current && count === 0 && (
        <div className="empty-state">
          <p>{text.trim() !== '' ? es.catalog.noMatches(text) : es.catalog.noFilterMatches}</p>
        </div>
      )}

      {loading && (
        <ul className="catalog-skeleton" aria-busy="true" aria-label={es.catalog.loading}>
          {Array.from({ length: 8 }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: filas de relleno sin identidad.
            <li key={index} className="catalog-row catalog-row--skeleton">
              <span className="cover cover--row skeleton" />
              <span className="skeleton skeleton--line" />
            </li>
          ))}
        </ul>
      )}

      <ol
        ref={listRef}
        className={grid ? 'catalog-list catalog-list--grid' : 'catalog-list'}
        aria-label={filtered ? `${es.catalog.list}: ${text}` : es.catalog.list}
        hidden={!current || count === 0}
        onKeyDown={onListKeyDown}
        style={{ height: virtualizer.getTotalSize() }}
      >
        {items.flatMap((item) => {
          const top = item.start - virtualizer.options.scrollMargin;
          if (!grid)
            return [
              renderItem(item.index, {
                height: ROW_HEIGHT - ROW_GAP,
                transform: `translateY(${top}px)`,
              }),
            ];
          const cells = [];
          for (let column = 0; column < columns; column += 1) {
            const index = item.index * columns + column;
            if (index >= count) break;
            cells.push(
              renderItem(index, {
                width: cardWidth,
                height: rowHeight - CARD_GAP,
                transform: `translate(${column * (cardWidth + CARD_GAP)}px, ${top}px)`,
              }),
            );
          }
          return cells;
        })}
      </ol>
    </div>
  );
}
