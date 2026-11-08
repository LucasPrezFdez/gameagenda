// `meta.resolveAsked` (M4; CA4.5): lo que `catalog-refresh` recuerda de `resolve` entre sesiones.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { META_KEYS, openDatabase } from '../db/database.ts';
import {
  createDexieResolveMemory,
  parseResolveAsked,
  RESOLVE_MEMORY_MAX,
} from '../db/resolve-memory-storage.ts';

describe('meta.resolveAsked', () => {
  it('se guarda y se lee, solo con lo que tiene la forma esperada', async () => {
    const db = openDatabase({ name: 'resolve-memory', indexedDB: new IDBFactory(), IDBKeyRange });
    const errors: unknown[] = [];
    const memory = createDexieResolveMemory(db, (error) => errors.push(error));
    expect(await memory.load()).toEqual(new Map());
    memory.save(new Map([[3999990, 100]]));
    await expect
      .poll(async () => (await db.meta.get(META_KEYS.resolveAsked))?.value)
      .toEqual({
        3999990: 100,
      });
    expect(await memory.load()).toEqual(new Map([[3999990, 100]]));
    expect(errors).toEqual([]);
    db.close();
  });

  it('descarta lo raro y guarda como mucho RESOLVE_MEMORY_MAX, los más recientes', async () => {
    expect(parseResolveAsked({ 10: 5, '0730': 1, abc: 2, 20: 'x', 30: Number.NaN })).toEqual(
      new Map([[10, 5]]),
    );
    expect(parseResolveAsked([1, 2])).toEqual(new Map());
    expect(parseResolveAsked(null)).toEqual(new Map());

    const db = openDatabase({
      name: 'resolve-memory-max',
      indexedDB: new IDBFactory(),
      IDBKeyRange,
    });
    const memory = createDexieResolveMemory(db, () => undefined);
    const many = new Map<number, number>();
    for (let i = 1; i <= RESOLVE_MEMORY_MAX + 5; i++) many.set(i, i);
    memory.save(many);
    await expect.poll(async () => (await memory.load()).size).toBe(RESOLVE_MEMORY_MAX);
    const kept = await memory.load();
    expect(kept.has(1)).toBe(false);
    expect(kept.has(RESOLVE_MEMORY_MAX + 5)).toBe(true);
    db.close();
  });
});
