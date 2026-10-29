// Fila de Mi lista. Se repinta solo si cambian `id`, `lastHlc` o su papel en la lista (ver §9.5).
import { memo } from 'react';
import {
  type AgendaEntry,
  FLAGS,
  type Flag,
  type MoveTarget,
  STATUSES,
  type Status,
} from '../../agenda/types.ts';
import { Cover, FlagBadges } from '../../components/bits.tsx';
import { Icon } from '../../components/icons.tsx';
import { MenuButton, type MenuItem } from '../../components/MenuButton.tsx';
import { es } from '../../i18n/es.ts';
import type { FeedbackTiming } from '../../perf/measures.ts';
import { Link } from '../../router/router.tsx';
import { gamePath } from '../../router/routes.ts';

/** Lo que una fila pide a la agenda; la pantalla lo conecta con `useCommands()`. */
export interface RowActions {
  setStatus(id: string, status: Status, timing: FeedbackTiming): void;
  setFlag(id: string, flag: Flag, value: boolean, timing: FeedbackTiming): void;
  move(id: string, to: MoveTarget, timing: FeedbackTiming): void;
  remove(id: string, timing: FeedbackTiming): void;
}

export interface EntryRowProps {
  readonly entry: AgendaEntry;
  /** Número de prioridad en Quiero jugar, o `null`. */
  readonly position: number | null;
  /** Se puede reordenar desde el menú (orden por prioridad). */
  readonly movable: boolean;
  readonly isFirst: boolean;
  readonly isLast: boolean;
  /** Fila del *tabindex* itinerante: solo ella está en el orden de tabulación. */
  readonly active: boolean;
  readonly actions: RowActions;
  readonly onActivate: (id: string) => void;
}

export function rowTitleId(id: string): string {
  return `row-${id}`;
}

function EntryRowView({
  entry,
  position,
  movable,
  isFirst,
  isLast,
  active,
  actions,
  onActivate,
}: EntryRowProps) {
  const tab = active ? 0 : -1;
  const timing = (event: { timeStamp: number }): FeedbackTiming => ({
    feedbackStart: event.timeStamp,
  });

  const statusItems: MenuItem[] = STATUSES.map((status) => ({
    key: status,
    label: es.status[status],
    icon: status,
    kind: 'radio',
    checked: entry.status === status,
    tone: `status-text--${status}`,
    onSelect: (event) => actions.setStatus(entry.id, status, timing(event)),
  }));

  const moveItems: MenuItem[] = movable
    ? [
        { key: 'up', label: es.list.moveUp, disabled: isFirst },
        { key: 'down', label: es.list.moveDown, disabled: isLast },
        { key: 'top', label: es.list.moveTop, disabled: isFirst },
        { key: 'bottom', label: es.list.moveBottom, disabled: isLast },
      ].map((item) => ({
        ...item,
        onSelect: (event) => actions.move(entry.id, item.key as MoveTarget, timing(event)),
      }))
    : [];
  const flagItems: MenuItem[] = FLAGS.map((flag) => ({
    key: `flag-${flag}`,
    label: es.flag[flag],
    icon: flag,
    kind: 'checkbox',
    checked: entry.flags[flag] === true,
    onSelect: (event) => actions.setFlag(entry.id, flag, entry.flags[flag] !== true, timing(event)),
  }));
  const rowMenu: MenuItem[] = [
    ...moveItems,
    ...flagItems,
    {
      key: 'remove',
      label: es.list.remove,
      onSelect: (event) => actions.remove(entry.id, timing(event)),
    },
  ];

  return (
    <li
      className="entry-row"
      data-status={entry.status}
      onFocusCapture={() => onActivate(entry.id)}
    >
      {position !== null && (
        <span className="entry-row__rank" aria-hidden="true">
          {position}
        </span>
      )}
      <Cover title={entry.title} />
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
        <FlagBadges entry={entry} />
      </div>
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
            onClick={(event) =>
              actions.setFlag(entry.id, flag, entry.flags[flag] !== true, timing(event))
            }
          >
            <Icon name={flag} />
          </button>
        ))}
      </div>
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
    </li>
  );
}

export const EntryRow = memo(
  EntryRowView,
  (a, b) =>
    a.entry.id === b.entry.id &&
    a.entry.lastHlc === b.entry.lastHlc &&
    a.position === b.position &&
    a.movable === b.movable &&
    a.isFirst === b.isFirst &&
    a.isLast === b.isLast &&
    a.active === b.active &&
    a.actions === b.actions &&
    a.onActivate === b.onActivate,
);
