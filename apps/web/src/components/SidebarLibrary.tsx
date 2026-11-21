// Lo que llena la barra lateral del PC debajo de las secciones (DECISIONES §10.33, propuesta del
// 06-11-2026): las vistas de Mi lista con su contador (como las listas de Things), «Jugando ahora» y
// «A continuación» con portadas pequeñas (como la biblioteca de Spotify o de Steam) y un pie con los
// atajos y el estado del catálogo. En el móvil no se ve: allí la barra lateral no tiene caja.
import { formatCount } from '@gameagenda/core';
import { useMemo } from 'react';
import { appidOf } from '../agenda/types.ts';
import { useAgendaEntries, useCatalogStatus } from '../app/services.tsx';
import { es } from '../i18n/es.ts';
import { Link } from '../router/router.tsx';
import { gamePath, withSearch } from '../router/routes.ts';
import {
  buildSections,
  countUpcoming,
  countViews,
  DEFAULT_LIST_PARAMS,
  type ListParams,
  type ListView,
  listSearchParams,
  shownViewGroups,
} from '../screens/my-list/list-model.ts';
import { useReleases } from '../screens/my-list/use-releases.ts';
import { useOpenShortcutHelp } from '../shortcuts/ShortcutHelp.tsx';
import { Cover } from './bits.tsx';
import { Icon } from './icons.tsx';

const SHELF_SIZE = 4;

const PENDING: ListParams = { ...DEFAULT_LIST_PARAMS, view: 'pending' };

export function SidebarLibrary({
  listParams,
  onList,
  collapsed,
}: {
  /** La última vista, filtros y orden de Mi lista: los enlaces los conservan, como las pestañas. */
  listParams: ListParams;
  /** En Mi lista: marca la vista abierta. */
  onList: boolean;
  collapsed: boolean;
}) {
  const entries = useAgendaEntries();
  const status = useCatalogStatus();
  const openHelp = useOpenShortcutHelp();
  const { purchase } = listParams;
  const counts = useMemo(() => countViews(entries, purchase), [entries, purchase]);
  // Qué vistas salen no depende del filtro de compra (ver `shownViewGroups`).
  const totals = useMemo(
    () => (purchase === 'any' ? counts : countViews(entries, 'any')),
    [entries, purchase, counts],
  );
  const groups = shownViewGroups(totals, onList ? listParams.view : null);
  const releases = useReleases(entries, PENDING);
  const upcoming = useMemo(
    () => countUpcoming(entries, purchase, releases.upcoming),
    [entries, purchase, releases.upcoming],
  );
  const shelves = useMemo(() => {
    const sections = buildSections(entries, PENDING);
    return (['playing', 'next'] as const)
      .map((id) => ({
        id,
        entries: (sections.find((section) => section.id === id)?.entries ?? []).slice(
          0,
          SHELF_SIZE,
        ),
      }))
      .filter((shelf) => shelf.entries.length > 0);
  }, [entries]);

  return (
    <div className="sidebar-library">
      <nav className="sidebar-views" aria-labelledby="sidebar-views">
        <h2 id="sidebar-views">{es.sidebar.views}</h2>
        {/* Por etapas (§10.56): las de conjunto, sin título; las demás, con el de su etapa. */}
        {groups.map((group) => {
          const headingId = `sidebar-views-${group.id}`;
          const titled = group.id !== 'overview';
          return (
            <div key={group.id} className="sidebar-views__group">
              {titled && (
                <h3 id={headingId} className="sidebar-views__group-title">
                  {es.sidebar.viewGroup[group.id]}
                </h3>
              )}
              <ul aria-labelledby={titled ? headingId : undefined}>
                {group.views.map((view) => (
                  <li key={view}>
                    <ViewLink
                      view={view}
                      listParams={listParams}
                      current={onList && listParams.view === view}
                      count={view === 'upcoming' ? upcoming : counts[view]}
                    />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>

      {shelves.map((shelf) => (
        <section key={shelf.id} className="sidebar-shelf" aria-labelledby={`sidebar-${shelf.id}`}>
          <h2 id={`sidebar-${shelf.id}`}>{es.list.section[shelf.id]}</h2>
          <ul>
            {shelf.entries.map((entry) => (
              <li key={entry.id}>
                <Link
                  to={gamePath(entry.id)}
                  className="sidebar-shelf__link"
                  title={collapsed ? entry.title : undefined}
                >
                  <Cover title={entry.title} appid={appidOf(entry.id)} size="palette" />
                  <span className="sidebar-shelf__name">{entry.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <footer className="sidebar-footer">
        <button type="button" className="sidebar-footer__help" onClick={openHelp}>
          <Icon name="keyboard" />
          <span>{es.shell.shortcuts}</span>
        </button>
        <p className="sidebar-footer__catalog">
          {status.error
            ? es.sidebar.catalogError
            : status.state === 'full'
              ? es.sidebar.catalog(formatCount(status.count))
              : es.sidebar.catalogLoading}
        </p>
      </footer>
    </div>
  );
}

function ViewLink({
  view,
  listParams,
  current,
  count,
}: {
  view: ListView;
  listParams: ListParams;
  current: boolean;
  /** `null` mientras no se sepa (Próximos): el hueco del contador ya está (§9.5). */
  count: number | null;
}) {
  return (
    <Link
      to={withSearch('/', listSearchParams({ ...listParams, view }))}
      className="sidebar-views__link"
      aria-current={current ? 'page' : undefined}
    >
      <span className={`sidebar-views__dot sidebar-views__dot--${view}`} aria-hidden="true" />
      <span className="sidebar-views__label">{es.list.view[view]}</span>
      <span className="sidebar-views__count">{count}</span>
    </Link>
  );
}
