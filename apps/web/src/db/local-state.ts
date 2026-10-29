// Arranque (§9.5, regla 6): Mi lista, los ajustes y el reloj salen de Dexie antes de pintar y de
// tocar la red, en una sola transacción de lectura.
import type { Entry } from '@gameagenda/core/entries';
import { type HlcClockSnapshot, MAX_COUNTER, MAX_HLC_MS } from '@gameagenda/core/sync';
import { type GameAgendaDb, META_KEYS } from './database.ts';

export interface LocalState {
  /** Todas las entradas, lápidas y esqueletos incluidos. */
  readonly entries: readonly Entry[];
  /** Filas de `settings` como clave → valor (sin validar). */
  readonly settings: Readonly<Record<string, unknown>>;
  readonly clock: HlcClockSnapshot | null;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** `meta.hlcClock` solo si tiene la forma esperada; si no, el reloj empieza de cero. */
export function clockSnapshotOf(value: unknown): HlcClockSnapshot | null {
  if (typeof value !== 'object' || value === null) return null;
  const { ms, counter, offset } = value as Record<string, unknown>;
  if (!isCount(ms) || ms > MAX_HLC_MS || !isCount(counter) || counter > MAX_COUNTER) return null;
  if (typeof offset !== 'number' || !Number.isFinite(offset)) return null;
  return { ms, counter, offset };
}

export function loadLocalState(db: GameAgendaDb): Promise<LocalState> {
  return db.transaction('r', db.entries, db.settings, db.meta, async () => {
    const [entries, settings, clock] = await Promise.all([
      db.entries.toArray(),
      db.settings.toArray(),
      db.meta.get(META_KEYS.hlcClock),
    ]);
    return {
      entries,
      settings: Object.fromEntries(settings.map((row) => [row.key, row.value])),
      clock: clockSnapshotOf(clock?.value),
    };
  });
}
