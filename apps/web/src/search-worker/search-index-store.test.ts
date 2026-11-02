import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database.ts';
import {
  createIndexedDbSearchIndex,
  SEARCH_INDEX,
  SEARCH_INDEX_HAYSTACK,
  SEARCH_INDEX_KEY,
} from './search-index-store.ts';

const INDEX = { format: 2, appid: new Uint32Array([730, 570]), names: 'Counter-Strike 2\nDota 2' };
const HAYSTACK = { format: 2, count: 2, chunks: [] };

/** Un «navegador» nuevo con la base de la app ya creada por Dexie, como al abrirla. */
async function withAppDb() {
  const indexedDB = new IDBFactory();
  const db = openDatabase({ indexedDB, IDBKeyRange });
  await db.open();
  return { indexedDB, db };
}

describe('meta.searchIndex en IndexedDB (sin Dexie)', () => {
  it('guarda la clave, lo principal y el pajar en tres filas de `meta`, con la forma de Dexie', async () => {
    const { indexedDB, db } = await withAppDb();
    const store = createIndexedDbSearchIndex(indexedDB);
    expect(await store.read('a')).toBeNull();
    expect(await store.readHaystack('a')).toBeNull();
    await store.write('a', INDEX, HAYSTACK);
    expect(await store.read('a')).toEqual(INDEX);
    expect(await store.readHaystack('a')).toEqual(HAYSTACK);
    expect(await db.meta.get(SEARCH_INDEX_KEY)).toEqual({ key: SEARCH_INDEX_KEY, value: 'a' });
    expect((await db.meta.get(SEARCH_INDEX))?.value).toEqual(INDEX);
    expect((await db.meta.get(SEARCH_INDEX_HAYSTACK))?.value).toEqual(HAYSTACK);
    db.close();
  });

  it('con otra clave lee null, y el índice nuevo sustituye al anterior', async () => {
    const { indexedDB, db } = await withAppDb();
    const store = createIndexedDbSearchIndex(indexedDB);
    await store.write('a', INDEX, HAYSTACK);
    expect(await store.read('b')).toBeNull();
    expect(await store.readHaystack('b')).toBeNull();
    const next = { ...INDEX, appid: new Uint32Array([1145350]) };
    await store.write('b', next, HAYSTACK);
    expect(await store.read('a')).toBeNull();
    expect(await store.read('b')).toEqual(next);
    expect(await db.meta.count()).toBe(3);
    db.close();
  });

  it('sin la base de la app no la crea; «Borrar todos mis datos» se lo lleva', async () => {
    const empty = new IDBFactory();
    const without = createIndexedDbSearchIndex(empty);
    await without.write('a', INDEX, HAYSTACK);
    expect(await without.read('a')).toBeNull();
    expect(await empty.databases()).toEqual([]);

    const { indexedDB, db } = await withAppDb();
    const store = createIndexedDbSearchIndex(indexedDB);
    await store.write('a', INDEX, HAYSTACK);
    await db.meta.clear();
    expect(await store.read('a')).toBeNull();
    // Sin conexiones abiertas del Worker: Dexie puede borrar la base.
    const deleted = await Promise.race([
      db.delete().then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 2000)),
    ]);
    expect(deleted).toBe(true);
  });
});
