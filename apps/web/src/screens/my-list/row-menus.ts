// Los dos menús de un juego de Mi lista, el del estado y el de «…»: los mismos en la fila
// (EntryRow.tsx) y en la tarjeta de la cuadrícula (EntryCard.tsx, DECISIONES §10.53).
import {
  type AgendaEntry,
  FLAGS,
  type Flag,
  type MoveTarget,
  STATUSES,
  type Status,
} from '../../agenda/types.ts';
import type { MenuItem } from '../../components/MenuButton.tsx';
import { es } from '../../i18n/es.ts';
import type { FeedbackTiming } from '../../perf/measures.ts';

/** Lo que una fila o una tarjeta pide a la agenda; la pantalla lo conecta con `useCommands()`. */
export interface RowActions {
  setStatus(id: string, status: Status, timing: FeedbackTiming): void;
  setFlag(id: string, flag: Flag, value: boolean, timing: FeedbackTiming): void;
  move(id: string, to: MoveTarget, timing: FeedbackTiming): void;
  remove(id: string, timing: FeedbackTiming): void;
}

/** Dónde está el juego en su sección, para el orden manual. */
export interface RowPlace {
  /** Se puede reordenar desde el menú (orden por prioridad). */
  readonly movable: boolean;
  readonly isFirst: boolean;
  readonly isLast: boolean;
}

export function timingOf(event: { timeStamp: number }): FeedbackTiming {
  return { feedbackStart: event.timeStamp };
}

/** El selector de estado: los seis, con el actual marcado. */
export function statusMenuItems(entry: AgendaEntry, actions: RowActions): MenuItem[] {
  return STATUSES.map((status) => ({
    key: status,
    label: es.status[status],
    icon: status,
    kind: 'radio',
    checked: entry.status === status,
    tone: `status-text--${status}`,
    onSelect: (event) => actions.setStatus(entry.id, status, timingOf(event)),
  }));
}

/** «…»: la prioridad (si se puede ordenar), las marcas y quitar el juego. */
export function entryMenuItems(
  entry: AgendaEntry,
  { movable, isFirst, isLast }: RowPlace,
  actions: RowActions,
): MenuItem[] {
  const moveItems: MenuItem[] = movable
    ? [
        { key: 'up', label: es.list.moveUp, disabled: isFirst },
        { key: 'down', label: es.list.moveDown, disabled: isLast },
        { key: 'top', label: es.list.moveTop, disabled: isFirst },
        { key: 'bottom', label: es.list.moveBottom, disabled: isLast },
      ].map((item) => ({
        ...item,
        onSelect: (event) => actions.move(entry.id, item.key as MoveTarget, timingOf(event)),
      }))
    : [];
  const flagItems: MenuItem[] = FLAGS.map((flag) => ({
    key: `flag-${flag}`,
    label: es.flag[flag],
    icon: flag,
    kind: 'checkbox',
    checked: entry.flags[flag] === true,
    onSelect: (event) =>
      actions.setFlag(entry.id, flag, entry.flags[flag] !== true, timingOf(event)),
  }));
  return [
    ...moveItems,
    ...flagItems,
    {
      key: 'remove',
      label: es.list.remove,
      onSelect: (event) => actions.remove(entry.id, timingOf(event)),
    },
  ];
}
