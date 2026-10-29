// Catálogo (RF-17, RF-18; ver §9.1): contador de lo visible, filtro de texto, filtros sencillos y
// `(+)` en cada fila. Lista virtual (`@tanstack/react-virtual`, en este *chunk* diferido) sobre
// `browse` + `rows`: el Worker da el recuento y las filas en ventanas de ≤200; el catálogo nunca
// pasa entero al hilo principal (se guardan como mucho `MAX_PAGES` ventanas).
import { formatCount } from '@gameagenda/core';
import { defaultRangeExtractor, type Range, useWindowVirtualizer } from '@tanstack/react-virtual';
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useCommands } from '../../agenda/commands.ts';
import { steamId } from '../../agenda/types.ts';
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
  canSearchCatalog,
  GAME_FLAGS,
} from '../../search-client/index.ts';
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
  const { search } = useServices();
  const status = useCatalogStatus();
  const { showAdult } = useSettings();
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
  const ready = canSearchCatalog(status.state);
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

  const rangeExtractor = useCallback((range: Range) => {
    // La fila activa nunca se desmonta, aunque quede fuera de la vista (ver §9.7, 4.1.2).
    const indexes = defaultRangeExtractor(range);
    const keep = activeRef.current;
    if (keep < range.count && !indexes.includes(keep)) {
      indexes.push(keep);
      indexes.sort((a, b) => a - b);
    }
    return indexes;
  }, []);

  const virtualizer = useWindowVirtualizer({
    count,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    scrollMargin,
    rangeExtractor,
  });
  const items = virtualizer.getVirtualItems();
  // Lo visible (sin la fila activa, que puede estar lejos): solo esas ventanas se piden.
  const visible = virtualizer.range;
  const firstIndex = Math.max(0, (visible?.startIndex ?? 0) - OVERSCAN);
  const lastIndex = Math.min(count - 1, (visible?.endIndex ?? -1) + OVERSCAN);

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
    virtualizer.scrollToIndex(next, { align: 'auto' });
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

  function capture(game: CoreGame, timeStamp: number): void {
    commands.capture({ id: steamId(game.appid), title: displayName(game) }, undefined, {
      feedbackStart: timeStamp,
    });
  }

  /** ↑ ↓ Inicio Fin RePág AvPág entre filas, Intro abre la ficha (enlace) y `+` apunta (§9.4). */
  function onListKeyDown(event: KeyboardEvent<HTMLOListElement>): void {
    const target = event.target as HTMLElement;
    if (!target.matches('[data-row-title]')) return;
    const index = Number(target.dataset.index);
    const move = (next: number) => {
      event.preventDefault();
      goTo(next);
    };
    if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index - 1);
    else if (event.key === 'PageDown') move(index + PAGE_KEYS_STEP);
    else if (event.key === 'PageUp') move(index - PAGE_KEYS_STEP);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(count - 1);
    else if (event.key === '+' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      const game = gameAt(index);
      if (game && !entriesById.has(steamId(game.appid))) capture(game, event.timeStamp);
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

  return (
    <div className="screen catalog">
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
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="search"
          onChange={(event) => onFilter(event.target.value)}
          onKeyDown={onFilterKeyDown}
        />
      </label>

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
        className="catalog-list"
        aria-label={filtered ? `${es.catalog.list}: ${text}` : es.catalog.list}
        hidden={!current || count === 0}
        onKeyDown={onListKeyDown}
        style={{ height: virtualizer.getTotalSize() }}
      >
        {items.map((item) => {
          const game = gameAt(item.index);
          const tab = item.index === roving ? 0 : -1;
          const style = {
            height: ROW_HEIGHT - ROW_GAP,
            transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
          };
          const common = {
            'aria-setsize': count,
            'aria-posinset': item.index + 1,
            onFocusCapture: () => setActiveIndex(item.index),
            style,
          };
          if (!game) {
            return (
              <li key={item.key} className="catalog-row catalog-row--loading" {...common}>
                <span className="cover cover--row skeleton" />
                <span
                  className="catalog-row__title skeleton skeleton--line"
                  tabIndex={tab}
                  data-row-title=""
                  data-index={item.index}
                >
                  <span className="visually-hidden">{es.catalog.loadingRow}</span>
                </span>
              </li>
            );
          }
          const entry = entriesById.get(steamId(game.appid));
          const name = displayName(game);
          return (
            <li key={item.key} className="catalog-row" {...common}>
              <Cover title={name} />
              <div className="catalog-row__main">
                <Link
                  to={gamePath(steamId(game.appid))}
                  className="catalog-row__title"
                  tabIndex={tab}
                  data-row-title=""
                  data-index={item.index}
                  data-appid={game.appid}
                >
                  {name}
                </Link>
                <GameMeta game={game} showAdult={showAdult} />
              </div>
              {entry ? (
                <StatusText status={entry.status} />
              ) : (
                <button
                  type="button"
                  className="icon-btn catalog-row__add"
                  aria-label={es.catalog.capture(name)}
                  tabIndex={tab}
                  onClick={(event) => capture(game, event.timeStamp)}
                >
                  <Icon name="plus" />
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
