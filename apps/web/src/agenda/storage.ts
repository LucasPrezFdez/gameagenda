// Lo que la agenda necesita de su almacén (Dexie en la app, nada en las pruebas sin persistencia).
import type { Entry } from '@gameagenda/core/entries';
import { canon, type HlcClockSnapshot, type Op } from '@gameagenda/core/sync';

/** ¿Misma entrada? Las HLC por campo la determinan: cada HLC es de una sola acción y nodo. */
export function sameEntry(a: Entry | undefined, b: Entry | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a === b || (a.lastHlc === b.lastHlc && canon(a.hlc) === canon(b.hlc));
}

/** Una o varias acciones ya aplicadas en memoria, listas para guardar en una transacción. */
export interface WriteBatch {
  /** Entradas resultantes: van a `entries`. */
  readonly entries: readonly Entry[];
  /** Sus operaciones: van a la `outbox`. */
  readonly ops: readonly Op[];
  /** Cada entrada tal como estaba en memoria antes de las acciones. */
  readonly before: ReadonlyMap<string, Entry | undefined>;
  /** Estado del reloj para `meta.hlcClock`. */
  readonly clock: HlcClockSnapshot;
}

/** Claves cambiadas en el almacén (también por otra pestaña), o `all` si no se saben. */
export type StorageChange = { readonly ids: readonly string[] } | { readonly all: true };

export interface AgendaStorage {
  /**
   * Guarda el lote. Si otra pestaña ha cambiado una entrada desde que se leyó, fusiona las
   * operaciones del lote sobre la guardada (LWW por campo) en vez de pisarla. Devuelve las
   * entradas tal como quedan guardadas.
   */
  write(batch: WriteBatch): Promise<readonly Entry[]>;
  read(ids: readonly string[]): Promise<ReadonlyArray<Entry | undefined>>;
  readAll(): Promise<readonly Entry[]>;
  /** Copia de seguridad en `meta.backup` (antes de importar). */
  backup(copy: unknown): Promise<void>;
  /** «Borrar todos mis datos»: vacía `entries`, `outbox`, `settings` y `meta`. */
  clear(): Promise<void>;
  subscribe(listener: (change: StorageChange) => void): () => void;
}
