// Aviso con Deshacer (RF-10; ver §9.5, regla 2): un aviso a la vista, que dura 8 s y se pausa
// con foco o puntero; detrás, la pila de Deshacer para `Ctrl+Z` y «Deshacer último cambio».
// Otros avisos llevan sus propias acciones (p. ej., «Guardado fallido · Exportar · Reintentar»).
import { es } from '../i18n/es.ts';
import type { FeedbackTiming } from '../perf/measures.ts';
import { createUndoStack, type UndoStack } from '../undo/undo-stack.ts';

export const NOTICE_MS = 8000;

/** Botón de un aviso que no es Deshacer; al pulsarlo, el aviso se cierra. */
export interface NoticeAction {
  readonly label: string;
  run(): void;
}

export interface Notice {
  readonly id: number;
  readonly message: string;
  /** Entrada de la pila que deshace el botón del aviso. */
  readonly undoId: number | null;
  readonly actions: readonly NoticeAction[];
  readonly timing: FeedbackTiming | null;
}

export interface NotifyOptions {
  readonly undo?: (() => void) | null;
  readonly actions?: readonly NoticeAction[];
  readonly timing?: FeedbackTiming;
}

export interface NoticeCenter {
  readonly undoStack: UndoStack;
  notify(message: string, options?: NotifyOptions): void;
  /** `Ctrl+Z` o «Deshacer último cambio». */
  undoLast(timing?: FeedbackTiming): void;
  /** Botón Deshacer del aviso. */
  undoNotice(notice: Notice, timing?: FeedbackTiming): void;
  dismiss(id: number): void;
  getSnapshot(): Notice | null;
  subscribe(listener: () => void): () => void;
}

export function createNoticeCenter(undoStack: UndoStack = createUndoStack()): NoticeCenter {
  let current: Notice | null = null;
  let nextId = 1;
  const listeners = new Set<() => void>();

  function show(
    message: string,
    undoId: number | null,
    timing: FeedbackTiming | null,
    actions: readonly NoticeAction[] = [],
  ): void {
    current = { id: nextId, message, undoId, actions, timing };
    nextId += 1;
    for (const listener of listeners) listener();
  }

  function afterUndo(timing?: FeedbackTiming): void {
    show(es.toast.undone, null, timing ?? null);
  }

  return {
    undoStack,
    notify(message, options = {}) {
      const entry = options.undo ? undoStack.push(message, options.undo) : null;
      show(message, entry?.id ?? null, options.timing ?? null, options.actions);
    },
    undoLast(timing) {
      const entry = undoStack.pop();
      if (!entry) {
        show(es.toast.nothingToUndo, null, timing ?? null);
        return;
      }
      entry.undo();
      afterUndo(timing);
    },
    undoNotice(notice, timing) {
      const entry = notice.undoId === null ? undefined : undoStack.take(notice.undoId);
      if (!entry) return;
      entry.undo();
      afterUndo(timing);
    },
    dismiss(id) {
      if (current?.id !== id) return;
      current = null;
      for (const listener of listeners) listener();
    },
    getSnapshot: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
