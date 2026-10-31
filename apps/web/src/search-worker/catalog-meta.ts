// `meta.catalog` (§5.3, §7.2 y §7.6): la versión del catálogo en uso y cuándo se comprobó su
// *manifest* por última vez, para no pedirlo en cada arranque (como mucho cada 12 h; también al
// volver la red y con «Actualizar catálogo»). Solo existe para la frecuencia de esa comprobación:
// la versión vigente sigue siendo la del *manifest* guardado en Cache Storage.
//
// El Worker no importa Dexie (§5.2): abre la base de la app con IndexedDB nativo, sin pedir
// versión, solo toca su clave de `meta` y cierra la conexión en cuanto acaba (o ante
// `versionchange`), para no bloquear las migraciones de Dexie. Si la base aún no existe (la
// primera visita, antes de que Dexie la cree), no la crea: aborta la apertura y sigue sin `meta`.

/** Nombre de la base de Dexie (`DB_NAME` en `db/database.ts`, que el Worker no puede importar). */
export const APP_DB_NAME = 'gameagenda';
const META_STORE = 'meta';
export const CATALOG_META_KEY = 'catalog';

export interface CatalogMeta {
  /** La versión cuyo *manifest* se comprobó. */
  readonly version: string;
  /** Cuándo, en ms desde 1970 (`Date.now`, porque tiene que valer entre arranques). */
  readonly checkedAt: number;
}

export interface CatalogMetaStore {
  /** `null` si no hay base, no hay registro o no tiene la forma esperada. */
  read(): Promise<CatalogMeta | null>;
  write(meta: CatalogMeta): Promise<void>;
}

function isCatalogMeta(value: unknown): value is CatalogMeta {
  if (typeof value !== 'object' || value === null) return false;
  const { version, checkedAt } = value as Record<string, unknown>;
  return typeof version === 'string' && typeof checkedAt === 'number' && Number.isFinite(checkedAt);
}

/** La base de la app, si ya existe y tiene `meta`; si no, `null` sin haber creado nada. */
function openAppDb(factory: IDBFactory, name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(name);
    } catch {
      resolve(null);
      return;
    }
    // Sin versión, solo pide actualizar si la base no existe: se aborta y no se crea.
    request.onupgradeneeded = () => request.transaction?.abort();
    request.onerror = (event) => {
      event.preventDefault();
      resolve(null);
    };
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.close();
        resolve(null);
        return;
      }
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Transacción abortada'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Error en la transacción'));
  });
}

export function createIndexedDbCatalogMeta(
  factory: IDBFactory,
  name: string = APP_DB_NAME,
): CatalogMetaStore {
  return {
    async read() {
      const db = await openAppDb(factory, name);
      if (!db) return null;
      try {
        const transaction = db.transaction(META_STORE, 'readonly');
        const request = transaction.objectStore(META_STORE).get(CATALOG_META_KEY);
        await done(transaction);
        const row: unknown = request.result;
        const value = (row as { value?: unknown } | undefined)?.value;
        return isCatalogMeta(value) ? { version: value.version, checkedAt: value.checkedAt } : null;
      } catch {
        return null;
      } finally {
        db.close();
      }
    },
    async write(meta) {
      const db = await openAppDb(factory, name);
      if (!db) return;
      try {
        const transaction = db.transaction(META_STORE, 'readwrite');
        // Misma forma que las filas de Dexie (`MetaRow`: `{key, value}`, clave en línea `key`).
        transaction.objectStore(META_STORE).put({ key: CATALOG_META_KEY, value: meta });
        await done(transaction);
      } finally {
        db.close();
      }
    },
  };
}
