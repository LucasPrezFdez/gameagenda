// Lo guardado en IndexedDB, leído desde la página. La agenda pinta al instante y guarda después,
// en segundo plano: antes de recargar o navegar, las pruebas esperan a que esté en Dexie (en
// WebKit para Windows cada petición de IndexedDB tarda ≈15 ms, y recargar antes la perdería).
import { expect, type Page } from '@playwright/test';

function storedRow(page: Page, table: string, key: string): Promise<unknown> {
  return page.evaluate(
    ([store, id]) =>
      new Promise<unknown>((resolve, reject) => {
        const request = indexedDB.open('gameagenda');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const get = db.transaction(store, 'readonly').objectStore(store).get(id);
          get.onsuccess = () => {
            db.close();
            resolve(get.result ?? null);
          };
          get.onerror = () => {
            db.close();
            reject(get.error);
          };
        };
      }),
    [table, key] as const,
  );
}

/** Espera a que la entrada `id` esté guardada con estos valores. */
export async function expectStored(page: Page, id: string, expected: Record<string, unknown>) {
  await expect
    .poll(() => storedRow(page, 'entries', id), { timeout: 10_000 })
    .toMatchObject(expected);
}

/** Espera a que el ajuste `key` esté guardado con este valor. */
export async function expectStoredSetting(page: Page, key: string, value: unknown) {
  await expect
    .poll(() => storedRow(page, 'settings', key), { timeout: 10_000 })
    .toEqual({ key, value });
}
