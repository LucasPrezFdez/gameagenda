// Mi lista (RF-09–RF-14; ver §9.1 y §9.3): vista «Pendientes» con secciones, filtros y orden en
// la URL, filas con estado y marcas a un toque y orden manual desde el menú de la fila.
import {
  type KeyboardEvent,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useCommands } from '../../agenda/commands.ts';
import { useAgendaEntries, useCopyReminder, useServices } from '../../app/services.tsx';
import { ChoiceMenu } from '../../components/ChoiceMenu.tsx';
import { Icon } from '../../components/icons.tsx';
import { ScreenHeading } from '../../components/ScreenHeading.tsx';
import { copyReminderDue } from '../../data/copy-reminder.ts';
import { logError } from '../../errors/error-log.ts';
import { es } from '../../i18n/es.ts';
import { isIosBrowserTab } from '../../lib/hooks.ts';
import { measureListVisible } from '../../perf/measures.ts';
import { Link, navigate, useLocation } from '../../router/router.tsx';
import { settingsPath, withSearch } from '../../router/routes.ts';
import { EntryRow, type RowActions, rowTitleId } from './EntryRow.tsx';
import {
  buildSections,
  countViews,
  LIST_ORDERS,
  LIST_VIEWS,
  type ListParams,
  listSearchParams,
  PURCHASE_FILTERS,
  parseListParams,
} from './list-model.ts';

/** Si una acción saca la fila enfocada de la vista, el foco pasa a la siguiente (ver §9.5). */
function keepFocusNear(container: HTMLElement | null, id: string): () => void {
  const titles = container
    ? [...container.querySelectorAll<HTMLElement>('[data-row-title]')].map((el) => el.id)
    : [];
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
  const { agenda, settings, notices, copyReminder } = useServices();
  const copyState = useCopyReminder();
  // La hora de cuando se abre Mi lista: el aviso no cambia mientras se mira.
  const [openedAt] = useState(Date.now);
  const { search } = useLocation();
  const params = useMemo(() => parseListParams(search), [search]);
  const listRef = useRef<HTMLDivElement>(null);
  const filterId = useId();
  const [showOnHold, setShowOnHold] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [iosNotice, setIosNotice] = useState(isIosBrowserTab);
  const [iosHelp, setIosHelp] = useState(false);

  // Mi lista sale de Dexie antes del primer pintado (ver `main.tsx`): ya tiene sus datos.
  useLayoutEffect(() => measureListVisible(), []);

  const sections = useMemo(() => buildSections(entries, params), [entries, params]);
  const counts = useMemo(() => countViews(entries, params.purchase), [entries, params.purchase]);
  const visibleIds = sections.flatMap((section) =>
    section.collapsible && !showOnHold ? [] : section.entries.map((entry) => entry.id),
  );
  const rovingId = activeId !== null && visibleIds.includes(activeId) ? activeId : visibleIds[0];

  function update(patch: Partial<ListParams>): void {
    const next = listSearchParams({ ...params, ...patch });
    settings.update({ listSearch: next.toString() });
    navigate(withSearch('/', next), { replace: true });
  }

  const actions = useMemo<RowActions>(
    () => ({
      setStatus(id, status, timing) {
        const restore = keepFocusNear(listRef.current, id);
        commands.setStatus(id, status, timing);
        restore();
      },
      setFlag(id, flag, value, timing) {
        const restore = keepFocusNear(listRef.current, id);
        commands.setFlag(id, flag, value, timing);
        restore();
      },
      move(id, to, timing) {
        commands.move(id, to, timing);
      },
      remove(id, timing) {
        const restore = keepFocusNear(listRef.current, id);
        commands.remove(id, timing);
        restore();
      },
    }),
    [commands],
  );

  const onActivate = useCallback((id: string) => setActiveId(id), []);

  /** ↑ y ↓ entre filas; Inicio y Fin; Intro abre la ficha (es un enlace). */
  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const target = event.target as HTMLElement;
    if (!target.matches('[data-row-title]')) return;
    const titles = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-row-title]') ?? [])];
    const index = titles.indexOf(target);
    const go = (next: number) => {
      const element = titles[Math.max(0, Math.min(titles.length - 1, next))];
      element?.focus();
      event.preventDefault();
    };
    if (event.key === 'ArrowDown') go(index + 1);
    else if (event.key === 'ArrowUp') go(index - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(titles.length - 1);
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
          <ChoiceMenu
            className="list-order"
            label={es.list.order}
            value={params.order}
            options={LIST_ORDERS.map((order) => ({
              value: order,
              label: es.list.orderOption[order],
            }))}
            onChange={(order) => update({ order })}
          />
        )}
      </header>

      {iosNotice && (
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
            {LIST_VIEWS.map((view) => (
              <button
                key={view}
                type="button"
                className="chip-button"
                aria-pressed={params.view === view}
                onClick={() => update({ view })}
              >
                {es.list.view[view]} <span className="chip-button__count">{counts[view]}</span>
              </button>
            ))}
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
          <p>{es.list.empty}</p>
          <Link to="/catalogo" className="btn btn--primary">
            {es.list.exploreCatalog}
          </Link>
        </div>
      ) : sections.length === 0 ? (
        <div className="empty-state">
          <p>{es.list.noMatches}</p>
          {filtered && (
            <button type="button" className="btn" onClick={() => update(parseListParams(''))}>
              {es.list.clearFilters}
            </button>
          )}
        </div>
      ) : (
        // biome-ignore lint/a11y/noStaticElementInteractions: ↑ y ↓ de las filas (tabindex itinerante).
        <div ref={listRef} className="list-sections" onKeyDown={onListKeyDown}>
          {sections.map((section) => {
            const label = section.id === null ? es.list.allEntries : es.list.section[section.id];
            const headingId = `${filterId}-${section.id ?? 'all'}`;
            const collapsed = section.collapsible && !showOnHold;
            const movable =
              params.order === 'priority' &&
              (section.id === 'want_to_play' || section.id === 'next');
            return (
              <section
                key={section.id ?? 'all'}
                className="list-section"
                aria-labelledby={headingId}
              >
                <div className="list-section__header">
                  <h2 id={headingId}>{es.list.sectionCount(label, section.entries.length)}</h2>
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
                <ol id={`${headingId}-rows`} className="entry-list" hidden={collapsed}>
                  {!collapsed &&
                    section.entries.map((entry, index) => (
                      <EntryRow
                        key={entry.id}
                        entry={entry}
                        position={section.ranked ? index + 1 : null}
                        movable={movable}
                        isFirst={index === 0}
                        isLast={index === section.entries.length - 1}
                        active={entry.id === rovingId}
                        actions={actions}
                        onActivate={onActivate}
                      />
                    ))}
                </ol>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
