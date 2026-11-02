// `meta.searchIndex` (M3, CA3.2; §7.2 y §8.8): el índice de búsqueda ya construido, para que el
// reinicio con la misma versión del catálogo lo restaure en vez de reconstruirlo. Lo identifica
// una clave con el formato, el código que lo construye y los `sha256` del núcleo, los recientes y
// los alias: otro catálogo o otra versión de la app lo invalidan.
//
// Como `meta.catalog`, sin Dexie (§5.2): IndexedDB nativo sobre la base de la app, sin pedir
// versión y cerrando la conexión al acabar. Son dos filas: `searchIndexKey`, con la clave, y
// `searchIndex`, con el índice (≈25 MB). Al arrancar se lee primero la pequeña, y la grande solo
// si es la que hace falta. Las dos se escriben en la misma transacción.
import { APP_DB_NAME, done, META_STORE, openAppDb } from './catalog-meta.ts';

export const SEARCH_INDEX_KEY = 'searchIndexKey';
export const SEARCH_INDEX = 'searchIndex';

export interface SearchIndexStore {
  /** El índice guardado con la clave `key`, o `null` (sin base, sin índice o de otra clave). */
  read(key: string): Promise<unknown>;
  /** Guarda `index` con su clave, en lugar del anterior. */
  write(key: string, index: unknown): Promise<void>;
}

export function createIndexedDbSearchIndex(
  factory: IDBFactory,
  name: string = APP_DB_NAME,
): SearchIndexStore {
  return {
    async read(key) {
      const db = await openAppDb(factory, name);
      if (!db) return null;
      try {
        const transaction = db.transaction(META_STORE, 'readonly');
        const store = transaction.objectStore(META_STORE);
        let index: unknown = null;
        const stored = store.get(SEARCH_INDEX_KEY);
        stored.onsuccess = () => {
          if ((stored.result as { value?: unknown } | undefined)?.value !== key) return;
          // En la misma transacción: no se lee el grande si no es el de esta clave.
          const row = store.get(SEARCH_INDEX);
          row.onsuccess = () => {
            index = (row.result as { value?: unknown } | undefined)?.value ?? null;
          };
        };
        await done(transaction);
        return index;
      } catch {
        return null;
      } finally {
        db.close();
      }
    },
    async write(key, index) {
      const db = await openAppDb(factory, name);
      if (!db) return;
      try {
        const transaction = db.transaction(META_STORE, 'readwrite');
        const store = transaction.objectStore(META_STORE);
        // Misma forma que las filas de Dexie (`MetaRow`: `{key, value}`).
        store.put({ key: SEARCH_INDEX_KEY, value: key });
        store.put({ key: SEARCH_INDEX, value: index });
        await done(transaction);
      } finally {
        db.close();
      }
    },
  };
}
