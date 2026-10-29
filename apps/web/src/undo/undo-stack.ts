// Pila de Deshacer (ver §9.5, regla 2): 20 niveles; Deshacer no caduca con el aviso (WCAG 2.2.1).

export const UNDO_LIMIT = 20;

export interface UndoEntry {
  readonly id: number;
  readonly message: string;
  readonly undo: () => void;
}

export interface UndoStack {
  push(message: string, undo: () => void): UndoEntry;
  /** Saca el último cambio (`Ctrl+Z` o «Deshacer último cambio»). */
  pop(): UndoEntry | undefined;
  /** Saca un cambio concreto (botón Deshacer de su aviso). */
  take(id: number): UndoEntry | undefined;
  has(id: number): boolean;
  readonly size: number;
  subscribe(listener: () => void): () => void;
}

export function createUndoStack(limit = UNDO_LIMIT): UndoStack {
  let items: UndoEntry[] = [];
  let nextId = 1;
  const listeners = new Set<() => void>();

  function changed(next: UndoEntry[]): void {
    items = next;
    for (const listener of listeners) listener();
  }

  return {
    push(message, undo) {
      const entry = { id: nextId, message, undo };
      nextId += 1;
      changed([...items, entry].slice(-limit));
      return entry;
    },
    pop() {
      const last = items.at(-1);
      if (last) changed(items.slice(0, -1));
      return last;
    },
    take(id) {
      const entry = items.find((item) => item.id === id);
      if (entry) changed(items.filter((item) => item.id !== id));
      return entry;
    },
    has: (id) => items.some((item) => item.id === id),
    get size() {
      return items.length;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
