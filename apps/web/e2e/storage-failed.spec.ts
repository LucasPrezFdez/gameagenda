// «Guardado fallido» (§9.6): sin IndexedDB, la app funciona en memoria y el aviso ofrece
// exportar la lista. Reintentar solo aparece si hay base de datos (aquí no la hay).
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { setup, toast } from './helpers.ts';

test('sin IndexedDB, el aviso de guardado fallido exporta la lista', async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => {
    // Solo el hilo principal: el Worker de búsqueda tiene su propio `indexedDB`.
    IDBFactory.prototype.open = () => {
      throw new DOMException('IndexedDB bloqueado en la prueba', 'UnknownError');
    };
  });
  await page.goto('/');

  await expect(toast(page)).toContainText('No hemos podido guardar en este dispositivo.');
  await expect(toast(page).getByRole('button', { name: 'Reintentar' })).toHaveCount(0);
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    toast(page).getByRole('button', { name: 'Exportar' }).click(),
  ]);
  const exported = JSON.parse(await readFile(await file.path(), 'utf8'));
  expect(exported).toMatchObject({ format: 'gameagenda-export', version: 1, entries: [] });
  await expect(toast(page)).not.toContainText('No hemos podido guardar');
  expect(await page.evaluate(() => globalThis.__cspViolations)).toEqual([]);
});
