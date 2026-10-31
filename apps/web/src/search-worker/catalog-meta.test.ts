import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { DB_NAME, openDatabase } from '../db/database.ts';
import { APP_DB_NAME, CATALOG_META_KEY, createIndexedDbCatalogMeta } from './catalog-meta.ts';

const META = { version: '20261031.1', checkedAt: 1_793_450_000_000 };

/** Un «navegador» nuevo con la base de la app ya creada por Dexie, como al abrirla. */
async function withAppDb() {
  const indexedDB = new IDBFactory();
  const db = openDatabase({ indexedDB, IDBKeyRange });
  await db.open();
  return { indexedDB, db };
}

describe('meta.catalog en IndexedDB (sin Dexie)', () => {
  it('usa la base de la app', () => {
    expect(APP_DB_NAME).toBe(DB_NAME);
  });

  it('sin la base de la app, lee null y no la crea (Dexie la crea después con su esquema)', async () => {
    const indexedDB = new IDBFactory();
    const meta = createIndexedDbCatalogMeta(indexedDB);
    expect(await meta.read()).toBeNull();
    await meta.write(META);
    expect(await indexedDB.databases()).toEqual([]);

    const db = openDatabase({ indexedDB, IDBKeyRange });
    await db.open();
    expect(await db.meta.get(CATALOG_META_KEY)).toBeUndefined();
    db.close();
  });

  it('guarda y lee en la fila `catalog` de `meta`, con la forma de Dexie', async () => {
    const { indexedDB, db } = await withAppDb();
    const meta = createIndexedDbCatalogMeta(indexedDB);
    expect(await meta.read()).toBeNull();
    await meta.write(META);
    expect(await meta.read()).toEqual(META);
    expect(await db.meta.get(CATALOG_META_KEY)).toEqual({ key: CATALOG_META_KEY, value: META });
    db.close();
  });

  it('un registro con otra forma se lee como null', async () => {
    const { indexedDB, db } = await withAppDb();
    await db.meta.put({ key: CATALOG_META_KEY, value: { version: 20261031, checkedAt: 'ayer' } });
    expect(await createIndexedDbCatalogMeta(indexedDB).read()).toBeNull();
    db.close();
  });

  it('no deja conexiones abiertas: Dexie puede borrar la base después («Borrar todos mis datos»)', async () => {
    const { indexedDB, db } = await withAppDb();
    const meta = createIndexedDbCatalogMeta(indexedDB);
    await meta.write(META);
    await meta.read();
    // Con una conexión del Worker abierta, el borrado quedaría bloqueado y no acabaría.
    const deleted = await Promise.race([
      db.delete().then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 2000)),
    ]);
    expect(deleted).toBe(true);
    expect(await indexedDB.databases()).toEqual([]);
  });
});
