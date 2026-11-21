// Fila de Mi lista. Se repinta solo si cambian `id`, `lastHlc` o su papel en la lista (ver §9.5).
// El contenido va en `.entry-row__body`, que es lo que se desliza con el dedo (§9.4): detrás
// asoma el fondo de la fila con lo que va a pasar y, al deslizarla a la izquierda, la bandeja de
// marcas. Los gestos y el asa `::` los atiende la pantalla, con un solo juego de escuchas.
import { memo } from 'react';
import { type AgendaEntry, appidOf, type DateField, FLAGS } from '../../agenda/types.ts';
import { Cover, FlagBadges } from '../../components/bits.tsx';
import { Icon } from '../../components/icons.tsx';
import { MenuButton } from '../../components/MenuButton.tsx';
import { formatAgendaDay } from '../../details/release-text.ts';
import { es } from '../../i18n/es.ts';
import { popIcon } from '../../lib/motion.ts';
import { Link } from '../../router/router.tsx';
import { gamePath } from '../../router/routes.ts';
import { rowDate } from './list-model.ts';
import { entryMenuItems, type RowActions, statusMenuItems, timingOf } from './row-menus.ts';
import type { VirtualRowProps } from './SectionRows.tsx';

export type { RowActions } from './row-menus.ts';

export interface EntryRowProps {
  readonly entry: AgendaEntry;
  /** Lanzamiento (Próximos y orden por lanzamiento), o `null`. */
  readonly release?: string | null;
  /** Número de prioridad en Quiero jugar, o `null`. */
  readonly position: number | null;
  /** Se puede reordenar desde el menú (orden por prioridad). */
  readonly movable: boolean;
  readonly isFirst: boolean;
  readonly isLast: boolean;
  /** Fila del *tabindex* itinerante: solo ella está en el orden de tabulación. */
  readonly active: boolean;
  /** Deslizada a la izquierda: enseña la bandeja de marcas. */
  readonly trayOpen?: boolean;
  readonly actions: RowActions;
  readonly onActivate: (id: string) => void;
  /** Con la sección virtual (muchas filas): su posición y el total, para el lector de pantalla. */
  readonly virtual?: VirtualRowProps;
}

export function rowTitleId(id: string): string {
  return `row-${id}`;
}

