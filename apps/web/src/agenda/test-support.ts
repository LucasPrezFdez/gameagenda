// Agenda sobre Dexie con `fake-indexeddb` para las pruebas de Vitest (en Node, sin DOM).
import type { Entry } from '@gameagenda/core/entries';
import { createHlcClock, randomNode } from '@gameagenda/core/sync';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { v7 as uuidv7 } from 'uuid';
import { createDexieAgendaStorage } from '../db/agenda-storage.ts';
import { type GameAgendaDb, openDatabase } from '../db/database.ts';
import { type LocalState, loadLocalState } from '../db/local-state.ts';
import { createAgenda } from './agenda.ts';
import type { AgendaStore } from './types.ts';

export const TODAY = new Date(2026, 9, 29, 12);

export interface TestTab {
  readonly db: GameAgendaDb;
  readonly agenda: AgendaStore;
  readonly state: LocalState;
  close(): Promise<void>;
}

/** Una base nueva (cada `IDBFactory` de `fake-indexeddb` es un «navegador» aparte). */
export function newBrowser(): IDBFactory {
  return new IDBFactory();
}

/** Abre una pestaña: lee Dexie y crea la agenda, como `main.tsx`. */
export async function openTab(
  browser: IDBFactory,
  options: { now?: () => Date; onStorageError?: (error: unknown) => void } = {},
): Promise<TestTab> {
  const db = openDatabase({ indexedDB: browser, IDBKeyRange });
  const state = await loadLocalState(db);
  const clock = createHlcClock({
    now: Date.now,
    node: randomNode(Math.random),
    snapshot: state.clock,
  });
  const agenda = createAgenda({
    entries: state.entries,
    clock,
    newId: uuidv7,
    storage: createDexieAgendaStorage(db, uuidv7),
    now: options.now ?? (() => TODAY),
    onStorageError: options.onStorageError,
  });
  return {
    db,
    agenda,
    state,
    async close() {
      await agenda.whenIdle();
      agenda.dispose();
      db.close();
    },
  };
}

/** Todas las entradas por id, para comparar estados completos (HLC incluidas). */
export function byId(entries: readonly Entry[]): Entry[] {
  return [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Valores visibles de una entrada: sin HLC y con solo las marcas activas. */
export function values(entry: Entry | undefined) {
  if (entry === undefined) return undefined;
  const { hlc: _hlc, lastHlc: _lastHlc, flags, ...rest } = entry;
  return { ...rest, flags: Object.fromEntries(Object.entries(flags).filter(([, v]) => v)) };
}
