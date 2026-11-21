// Mi lista (RF-09–RF-14; ver §9.1 y §9.3): vista «Pendientes» con secciones, filtros y orden en
// la URL, filas con estado y marcas a un toque y orden manual desde el menú de la fila. Desde M3,
// gestos (RF-15 y RF-16; §9.4): deslizar una fila, mantenerla pulsada y arrastrar su asa `::`.
// Desde el 21-11-2026, también en cuadrícula de portadas (DECISIONES §10.53), como el Catálogo.
import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useCommands } from '../../agenda/commands.ts';
import { appidOf } from '../../agenda/types.ts';
import {
  useAgendaEntries,
  useCopyReminder,
  useServices,
  useSettings,
  useSyncState,
} from '../../app/services.tsx';
import { ChoiceMenu } from '../../components/ChoiceMenu.tsx';
import { Icon } from '../../components/icons.tsx';
import { ScreenHeading } from '../../components/ScreenHeading.tsx';
import { ViewToggle } from '../../components/ViewToggle.tsx';
import { copyReminderDue } from '../../data/copy-reminder.ts';
import { groupLabel, releaseText } from '../../details/release-text.ts';
import { logError } from '../../errors/error-log.ts';
import { attachDragReorder } from '../../gestures/drag-reorder.ts';
import { attachRowGestures } from '../../gestures/row-gestures.ts';
import { es } from '../../i18n/es.ts';
import { gridColumns } from '../../lib/card-grid.ts';
import { isIosBrowserTab } from '../../lib/hooks.ts';
import { usePalette } from '../../palette/palette-context.tsx';
import { measureListVisible } from '../../perf/measures.ts';
import { Link, navigate, useLocation } from '../../router/router.tsx';
import { gamePath, settingsPath, withSearch } from '../../router/routes.ts';
import {
  isShortcutTarget,
  openSteam,
  publishListOrder,
  requestNoteFocus,
} from '../../shortcuts/dom.ts';
import { shortcutFor } from '../../shortcuts/keymap.ts';
import { EntryCard } from './EntryCard.tsx';
import { EntryRow, type RowActions, rowTitleId } from './EntryRow.tsx';
import { gridStep } from './grid-nav.ts';
import {
  buildSections,
  countUpcoming,
  countViews,
  LIST_ORDERS,
  type ListParams,
  type ListSection,
  listSearchParams,
  PURCHASE_FILTERS,
  parseListParams,
  shownViewGroups,
  tabViewsOf,
} from './list-model.ts';
import { useListMotion } from './list-motion.ts';
import { emptyTextOf, SYNCED_EMPTY_TEXTS, syncedEmptyState } from './restore-notice.ts';
import { SectionRows, VIRTUAL_FROM } from './SectionRows.tsx';
import { useReleases } from './use-releases.ts';

function sectionLabel(section: ListSection): string {
  if (section.group) return groupLabel(section.group);
  return section.id === null ? es.list.allEntries : es.list.section[section.id];
}

/**
 * El texto de Mi lista vacía. Con la sincronización activada (M4; CA4.3), puede que la agenda esté
 * llegando del servidor: todos los textos posibles van en la misma celda y solo se ve uno, así que
 * cambiar de uno a otro no mueve el botón (§9.5, regla 3).
 */
function EmptyText() {
  const syncState = useSyncState();
  if (!syncedEmptyState(syncState)) return <p>{es.list.empty}</p>;
  const shown = emptyTextOf(syncState);
  return (
    <div className="empty-state__texts" role="status" data-empty-text={shown}>
      {SYNCED_EMPTY_TEXTS.map((kind) => (
        <p key={kind} data-shown={kind === shown ? '' : undefined}>
          {es.list[kind]}
        </p>
      ))}
    </div>
  );
}

/** En la cuadrícula, nunca menos de 2 columnas: a 320 px, tarjetas de unos 138 px. */
const GRID_MIN_COLUMNS = 2;

