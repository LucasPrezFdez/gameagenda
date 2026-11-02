// `meta.searchIndex` (M3, CA3.2; §7.2 y §8.8): el índice de búsqueda ya construido, para que el
// reinicio con la misma versión del catálogo lo restaure en vez de reconstruirlo. Lo identifica
// una clave con el formato, el código que lo construye y los `sha256` del núcleo, los recientes y
// los alias: otro catálogo o otra versión de la app lo invalidan.
//
// Como `meta.catalog`, sin Dexie (§5.2): IndexedDB nativo sobre la base de la app, sin pedir
// versión y cerrando la conexión al acabar. Son tres filas: `searchIndexKey`, con la clave;
// `searchIndex`, con lo principal (≈22 MB), y `searchIndexHaystack`, con el pajar del nivel 3
// (≈5 MB), que se lee después (§8.8). Al arrancar se lee primero la clave, y lo demás solo si es
// la que hace falta. Las tres se escriben en la misma transacción.
import { APP_DB_NAME, done, META_STORE, openAppDb } from './catalog-meta.ts';

export const SEARCH_INDEX_KEY = 'searchIndexKey';
export const SEARCH_INDEX = 'searchIndex';
export const SEARCH_INDEX_HAYSTACK = 'searchIndexHaystack';

export interface SearchIndexStore {
  /** Lo principal del índice guardado con la clave `key`, o `null` (sin base, sin índice o de otra clave). */
  read(key: string): Promise<unknown>;
  /** Su pajar, o `null`. */
  readHaystack(key: string): Promise<unknown>;
  /** Guarda el índice (`main` y `haystack`) con su clave, en lugar del anterior. */
  write(key: string, main: unknown, haystack: unknown): Promise<void>;
}

/** La fila `row` si la clave guardada es `key`, en una sola transacción. */
async function readRow(
  factory: IDBFactory,
  name: string,
  key: string,
  row: string,
): Promise<unknown> {
  const db = await openAppDb(factory, name);
  if (!db) return null;
  try {
    const transaction = db.transaction(META_STORE, 'readonly');
    const store = transaction.objectStore(META_STORE);
    let value: unknown = null;
    const stored = store.get(SEARCH_INDEX_KEY);
    stored.onsuccess = () => {
      if ((stored.result as { value?: unknown } | undefined)?.value !== key) return;
      // En la misma transacción: no se lee la grande si no es la de esta clave.
      const request = store.get(row);
      request.onsuccess = () => {
        value = (request.result as { value?: unknown } | undefined)?.value ?? null;
      };
    };
    await done(transaction);
    return value;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export function createIndexedDbSearchIndex(
  factory: IDBFactory,
  name: string = APP_DB_NAME,
): SearchIndexStore {
  return {
    read: (key) => readRow(factory, name, key, SEARCH_INDEX),
    readHaystack: (key) => readRow(factory, name, key, SEARCH_INDEX_HAYSTACK),
    async write(key, main, haystack) {
      const db = await openAppDb(factory, name);
      if (!db) return;
      try {
        const transaction = db.transaction(META_STORE, 'readwrite');
        const store = transaction.objectStore(META_STORE);
        // Misma forma que las filas de Dexie (`MetaRow`: `{key, value}`).
        store.put({ key: SEARCH_INDEX_KEY, value: key });
        store.put({ key: SEARCH_INDEX, value: main });
        store.put({ key: SEARCH_INDEX_HAYSTACK, value: haystack });
        await done(transaction);
      } finally {
        db.close();
      }
    },
  };
}
