// `meta.errorLog`: los 100 últimos errores de todas las pestañas (leer, añadir y recortar en una
// sola transacción, para no perder los de otra pestaña).
import { ERROR_LOG_LIMIT, type ErrorLogStorage, type ErrorRecord } from '../errors/error-log.ts';
import { type GameAgendaDb, META_KEYS } from './database.ts';

function isRecord(value: unknown): value is ErrorRecord {
  if (typeof value !== 'object' || value === null) return false;
  const { at, source, message } = value as Record<string, unknown>;
  return typeof at === 'string' && typeof source === 'string' && typeof message === 'string';
}

function recordsOf(value: unknown): ErrorRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function createDexieErrorLogStorage(db: GameAgendaDb): ErrorLogStorage {
  return {
    append(records) {
      return db.transaction('rw', db.meta, async () => {
        const stored = recordsOf((await db.meta.get(META_KEYS.errorLog))?.value);
        const value = [...stored, ...records].slice(-ERROR_LOG_LIMIT);
        await db.meta.put({ key: META_KEYS.errorLog, value });
      });
    },
    async load() {
      return recordsOf((await db.meta.get(META_KEYS.errorLog))?.value);
    },
  };
}