/** Huecos de la lista mientras llegan las fechas (§9.5, regla 4: nunca una pantalla de carga). */
function ListSkeleton({ label, columns }: { label: string; columns: number | null }) {
  return (
    <div className="list-sections" aria-busy="true">
      <p className="visually-hidden" role="status">
        {label}
      </p>
      <span className="skeleton skeleton--line" />
      {columns === null ? (
        <ol className="entry-list">
          {[0, 1, 2].map((index) => (
            <li key={index} className="entry-row entry-row--skeleton">
              <div className="entry-row__body">
                <span className="cover cover--row skeleton" />
                <span className="skeleton skeleton--line" />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <ol className="entry-grid" style={{ '--grid-columns': columns } as CSSProperties}>
          {Array.from({ length: columns }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: tarjetas de relleno sin identidad.
            <li key={index} className="entry-card entry-card--skeleton">
              <span className="cover cover--card skeleton" />
              <span className="skeleton skeleton--line" />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** ¿Se reordena esta sección? Solo Quiero jugar y A continuación, por prioridad (§9.1). */
function isMovable(section: ListSection, params: ListParams): boolean {
  return (
    params.order === 'priority' &&
    params.view !== 'upcoming' &&
    (section.id === 'want_to_play' || section.id === 'next')
  );
}

/**
 * Si una acción saca la fila enfocada de la vista, el foco pasa a la siguiente (ver §9.5). Solo si
 * el foco estaba en la fila: con un gesto, suele estar en la página, y moverlo la desplazaría.
 */
function keepFocusNear(container: HTMLElement | null, id: string): () => void {
  const row = document.getElementById(rowTitleId(id))?.closest('[data-entry-id]');
  if (!container || !row?.contains(document.activeElement)) return () => {};
  const titles = [...container.querySelectorAll<HTMLElement>('[data-row-title]')].map(
    (el) => el.id,
  );
  const index = titles.indexOf(rowTitleId(id));
  return () => {
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      const candidates = [...titles.slice(index + 1), ...titles.slice(0, index).reverse()];
      for (const candidate of candidates) {
        const element = document.getElementById(candidate);
        if (element) {
          element.focus();
          return;
        }
      }
      document.getElementById('main')?.focus();
    });
  };
}

export function MyListScreen({ primary = true }: { primary?: boolean }) {
  const entries = useAgendaEntries();
  const commands = useCommands();
  const palette = usePalette();
  const { agenda, settings, notices, copyReminder } = useServices();
  const { singleKeyShortcuts, touchGestures, listLayout } = useSettings();
  const grid = listLayout === 'grid';
  /** Ancho de la lista: de él salen las columnas de la cuadrícula. */
  const [listWidth, setListWidth] = useState(0);
  const copyState = useCopyReminder();
  // La hora de cuando se abre Mi lista: el aviso no cambia mientras se mira.
  const [openedAt] = useState(Date.now);
  const { search } = useLocation();
  const params = useMemo(() => parseListParams(search), [search]);
  const listRef = useRef<HTMLDivElement>(null);
  const filterId = useId();
  const [showOnHold, setShowOnHold] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  /** Fila deslizada a la izquierda, con la bandeja de marcas a la vista (§9.4). */
  const [trayId, setTrayId] = useState<string | null>(null);
  const [iosNotice, setIosNotice] = useState(isIosBrowserTab);
  const [iosHelp, setIosHelp] = useState(false);

  // Mi lista sale de Dexie antes del primer pintado (ver `main.tsx`): ya tiene sus datos.
  useLayoutEffect(() => measureListVisible(), []);

  const releases = useReleases(entries, params);
  const sections = useMemo(
    () => buildSections(entries, params, releases.lookup ?? undefined),
    [entries, params, releases.lookup],
  );
  const counts = useMemo(() => countViews(entries, params.purchase), [entries, params.purchase]);
  // Las pestañas: las vistas de la barra lateral, con los estados detrás de Pendientes (§10.56).
  const tabViews = useMemo(() => {
    const totals = params.purchase === 'any' ? counts : countViews(entries, 'any');
    return tabViewsOf(shownViewGroups(totals, params.view));
  }, [entries, params.purchase, params.view, counts]);
  const upcomingCount = useMemo(
    () => countUpcoming(entries, params.purchase, releases.upcoming),
    [entries, params.purchase, releases.upcoming],
  );
  const byRelease = params.view === 'upcoming' || params.order === 'release';
  const releasesPending = byRelease && releases.lookup === null;
  const today = releases.lookup?.today ?? 0;
  /** Los `id` a la vista, en orden: ↑ y ↓, Inicio y Fin, y `J` y `K` en la ficha. */
  const visibleIds = useMemo(
    () =>
      sections.flatMap((section) =>
        section.collapsible && !showOnHold ? [] : section.entries.map((entry) => entry.id),
      ),
    [sections, showOnHold],
  );
  const rovingId = activeId !== null && visibleIds.includes(activeId) ? activeId : visibleIds[0];
  /** Las tarjetas a la vista de cada sección, para ↑ y ↓ en la cuadrícula. */
  const visibleLengths = useMemo(
    () =>
      sections.map((section) => (section.collapsible && !showOnHold ? 0 : section.entries.length)),
    [sections, showOnHold],
  );
  // Antes de medir, el mínimo; la medida llega antes del primer pintado (más abajo).
  const columns = grid ? gridColumns(listWidth, GRID_MIN_COLUMNS) : null;
  // Con muchas filas, cada sección pinta solo las cercanas a la pantalla (SectionRows.tsx).
  const virtual = visibleIds.length >= VIRTUAL_FROM;
  /** Mientras se arrastra con el asa: las filas pintadas no cambian. */
  const frozen = useRef(false);
  /** Fila que debe recibir el foco en cuanto esté pintada (↓ hasta una que aún no lo está). */
  const wantFocus = useRef<string | null>(null);

  useEffect(() => publishListOrder(visibleIds), [visibleIds]);
  useEffect(() => () => publishListOrder(null), []);

  // Tras cada pintado: la fila pedida puede acabar de llegar.
  useLayoutEffect(() => {
    const id = wantFocus.current;
    if (id === null) return;
    const title = document.getElementById(rowTitleId(id));
    if (!title) return;
    wantFocus.current = null;
    title.focus();
  });

  /** Pone el foco en la fila; si aún no está pintada, la pinta antes (pasa a ser la activa). */
  function focusRow(id: string): void {
    const title = document.getElementById(rowTitleId(id));
    if (title) {
      title.focus();
      return;
    }
    wantFocus.current = id;
    setActiveId(id);
  }

  function update(patch: Partial<ListParams>): void {
    const next = listSearchParams({ ...params, ...patch });
    settings.update({ listSearch: next.toString() });
    navigate(withSearch('/', next), { replace: true });
  }

  // Cualquier cambio cierra la bandeja de marcas.
  const actions = useMemo<RowActions>(
    () => ({
      setStatus(id, status, timing) {
        setTrayId(null);
        const restore = keepFocusNear(listRef.current, id);
        commands.setStatus(id, status, timing);
        restore();
      },
      setFlag(id, flag, value, timing) {
        setTrayId(null);
        const restore = keepFocusNear(listRef.current, id);
        commands.setFlag(id, flag, value, timing);
        restore();
      },
      move(id, to, timing) {
        setTrayId(null);
        commands.move(id, to, timing);
      },
      remove(id, timing) {
        setTrayId(null);
        const restore = keepFocusNear(listRef.current, id);
        commands.remove(id, timing);
        restore();
      },
    }),
    [commands],
  );

  const hasRows = entries.length > 0 && !releasesPending && sections.length > 0;

  // El ancho de la lista, con la cuadrícula a la vista: antes de pintar, así no salta de columnas.
  useLayoutEffect(() => {
    const element = listRef.current;
    if (!grid || !hasRows || !element) return;
    const observer = new ResizeObserver(() => setListWidth(element.clientWidth));
    observer.observe(element);
    setListWidth(element.clientWidth);
    return () => observer.disconnect();
  }, [grid, hasRows]);
  // Las filas se deslizan a su sitio nuevo y la recién apuntada destella (DECISIONES §10.44).
  const motion = useListMotion(
    listRef,
    agenda,
    entries,
    `${params.view}|${params.order}|${params.purchase}|${params.q}|${showOnHold}|${listLayout}`,
  );
  const gesturesOn = useRef(touchGestures);
  gesturesOn.current = touchGestures;

  // Gestos de las filas y asa `::`: un juego de escuchas para toda la lista (§9.4).
  useEffect(() => {
    const container = listRef.current;
    if (!hasRows || !container) return;
    const detachGestures = attachRowGestures(container, {
      enabled: () => gesturesOn.current,
      advanceLabel: es.gestures.advance,
      flagsLabel: es.gestures.flags,
      onAdvance: (id, status, timing) => actions.setStatus(id, status, timing),
      onRevealFlags: (id) => setTrayId(id),
      // El selector de estado: el menú del botón de estado de la fila.
      onLongPress: (_id, row) => row.querySelector<HTMLButtonElement>('.status-button')?.click(),
    });
    const detachDrag = attachDragReorder(container, {
      onLift: () => {
        frozen.current = true;
      },
      onSettle: () => {
        frozen.current = false;
      },
      // Al soltarla, la fila ya está en su sitio: no hay nada que deslizar.
      onDrop: (id, to, timing) => {
        motion.skipNext();
        actions.move(id, to, timing);
      },
    });
    return () => {
      detachGestures();
      detachDrag();
    };
  }, [hasRows, actions, motion]);

  // La bandeja se cierra al tocar fuera de ella, al desplazar la página y con Esc. Tocar la fila
  // abierta solo la cierra: no abre la ficha.
  useEffect(() => {
    if (trayId === null) return;
    const swallowClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    const close = () => setTrayId(null);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element;
      if (target.closest('.entry-row__tray')) return;
      const row = target.closest<HTMLElement>('.entry-row.is-tray-open');
      if (row) {
        row.addEventListener('click', swallowClick, { capture: true, once: true });
        setTimeout(() => row.removeEventListener('click', swallowClick, true), 600);
      }
      close();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', close, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', close);
    };
  }, [trayId]);

  const onActivate = useCallback((id: string) => setActiveId(id), []);

  /**
   * ↑ y ↓ entre filas; Inicio y Fin; Intro abre la ficha (es un enlace). Desde M3, los atajos de
   * la §9.4 sobre la fila con el foco (en su título o en uno de sus botones): `J` y `K`, `1`–`5`,
   * `C`/`P`/`A`, `N`, `Supr`, `Alt+↑/↓` y `V`. Si la fila sale de la vista, el foco pasa a la
   * siguiente, como con los botones. En la cuadrícula, ← y → van a la de al lado, y ↑ y ↓, a la
   * fila de arriba o de abajo (grid-nav.ts).
   */
  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLElement>('[data-entry-id]');
    const title = row?.querySelector<HTMLElement>('[data-row-title]');
    const id = row?.dataset.entryId;
    if (!row || !title || id === undefined) return;
    // Por `id` y no por las filas del DOM: con muchas, solo están pintadas las cercanas.
    const index = visibleIds.indexOf(id);
    const go = (next: number) => {
      const target = visibleIds[Math.max(0, Math.min(visibleIds.length - 1, next))];
      if (target !== undefined) focusRow(target);
      event.preventDefault();
    };
    // Con Alt, las flechas son la prioridad (más abajo).
    if (target === title && !event.altKey) {
      if (event.key === 'ArrowDown') {
        go(columns === null ? index + 1 : gridStep(visibleLengths, columns, index, 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        go(columns === null ? index - 1 : gridStep(visibleLengths, columns, index, -1));
        return;
      }
      if (columns !== null && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
        go(index + (event.key === 'ArrowRight' ? 1 : -1));
        return;
      }
      if (event.key === 'Home') {
        go(0);
        return;
      }
      if (event.key === 'End') {
        go(visibleIds.length - 1);
        return;
      }
    }
    if (event.defaultPrevented || !isShortcutTarget(target)) return;
    const action = shortcutFor(event, singleKeyShortcuts);
    const entry = entries.find((candidate) => candidate.id === id);
    if (!action || !entry) return;
    const timing = { feedbackStart: event.timeStamp };
    switch (action.kind) {
      case 'next':
        go(index + 1);
        return;
      case 'previous':
        go(index - 1);
        return;
      case 'status':
        event.preventDefault();
        actions.setStatus(id, action.status, timing);
        return;
      case 'flag':
        event.preventDefault();
        actions.setFlag(id, action.flag, entry.flags[action.flag] !== true, timing);
        return;
      case 'remove':
        event.preventDefault();
        actions.remove(id, timing);
        return;
      case 'priority': {
        const section = sections.find((s) => s.entries.some((e) => e.id === id));
        if (!section || !isMovable(section, params)) return;
        event.preventDefault();
        commands.move(id, action.to, timing);
        // React puede mover el nodo de la fila al reordenar, y el foco se perdería.
        requestAnimationFrame(() => document.getElementById(rowTitleId(id))?.focus());
        return;
      }
      case 'note':
        event.preventDefault();
        requestNoteFocus(id);
        navigate(gamePath(id));
        return;
      case 'steam': {
        const appid = appidOf(id);
        if (appid === null) return;
        event.preventDefault();
        openSteam(appid);
        return;
      }
    }
  }

  const total = entries.length;
  const filtered = params.view !== 'pending' || params.purchase !== 'any' || params.q !== '';
  // El aviso de iOS ya ofrece exportar: no salen los dos a la vez.
  const copyDue = iosNotice ? null : copyReminderDue(copyState, openedAt, total > 0);

  /** Al irse el aviso con el botón enfocado, el foco pasa a la pantalla (ver §9.7, 2.4.11). */
  function focusMain(): void {
    requestAnimationFrame(() => document.getElementById('main')?.focus());
  }

  async function exportCopy(): Promise<void> {
    try {
      const data = await import('../../data/data-actions.ts');
      const name = data.exportJson({ agenda, settings, appVersion: __APP_VERSION__, copyReminder });
      notices.notify(es.toast.exported(name));
      focusMain();
    } catch (error) {
      logError('storage', error);
      notices.notify(es.notices.storageFailed);
    }
  }

  return (
    <div className="screen my-list">
      <header className="screen__header">
        <ScreenHeading primary={primary}>{es.list.title}</ScreenHeading>
        {total > 0 && (
          <div className="my-list__tools">
            <ViewToggle
              value={listLayout}
              onChange={(mode) => settings.update({ listLayout: mode })}
            />
            {/* Próximos siempre va por lanzamiento. */}
            {params.view !== 'upcoming' && (
              <ChoiceMenu
                className="list-order"
                align="end"
                label={es.list.order}
                value={params.order}
                options={LIST_ORDERS.map((order) => ({
                  value: order,
                  label: es.list.orderOption[order],
                }))}
                onChange={(order) => update({ order })}
              />
            )}
          </div>
        )}
      </header>

      {/* Con la agenda vacía no hay nada que perder: el aviso espera al primer juego. */}
      {iosNotice && total > 0 && (
        <div className="notice notice--ios">
          <p>{es.notices.ios}</p>
          <button
            type="button"
            className="btn"
            aria-expanded={iosHelp}
            onClick={() => setIosHelp(!iosHelp)}
          >
            {es.notices.iosHow}
          </button>
          <Link to={settingsPath('data')} className="btn">
            {es.notices.export}
          </Link>
          <button
            type="button"
            className="icon-btn"
            aria-label={es.notices.dismiss}
            onClick={() => setIosNotice(false)}
          >
            <Icon name="close" />
          </button>
          {iosHelp && <p className="notice__detail">{es.notices.iosSteps}</p>}
        </div>
      )}

      {copyDue && (
        <div className="notice notice--copy">
          <p>{copyDue.copied ? es.notices.copyOld(copyDue.days) : es.notices.copyNever}</p>
          <button type="button" className="btn btn--primary" onClick={() => void exportCopy()}>
            {es.notices.export}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              copyReminder.snooze(Date.now());
              focusMain();
            }}
          >
            {es.notices.later}
          </button>
        </div>
      )}

      {total > 0 && (
        <div className="list-filters">
          {/* biome-ignore lint/a11y/useSemanticElements: grupo de botones de alternar. */}
          <div className="chips" role="group" aria-label={es.list.views}>
            {tabViews.map((view) => {
              // El de Próximos sale cuando se saben las fechas; su hueco ya está reservado.
              const count = view === 'upcoming' ? upcomingCount : counts[view];
              return (
                <button
                  key={view}
                  type="button"
                  className="chip-button"
                  aria-pressed={params.view === view}
                  onClick={() => update({ view })}
                >
                  {es.list.view[view]}{' '}
                  <span className="chip-button__count" data-view={view}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="list-filters__row">
            {/* biome-ignore lint/a11y/useSemanticElements: grupo de botones de alternar. */}
            <div className="chips" role="group" aria-label={es.list.purchase}>
              <span className="chips__label" aria-hidden="true">
                {es.list.purchase}:
              </span>
              {PURCHASE_FILTERS.map((purchase) => (
                <button
                  key={purchase}
                  type="button"
                  className="chip-button"
                  aria-pressed={params.purchase === purchase}
                  onClick={() => update({ purchase })}
                >
                  {es.list.purchaseOption[purchase]}
                </button>
              ))}
            </div>
            <label className="list-filter">
              <span className="visually-hidden">{es.list.filter}</span>
              <input
                className="field"
                type="text"
                value={params.q}
                placeholder={es.list.filterPlaceholder}
                data-filter-field=""
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => update({ q: event.target.value })}
              />
            </label>
          </div>
        </div>
      )}

      {total === 0 ? (
        <div className="empty-state">
          <EmptyText />
          <button
            type="button"
            className="empty-state__capture"
            onClick={(event) => palette.open(event.timeStamp)}
          >
            <Icon name="search" />
            <span>{es.list.emptyCapture}</span>
            <kbd className="empty-state__kbd">{es.palette.shortcut}</kbd>
          </button>
          <Link to="/catalogo" className="btn">
            {es.list.exploreCatalog}
          </Link>
        </div>
      ) : releasesPending ? (
        <ListSkeleton
          label={params.view === 'upcoming' ? es.list.upcoming.loading : es.list.releaseLoading}
          columns={columns}
        />
      ) : sections.length === 0 ? (
        <div className="empty-state">
          {params.view === 'upcoming' && params.purchase === 'any' && params.q === '' ? (
            // Sin filtros que quitar: lleva a lo que sale pronto en el catálogo (revisión del
            // 16-11-2026; antes ofrecía «Quitar los filtros» sin ninguno puesto).
            <>
              <p>{es.list.upcoming.empty}</p>
              <Link to="/catalogo?filtro=proximamente" className="btn">
                {es.list.upcoming.browse}
              </Link>
            </>
          ) : (
            <>
              <p>{es.list.noMatches}</p>
              {filtered && (
                <button type="button" className="btn" onClick={() => update(parseListParams(''))}>
                  {es.list.clearFilters}
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        // biome-ignore lint/a11y/noStaticElementInteractions: ↑ y ↓ de las filas (tabindex itinerante).
        <div
          ref={listRef}
          className="list-sections"
          data-layout={listLayout}
          data-gestures={touchGestures ? 'on' : 'off'}
          onKeyDown={onListKeyDown}
        >
          {sections.map((section) => {
            const label = sectionLabel(section);
            const headingId = `${filterId}-${section.key}`;
            const collapsed = section.collapsible && !showOnHold;
            const movable = isMovable(section, params);
            return (
              <section
                key={section.key}
                className="list-section"
                data-section={section.key}
                aria-labelledby={headingId}
              >
                <div className="list-section__header">
                  <h2 id={headingId}>{es.list.sectionCount(label, section.entries.length)}</h2>
                  {movable && section.entries.length > 1 && (
                    <span className="list-section__hint" aria-hidden="true">
                      <span className="list-section__hint-fine">
                        {grid ? es.list.reorderHintGrid : es.list.reorderHint}
                      </span>
                      <span className="list-section__hint-touch">
                        {grid ? es.list.reorderHintGridTouch : es.list.reorderHintTouch}
                      </span>
                    </span>
                  )}
                  {section.collapsible && (
                    <button
                      type="button"
                      className="btn btn--ghost"
                      aria-expanded={!collapsed}
                      aria-controls={`${headingId}-rows`}
                      onClick={() => setShowOnHold(!showOnHold)}
                    >
                      {collapsed ? es.list.show : es.list.hide}
                      <span className="visually-hidden"> {label}</span>
                    </button>
                  )}
                </div>
                <SectionRows
                  id={`${headingId}-rows`}
                  hidden={collapsed}
                  entries={section.entries}
                  virtual={virtual}
                  keepId={rovingId ?? null}
                  frozen={frozen}
                  columns={columns}
                  renderRow={(entry, index, virtualRow) => {
                    const info = byRelease ? releases.lookup?.get(entry) : null;
                    if (grid) {
                      return (
                        <EntryCard
                          key={entry.id}
                          entry={entry}
                          showRelease={byRelease}
                          release={info ? releaseText(info, today) : null}
                          position={section.ranked ? index + 1 : null}
                          movable={movable}
                          isFirst={index === 0}
                          isLast={index === section.entries.length - 1}
                          active={entry.id === rovingId}
                          actions={actions}
                          onActivate={onActivate}
                          virtual={virtualRow}
                        />
                      );
                    }
                    return (
                      <EntryRow
                        key={entry.id}
                        entry={entry}
                        release={info ? releaseText(info, today) : null}
                        position={section.ranked ? index + 1 : null}
                        movable={movable}
                        isFirst={index === 0}
                        isLast={index === section.entries.length - 1}
                        active={entry.id === rovingId}
                        trayOpen={entry.id === trayId}
                        actions={actions}
                        onActivate={onActivate}
                        virtual={virtualRow}
                      />
                    );
                  }}
                />
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
