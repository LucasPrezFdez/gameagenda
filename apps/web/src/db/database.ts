// Base local `gameagenda` (Dexie 4.4.7, §7.2): la agenda, su `outbox`, los ajustes y `meta`.
// El Worker de búsqueda abre la misma base con IndexedDB nativo, sin pedir versión, y solo toca
// sus claves de `meta` (`catalog` y, desde M3, `searchIndex`; ver §5.2).
import type { Entry } from '@gameagenda/core/entries';
import type { Op } from '@gameagenda/core/sync';
import { Dexie, type Table } from 'dexie';

export const DB_NAME = 'gameagenda';

/** Esquema de la §7.2 tal cual. Cambiarlo exige una versión nueva con su migración probada. */
export const SCHEMA_V1 = {
  entries: 'id, [view+rank], lastHlc, deletedAt',
  outbox: 'opId, [entryId+field]',
  settings: 'key',
  // hlcClock, catalog, searchIndex, syncCursor, syncState, backup, errorLog, copyReminder…
  meta: 'key',
} as const;

export interface SettingRow {
  readonly key: string;
  readonly value: unknown;
}

export interface MetaRow {
  readonly key: string;
  readonly value: unknown;
}

/** Claves de `meta` que usa la interfaz (`catalog` y `searchIndex` son del Worker). */
export const META_KEYS = {
  hlcClock: 'hlcClock',
  backup: 'backup',
  errorLog: 'errorLog',
  copyReminder: 'copyReminder',
  /** Muestras del panel de rendimiento (Ajustes › Rendimiento, M3). */
  perfSamples: 'perfSamples',
  /**
   * Sincronización (M4, §7.7): `{cursor, purgedSeq, reset, maxSeen, epoch?}`. Lo escribe el
   * motor en la misma transacción en que aplica cada página (ver `src/sync/state.ts`).
   */
  syncCursor: 'syncCursor',
  /**
   * Sincronización (M4): el emparejamiento visto desde este navegador, para Ajustes:
   * `{deviceId, restore, lastSyncAt, lastError, unpairedBy}` (ver `src/sync/state.ts`).
   * Sin esta clave y sin el indicio `__Host-ga_sync`, la sincronización está apagada.
   */
  syncState: 'syncState',
  /**
   * `resolve` (M4): a cuándo se preguntó por cada `appid` que no está en el catálogo,
   * `{ "<appid>": ms }` (ver `db/resolve-memory-storage.ts`). Es de este dispositivo.
   */
  resolveAsked: 'resolveAsked',
} as const;

export type GameAgendaDb = Dexie & {
  entries: Table<Entry, string>;
  outbox: Table<Op, string>;
  settings: Table<SettingRow, string>;
  meta: Table<MetaRow, string>;
};

export interface DatabaseOptions {
  readonly name?: string;
  /** Para las pruebas: `fake-indexeddb`. */
  readonly indexedDB?: IDBFactory;
  readonly IDBKeyRange?: typeof IDBKeyRange;
}

export function openDatabase(options: DatabaseOptions = {}): GameAgendaDb {
  const deps =
    options.indexedDB && options.IDBKeyRange
      ? { indexedDB: options.indexedDB, IDBKeyRange: options.IDBKeyRange }
      : undefined;
  const db = new Dexie(options.name ?? DB_NAME, deps) as GameAgendaDb;
  db.version(1).stores(SCHEMA_V1);
  return db;
}

/** Parte de `storagemutated` con las claves primarias cambiadas de una tabla. */
export function tablePart(db: Dexie, table: keyof typeof SCHEMA_V1): string {
  return `idb://${db.name}/${table}/`;
}
