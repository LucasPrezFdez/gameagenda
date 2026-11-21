// Tarjeta de Mi lista en la cuadrícula de portadas (DECISIONES §10.53): la portada grande con la
// prioridad y las marcas encima, el nombre (el enlace a la ficha, que cubre toda la tarjeta) y,
// debajo, el estado y «…». Los menús son los de la fila (row-menus.ts). No lleva lo que solo cabe
// en una fila: el asa `::`, deslizar con el dedo y las acciones rápidas, que aquí están en esos dos
// menús, en `Alt+↑/↓` y en los atajos. Se repinta solo si cambia lo mismo que en la fila.
import { memo } from 'react';
import { type AgendaEntry, appidOf, FLAGS } from '../../agenda/types.ts';
import { Cover } from '../../components/bits.tsx';
import { Icon } from '../../components/icons.tsx';
import { MenuButton } from '../../components/MenuButton.tsx';
import { es } from '../../i18n/es.ts';
import { Link } from '../../router/router.tsx';
import { gamePath } from '../../router/routes.ts';
import { rowTitleId } from './EntryRow.tsx';
import { entryMenuItems, type RowActions, statusMenuItems } from './row-menus.ts';
import type { VirtualRowProps } from './SectionRows.tsx';

export interface EntryCardProps {
  readonly entry: AgendaEntry;
  /** Próximos y orden por lanzamiento: la línea de la fecha, reservada en todas las tarjetas. */
  readonly showRelease: boolean;
  readonly release?: string | null;
  /** Número de prioridad en Quiero jugar, o `null`. */
  readonly position: number | null;
  readonly movable: boolean;
  readonly isFirst: boolean;
  readonly isLast: boolean;
  /** Tarjeta del *tabindex* itinerante: solo ella está en el orden de tabulación. */
  readonly active: boolean;
  readonly actions: RowActions;
  readonly onActivate: (id: string) => void;
  readonly virtual?: VirtualRowProps;
}

function EntryCardView({
  entry,
  showRelease,
  release = null,
  position,
  movable,
  isFirst,
  isLast,
  active,
  actions,
  onActivate,
  virtual,
}: EntryCardProps) {
  const tab = active ? 0 : -1;
  const flags = FLAGS.filter((flag) => entry.flags[flag] === true);
  return (
    <li
      className="entry-card"
      data-status={entry.status}
      data-entry-id={entry.id}
      data-index={virtual?.index}
      aria-setsize={virtual?.setSize}
      aria-posinset={virtual === undefined ? undefined : virtual.index + 1}
      onFocusCapture={() => onActivate(entry.id)}
    >
      <span className="entry-card__art">
        <Cover title={entry.title} appid={appidOf(entry.id)} size="card" />
        {position !== null && (
          <span className="entry-card__rank" aria-hidden="true">
            {position}
          </span>
        )}
        {flags.length > 0 && (
          <span className="entry-card__flags">
            {flags.map((flag) => (
              <span key={flag} className={`entry-card__flag chip--${flag}`} title={es.flag[flag]}>
                <Icon name={flag} />
                <span className="visually-hidden">{es.flag[flag]}</span>
              </span>
            ))}
          </span>
        )}
      </span>
      {/* Con su alto fijo: todas las tarjetas miden lo mismo, tenga el nombre una línea o dos. */}
      <div className={`entry-card__text${showRelease ? ' entry-card__text--release' : ''}`}>
        <Link
          id={rowTitleId(entry.id)}
          to={gamePath(entry.id)}
          className="entry-card__title"
          tabIndex={tab}
          data-row-title=""
        >
          {position !== null && (
            <span className="visually-hidden">{es.list.priority(position)}: </span>
          )}
          {entry.title}
        </Link>
        {showRelease && <span className="entry-card__release">{release ?? ''}</span>}
        <div className="entry-card__foot">
          <MenuButton
            label={es.changeStatus(entry.status, entry.title)}
            items={statusMenuItems(entry, actions)}
            buttonClassName={`status-button status-text status-text--${entry.status}`}
            align="start"
            tabIndex={tab}
          >
            <Icon name={entry.status} />
            <span className="status-button__label">{es.status[entry.status]}</span>
            <Icon name="chevronDown" className="icon status-button__chevron" />
          </MenuButton>
          <MenuButton
            label={es.list.rowMenu(entry.title)}
            items={entryMenuItems(entry, { movable, isFirst, isLast }, actions)}
            tabIndex={tab}
          />
        </div>
      </div>
    </li>
  );
}

export const EntryCard = memo(
  EntryCardView,
  (a, b) =>
    a.entry.id === b.entry.id &&
    a.entry.lastHlc === b.entry.lastHlc &&
    a.showRelease === b.showRelease &&
    a.release === b.release &&
    a.position === b.position &&
    a.movable === b.movable &&
    a.isFirst === b.isFirst &&
    a.isLast === b.isLast &&
    a.active === b.active &&
    a.actions === b.actions &&
    a.onActivate === b.onActivate &&
    a.virtual?.index === b.virtual?.index &&
    a.virtual?.setSize === b.virtual?.setSize,
);
