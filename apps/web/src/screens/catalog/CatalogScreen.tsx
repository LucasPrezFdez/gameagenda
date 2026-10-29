// Catálogo (RF-17, RF-18; ver §9.1): contador de lo visible, filtro de texto y `(+)` en cada fila.
// Pide las filas al Worker en ventanas de ≤200 (`browse` + `rows`); el catálogo nunca pasa entero
// al hilo principal. Con el catálogo real, la lista se virtualiza (`@tanstack/react-virtual`).
import { formatCount } from '@gameagenda/core';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
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
import { type CoreGame, canSearchCatalog, GAME_FLAGS } from '../../search-client/index.ts';
import './catalog.css';

const VIEW_ID = 'catalog';
const WINDOW = 200;
const SKELETON_ROWS = 8;

interface CatalogView {
  readonly q: string;
  readonly count: number;
  readonly rows: readonly CoreGame[];
}

function rowId(appid: number): string {
  return `catalog-${appid}`;
}

export default function CatalogScreen() {
  const { search } = useServices();
  const status = useCatalogStatus();
  const { showAdult } = useSettings();
  const entriesById = useEntriesById();
  const commands = useCommands();
  const { search: query } = useLocation();
  const [text, setText] = useState(() => new URLSearchParams(query).get('q') ?? '');
  const [view, setView] = useState<CatalogView | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const ready = canSearchCatalog(status.state);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `showAdult` y el estado del catálogo cambian sus filas.
  useEffect(() => {
    if (!ready) return;
    let current = true;
    search
      .browse(VIEW_ID, text)
      .then(async (count) => ({
        count,
        rows: await search.rows(VIEW_ID, 0, Math.min(count, WINDOW)),
      }))
      .then(({ count, rows }) => {
        if (current) setView({ q: text, count, rows });
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [search, text, ready, showAdult, status.state]);

  function onFilter(value: string): void {
    setText(value);
    const params = new URLSearchParams();
    if (value !== '') params.set('q', value);
    navigate(withSearch('/catalogo', params), { replace: true });
  }

  function capture(game: CoreGame, timeStamp: number): void {
    commands.capture({ id: steamId(game.appid), title: displayName(game) }, undefined, {
      feedbackStart: timeStamp,
    });
  }

  /** ↑ ↓ entre filas, Intro abre la ficha (enlace) y `+` apunta (ver §9.4). */
  function onListKeyDown(event: KeyboardEvent<HTMLOListElement>): void {
    const target = event.target as HTMLElement;
    if (!target.matches('[data-row-title]')) return;
    const titles = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-row-title]') ?? [])];
    const index = titles.indexOf(target);
    const go = (next: number) => {
      titles[Math.max(0, Math.min(titles.length - 1, next))]?.focus();
      event.preventDefault();
    };
    if (event.key === 'ArrowDown') go(index + 1);
    else if (event.key === 'ArrowUp') go(index - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(titles.length - 1);
    else if (event.key === '+' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      const appid = Number(target.dataset.appid);
      const game = view?.rows.find((row) => row.appid === appid);
      if (game && !entriesById.has(steamId(appid))) capture(game, event.timeStamp);
      event.preventDefault();
    }
  }

  const rows = view?.rows ?? [];
  const roving =
    activeId !== null && rows.some((r) => r.appid === activeId) ? activeId : rows[0]?.appid;
  const loading = ready && (view === null || view.q !== text);

  return (
    <div className="screen catalog">
      <header className="screen__header catalog__header">
        <ScreenHeading documentTitle={es.nav.catalog}>{es.catalog.title}</ScreenHeading>
        {view && ready && (
          <p className="catalog__count">
            <strong>{es.catalog.count(formatCount(view.count))}</strong>
            <span className="muted">{showAdult ? es.catalog.scopeAdult : es.catalog.scope}</span>
          </p>
        )}
      </header>

      <label className="catalog__filter">
        <span className="visually-hidden">{es.catalog.filter}</span>
        <Icon name="search" />
        {/* Nunca apunta con Intro (ver §9.1): solo filtra. */}
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
        />
      </label>

      <CatalogNotice />

      {ready && !loading && rows.length === 0 && (
        <div className="empty-state">
          <p>{es.catalog.noMatches(text)}</p>
        </div>
      )}

      {ready && loading && rows.length === 0 && (
        <ul className="catalog-list" aria-busy="true" aria-label={es.catalog.loading}>
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: filas de relleno sin identidad.
            <li key={index} className="catalog-row catalog-row--skeleton">
              <span className="cover cover--row skeleton" />
              <span className="skeleton skeleton--line" />
            </li>
          ))}
        </ul>
      )}

      {rows.length > 0 && (
        <ol ref={listRef} className="catalog-list" onKeyDown={onListKeyDown}>
          {rows.map((game) => {
            const entry = entriesById.get(steamId(game.appid));
            const name = displayName(game);
            const tab = game.appid === roving ? 0 : -1;
            return (
              <li
                key={game.appid}
                className="catalog-row"
                onFocusCapture={() => setActiveId(game.appid)}
              >
                <Cover title={name} />
                <div className="catalog-row__main">
                  <Link
                    id={rowId(game.appid)}
                    to={gamePath(steamId(game.appid))}
                    className="catalog-row__title"
                    tabIndex={tab}
                    data-row-title=""
                    data-appid={game.appid}
                  >
                    {name}
                  </Link>
                  <span className="catalog-row__meta">
                    {game.year !== null && <span>{game.year}</span>}
                    {(game.flags & GAME_FLAGS.free) !== 0 && <span>{es.game.free}</span>}
                    {(game.flags & GAME_FLAGS.earlyAccess) !== 0 && (
                      <span>{es.game.earlyAccess}</span>
                    )}
                  </span>
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
      )}
    </div>
  );
}