function EntryRowView({
  entry,
  release = null,
  position,
  movable,
  isFirst,
  isLast,
  active,
  trayOpen = false,
  actions,
  onActivate,
  virtual,
}: EntryRowProps) {
  const tab = active ? 0 : -1;
  const timing = timingOf;
  const statusItems = statusMenuItems(entry, actions);
  const rowMenu = entryMenuItems(entry, { movable, isFirst, isLast }, actions);

  return (
    <li
      className={`entry-row${trayOpen ? ' is-tray-open' : ''}`}
      data-status={entry.status}
      data-entry-id={entry.id}
      data-index={virtual?.index}
      aria-setsize={virtual?.setSize}
      aria-posinset={virtual === undefined ? undefined : virtual.index + 1}
      onFocusCapture={() => onActivate(entry.id)}
    >
      <div className="entry-row__body">
        {movable && !(isFirst && isLast) && (
          <span
            className="entry-row__handle"
            data-drag-handle=""
            aria-hidden="true"
            title={es.list.dragHandle}
          >
            <Icon name="grip" />
          </span>
        )}
        {position !== null && (
          <span className="entry-row__rank" aria-hidden="true">
            {position}
          </span>
        )}
        <Cover title={entry.title} appid={appidOf(entry.id)} />
        <div className="entry-row__main">
          <Link
            id={rowTitleId(entry.id)}
            to={gamePath(entry.id)}
            className="entry-row__title"
            tabIndex={tab}
            data-row-title=""
          >
            {position !== null && (
              <span className="visually-hidden">{es.list.priority(position)}: </span>
            )}
            {entry.title}
          </Link>
          {release !== null && <span className="entry-row__release">{release}</span>}
          <FlagBadges entry={entry} />
          {/* Dentro de `__main`: salen sobre el final del título y no le quitan ancho (list.css). */}
          <div className="entry-row__actions">
            {entry.status === 'want_to_play' && (
              <button
                type="button"
                className="btn entry-row__quick"
                tabIndex={tab}
                onClick={(event) => actions.setStatus(entry.id, 'playing', timing(event))}
              >
                <Icon name="playing" />
                {es.list.start}
                <span className="visually-hidden">: {entry.title}</span>
              </button>
            )}
            {FLAGS.map((flag) => (
              <button
                key={flag}
                type="button"
                className={`icon-btn flag-toggle flag-toggle--${flag}`}
                aria-pressed={entry.flags[flag] === true}
                aria-label={es.toggleFlag(flag, entry.title)}
                tabIndex={tab}
                onClick={(event) => {
                  if (entry.flags[flag] !== true) popIcon(event.currentTarget);
                  actions.setFlag(entry.id, flag, entry.flags[flag] !== true, timing(event));
                }}
              >
                <Icon name={flag} />
              </button>
            ))}
          </div>
        </div>
        <RowNote note={entry.note} />
        <RowFacts entry={entry} />
        <MenuButton
          label={es.changeStatus(entry.status, entry.title)}
          items={statusItems}
          buttonClassName={`status-button status-text status-text--${entry.status}`}
          tabIndex={tab}
        >
          <Icon name={entry.status} />
          <span className="status-button__label">{es.status[entry.status]}</span>
          <Icon name="chevronDown" className="icon status-button__chevron" />
        </MenuButton>
        <MenuButton label={es.list.rowMenu(entry.title)} items={rowMenu} tabIndex={tab} />
      </div>
      {trayOpen && (
        // biome-ignore lint/a11y/useSemanticElements: grupo de botones de alternar.
        <div className="entry-row__tray" role="group" aria-label={es.gestures.tray(entry.title)}>
          {FLAGS.map((flag) => (
            <button
              key={flag}
              type="button"
              className={`entry-row__tray-button flag-toggle flag-toggle--${flag}`}
              aria-pressed={entry.flags[flag] === true}
              onClick={(event) => {
                if (entry.flags[flag] !== true) popIcon(event.currentTarget);
                actions.setFlag(entry.id, flag, entry.flags[flag] !== true, timing(event));
              }}
            >
              <Icon name={flag} />
              <span>{es.flag[flag]}</span>
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

export const EntryRow = memo(
  EntryRowView,
  (a, b) =>
    a.entry.id === b.entry.id &&
    a.entry.lastHlc === b.entry.lastHlc &&
    a.release === b.release &&
    a.position === b.position &&
    a.movable === b.movable &&
    a.isFirst === b.isFirst &&
    a.isLast === b.isLast &&
    a.active === b.active &&
    a.trayOpen === b.trayOpen &&
    a.actions === b.actions &&
    a.onActivate === b.onActivate &&
    a.virtual?.index === b.virtual?.index &&
    a.virtual?.setSize === b.virtual?.setSize,
);

/** Las fechas que tienen columna propia con la lista muy ancha (DECISIONES §10.54). */
const COLUMN_DATES: readonly DateField[] = ['addedAt', 'startedAt', 'completedAt'];

/** Una celda: su nombre encima, en pequeño, y el valor; vacía, conserva el ancho. */
function Fact({ label, value, kind }: { label: string; value: string | null; kind: string }) {
  return (
    <span className={`entry-row__fact entry-row__fact--${kind}`}>
      {value !== null && (
        <>
          <span className="entry-row__fact-label">{label}</span> {value}
        </>
      )}
    </span>
  );
}

/**
 * Las columnas entre el título y el estado, que crecen con el ancho de la lista (*container
 * queries* de list.css); por debajo de 880 px no se ven y están en la ficha.
 *   - desde 880 px (revisión responsive del 20-11-2026): «Juego en» y la fecha que toca según el
 *     estado (`rowDate`);
 *   - desde 1 280 px (DECISIONES §10.54, pedido por el usuario): «Juego en» y las tres fechas,
 *     Apuntado, Empezado y Completado, cada una en su columna.
 * Las celdas vacías conservan su ancho, para que las columnas no se tuerzan.
 */
function RowFacts({ entry }: { entry: AgendaEntry }) {
  const date = rowDate(entry);
  return (
    <span className="entry-row__facts">
      <Fact
        kind="platform"
        label={es.game.platform}
        value={entry.platform === null ? null : es.platform[entry.platform]}
      />
      <Fact
        kind="date"
        label={date === null ? '' : es.game.date[date.field]}
        value={date === null ? null : formatAgendaDay(date.day)}
      />
      {COLUMN_DATES.map((field) => {
        const day = entry[field];
        return (
          <Fact
            key={field}
            kind="column"
            label={es.game.date[field]}
            value={day === null || day === '' ? null : formatAgendaDay(day)}
          />
        );
      })}
    </span>
  );
}

/**
 * La nota, desde 1 600 px y en una línea: ocupa el hueco entre el título y las columnas (DECISIONES
 * §10.54). Entera, en la ficha.
 */
function RowNote({ note }: { note: string }) {
  if (note.trim() === '') return <span className="entry-row__note" />;
  return (
    <span className="entry-row__note">
      <span className="entry-row__fact-label">{es.game.note}</span> {note}
    </span>
  );
}
