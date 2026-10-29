// Ajustes › Datos (§7.5, §11.2; CA1.9): exportar e importar JSON y CSV de ida y vuelta,
// «Borrar todos mis datos», una importación no válida y el registro de errores.
import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { capture, setup, toast } from './helpers.ts';
import { expectStored, expectStoredSetting } from './storage.ts';

async function openData(page: Page) {
  await page.goto('/ajustes/datos');
  await expect(page.getByRole('heading', { level: 2, name: 'Datos' })).toBeVisible();
}

/** Pulsa un botón de exportar y devuelve la ruta y el contenido del fichero descargado. */
async function download(page: Page, button: string) {
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: button }).click(),
  ]);
  const path = await file.path();
  return { name: file.suggestedFilename(), path, text: await readFile(path, 'utf8') };
}

async function importFile(page: Page, path: string) {
  await page.getByLabel('Importar').setInputFiles(path);
}

async function deleteAll(page: Page) {
  await page.getByRole('button', { name: 'Borrar todos mis datos' }).click();
  await page.getByRole('textbox', { name: 'Escribe BORRAR para confirmar' }).fill('BORRAR');
  await page.getByRole('button', { name: 'Borrar todo' }).click();
  await expect(toast(page)).toContainText('Hemos borrado todos tus datos de este dispositivo.');
}

async function threeGames(page: Page) {
  await page.goto('/');
  await capture(page, 'hades ii', 'Hades II');
  await capture(page, 'celeste', 'Celeste');
  await capture(page, 'terraria', 'Terraria');
  await page.getByRole('button', { name: 'Quiero jugar: cambiar estado de Celeste' }).click();
  await page.getByRole('menuitemradio', { name: 'Jugando' }).click();
  await page.getByRole('button', { name: 'Más acciones: Terraria' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Comprado' }).click();
  await page.getByRole('button', { name: 'Más acciones: Hades II' }).click();
  await page.getByRole('menuitem', { name: 'Quitar de mi lista' }).click();
  await expect(toast(page)).toContainText('Quitado de tu lista: Hades II');
  // Se guarda en orden: cuando está la última acción, están todas.
  await expectStored(page, 'steam:1145350', { deletedAt: expect.any(String) });
}

test('JSON: exportar → borrar → importar deja las entradas idénticas; reimportar no duplica', async ({
  page,
}) => {
  const checks = await setup(page);
  await threeGames(page);
  await openData(page);
  const exported = await download(page, 'Exportar JSON');
  expect(exported.name).toMatch(/^gameagenda-\d{4}-\d{2}-\d{2}\.json$/);
  const copy = JSON.parse(exported.text);
  expect(copy).toMatchObject({ format: 'gameagenda-export', version: 1 });
  // Las tres entradas, también la lápida de Hades II, con sus HLC por campo.
  expect(copy.entries.map((e: { id: string }) => e.id)).toEqual([
    'steam:105600',
    'steam:1145350',
    'steam:504230',
  ]);

  // Una visita nueva lee Dexie: está vacía.
  await deleteAll(page);
  await page.goto('/');
  await expect(page.getByText('Tu agenda está vacía', { exact: false })).toBeVisible();

  await openData(page);
  await importFile(page, exported.path);
  await expect(page.getByRole('status').filter({ hasText: 'Hemos importado' })).toHaveText(
    'Hemos importado la copia: 2 altas, 0 cambios, 0 bajas y 0 rechazos.',
  );
  const again = await download(page, 'Exportar JSON');
  expect(JSON.parse(again.text).entries).toEqual(copy.entries);

  await importFile(page, exported.path);
  await expect(page.getByRole('status').filter({ hasText: 'Hemos importado' })).toHaveText(
    'Hemos importado la copia: 0 altas, 0 cambios, 0 bajas y 0 rechazos.',
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Jugando ahora (1)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Quiero jugar (1)' })).toBeVisible();
  await expect(
    page
      .getByRole('main')
      .getByRole('listitem')
      .filter({ hasText: 'Terraria' })
      .getByText('Comprado'),
  ).toBeVisible();
  await checks.expectClean();
});

test('CSV: exportar para hojas de cálculo e importarlo en una agenda vacía', async ({ page }) => {
  const checks = await setup(page);
  await threeGames(page);
  await openData(page);
  const exported = await download(page, 'Exportar CSV');
  expect(exported.name).toMatch(/\.csv$/);
  expect(exported.text.startsWith('﻿id;title;status;statusLabel;')).toBe(true);
  expect(exported.text).toContain('steam:504230;Celeste;playing;Jugando;0;0;0;');
  expect(exported.text).not.toContain('Hades II');

  await deleteAll(page);
  await importFile(page, exported.path);
  await expect(page.getByRole('status').filter({ hasText: 'Hemos importado' })).toHaveText(
    'Hemos importado la copia: 2 altas, 0 cambios, 0 bajas y 0 rechazos.',
  );
  await importFile(page, exported.path);
  await expect(page.getByRole('status').filter({ hasText: 'Hemos importado' })).toContainText(
    '0 altas',
  );
  await expect(page.getByRole('status').filter({ hasText: 'Hemos importado' })).toContainText(
    '2 juegos ya estaban en tu lista.',
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Jugando ahora (1)' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Prioridad 1: Terraria' })).toBeVisible();
  await checks.expectClean();
});

test('un fichero que no es una copia no cambia nada y deja elegir otro', async ({ page }) => {
  const checks = await setup(page);
  await page.goto('/');
  await capture(page, 'celeste', 'Celeste');
  await expectStored(page, 'steam:504230', { title: 'Celeste' });
  await openData(page);
  await page.getByLabel('Importar').setInputFiles({
    name: 'otra-app.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"format":"otra-app","items":[]}'),
  });
  const result = page.getByRole('status').filter({ hasText: 'No hemos cambiado nada' });
  await expect(result).toContainText(
    'Este archivo no es una copia válida de GameAgenda. No hemos cambiado nada.',
  );
  await expect(result.getByRole('button', { name: 'Elegir otro' })).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Quiero jugar (1)' })).toBeVisible();
  await checks.expectClean();
});

test('«Borrar todos mis datos» vacía la lista y los ajustes, y no deja Deshacer', async ({
  page,
}) => {
  const checks = await setup(page);
  await page.goto('/');
  await capture(page, 'celeste', 'Celeste');
  await expectStored(page, 'steam:504230', { title: 'Celeste' });
  await page.goto('/ajustes/apariencia');
  await page.getByRole('radio', { name: 'Oscuro' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expectStoredSetting(page, 'theme', 'dark');
  await openData(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await deleteAll(page);
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');
  await page.keyboard.press('Control+z');
  await expect(toast(page)).toContainText('No hay ningún cambio que deshacer.');
  await page.goto('/');
  await expect(page.getByText('Tu agenda está vacía', { exact: false })).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');
  await checks.expectClean();
});

test('exportar el registro de errores', async ({ page }) => {
  const checks = await setup(page);
  await openData(page);
  const exported = await download(page, 'Exportar registro de errores');
  expect(exported.name).toMatch(/^gameagenda-errores-.*\.json$/);
  expect(JSON.parse(exported.text)).toMatchObject({ format: 'gameagenda-errors', version: 1 });
  await checks.expectClean();
});
