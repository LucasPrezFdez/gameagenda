// La agenda guardada en Dexie: recargar la conserva (CA1.8), estado y marca a ≤2 toques con
// respuesta ≤100 ms (CA1.6), ficha editable con Deshacer (CA1.12) y dos pestañas coherentes.
import { expect, type Page, test } from '@playwright/test';
import { capture, measures, openPalette, setup, toast } from './helpers.ts';
import { expectStored } from './storage.ts';

const row = (page: Page, title: string) =>
  page
    .getByRole('main')
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: new RegExp(`${title}$`) }) });

/** Último `ui:feedback`: del evento al fotograma con la confirmación. */
async function lastFeedback(page: Page): Promise<number> {
  const all = await measures(page, 'ui:feedback');
  return all.at(-1) ?? Number.POSITIVE_INFINITY;
}

/** Estado en dos toques: el chip de la fila y el estado. */
async function setStatus(page: Page, title: string, from: string, to: string) {
  await page.getByRole('button', { name: `${from}: cambiar estado de ${title}` }).click();
  await page.getByRole('menuitemradio', { name: to }).click();
}

/** Marca desde el menú de la fila (dos toques; en escritorio también hay un botón de uno). */
async function toggleFlag(page: Page, title: string, flag: string) {
  await page.getByRole('button', { name: `Más acciones: ${title}` }).click();
  await page.getByRole('menuitemcheckbox', { name: flag }).click();
}

test('recargar conserva la agenda: estados, marcas y orden (CA1.8)', async ({ page }) => {
  const checks = await setup(page);
  await page.goto('/');
  await capture(page, 'hades ii', 'Hades II');
  await capture(page, 'celeste', 'Celeste');
  await capture(page, 'terraria', 'Terraria');
  await setStatus(page, 'Celeste', 'Quiero jugar', 'Jugando');
  await toggleFlag(page, 'Hades II', 'Comprado');
  await page.getByRole('button', { name: 'Más acciones: Terraria' }).click();
  await page.getByRole('menuitem', { name: 'Al principio' }).click();
  await expect(toast(page)).toContainText('Terraria: prioridad 1 de 2');
  await expectStored(page, 'steam:1145350', { flags: { owned: true } });
  await expectStored(page, 'steam:504230', { status: 'playing' });

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Jugando ahora (1)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Quiero jugar (2)' })).toBeVisible();
  await expect(
    page.getByRole('main').getByRole('listitem').first().getByRole('link'),
  ).toHaveAccessibleName('Celeste');
  await expect(page.getByRole('link', { name: 'Prioridad 1: Terraria' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Prioridad 2: Hades II' })).toBeVisible();
  await expect(row(page, 'Hades II').getByText('Comprado')).toBeVisible();

  // Lo apuntado después de recargar va al final y nunca se duplica.
  await capture(page, 'stardew', 'Stardew Valley');
  await expect(page.getByRole('link', { name: 'Prioridad 3: Stardew Valley' })).toBeVisible();
  await openPalette(page);
  await page.keyboard.type('celeste');
  await expect(page.getByRole('option').first()).toHaveAccessibleName(
    /^Celeste.*En tu lista: Jugando/,
  );
  await page.keyboard.press('Escape');
  await checks.expectClean();
});

test('sin red: apunta, cambia estados y lo conserva al recargar (CA1.8)', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Service Worker y modo sin red: en Chromium');
  const checks = await setup(page);
  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.reload();
  await capture(page, 'outer wilds', 'Outer Wilds');
  await setStatus(page, 'Outer Wilds', 'Quiero jugar', 'Jugando');
  await expect(toast(page)).toContainText('Outer Wilds pasa a Jugando');
  await expectStored(page, 'steam:753640', { status: 'playing' });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Jugando ahora (1)' })).toBeVisible();
  await expect(row(page, 'Outer Wilds')).toHaveCount(1);
  await context.setOffline(false);
  await checks.expectClean();
});

test('estado y marca a ≤2 toques desde Mi lista, con respuesta ≤100 ms (CA1.6)', async ({
  page,
}) => {
  const checks = await setup(page);
  await page.goto('/');
  await capture(page, 'hades ii', 'Hades II');

  // Marca: dos toques desde el menú de la fila.
  await toggleFlag(page, 'Hades II', 'Comprado');
  await expect(toast(page)).toContainText('Marcado como Comprado: Hades II');
  await expect(row(page, 'Hades II').getByText('Comprado')).toBeVisible();
  expect(await lastFeedback(page)).toBeLessThanOrEqual(100);

  // En escritorio, además, un toque con el botón de la marca.
  const next = page.getByRole('button', { name: 'Próximo: Hades II' });
  if (await next.isVisible()) {
    await next.click();
    await expect(next).toHaveAttribute('aria-pressed', 'true');
    expect(await lastFeedback(page)).toBeLessThanOrEqual(100);
    await toast(page).getByRole('button', { name: 'Deshacer' }).click();
    await expect(next).toHaveAttribute('aria-pressed', 'false');
  }

  // Estado: dos toques (chip → estado).
  await setStatus(page, 'Hades II', 'Quiero jugar', 'Completado');
  await expect(toast(page)).toContainText('Hades II pasa a Completado');
  expect(await lastFeedback(page)).toBeLessThanOrEqual(100);

  // Platinado desde la ficha y Deshacer: el estado exacto de antes, también la fecha.
  await page.getByRole('button', { name: /^Todos \d/ }).click();
  await page.getByRole('main').getByRole('link', { name: 'Hades II' }).click();
  const sheet = page.getByRole('region', { name: 'Hades II' });
  const platinum = sheet.getByRole('button', { name: 'Platinado', exact: true });
  await platinum.click();
  await expect(platinum).toHaveAttribute('aria-pressed', 'true');
  expect(await lastFeedback(page)).toBeLessThanOrEqual(100);
  const platinumAt = sheet.getByRole('textbox', { name: 'Platinado' });
  await expect(platinumAt).not.toHaveValue('');
  await toast(page).getByRole('button', { name: 'Deshacer' }).click();
  await expect(platinum).toHaveAttribute('aria-pressed', 'false');
  await expect(platinumAt).toHaveValue('');
  await expect(sheet.getByRole('button', { name: 'Completado', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await checks.expectClean();
});

test('la ficha edita nota, «Juego en» y fechas, con Deshacer, y se guarda (CA1.12)', async ({
  page,
}) => {
  const checks = await setup(page);
  await page.goto('/');
  await capture(page, 'celeste', 'Celeste');
  // Mayús+Intro desde la paleta abre la ficha.
  await openPalette(page);
  await page.keyboard.type('celeste');
  await expect(page.getByRole('option').first()).toHaveAccessibleName(/^Celeste/);
  await page.keyboard.press('Shift+Enter');
  await expect(page).toHaveURL('/juego/steam:504230');
  const sheet = page.getByRole('region', { name: 'Celeste' });

  const note = sheet.getByRole('textbox', { name: 'Nota' });
  await note.fill('Fresas: 80');
  await note.blur();
  await expect(toast(page)).toContainText('Has cambiado la nota de Celeste');
  await toast(page).getByRole('button', { name: 'Deshacer' }).click();
  await expect(note).toHaveValue('');
  await note.fill('Fresas: 175');
  await note.blur();
  await expect(toast(page)).toContainText('Has cambiado la nota de Celeste');

  const started = sheet.getByRole('textbox', { name: 'Empezado' });
  await started.fill('2019-02-30');
  await started.blur();
  await expect(sheet.getByText('Escribe una fecha como 2026, 2026-10 o 2026-10-28.')).toBeVisible();
  await started.fill('2019-02');
  await started.blur();
  await expect(toast(page)).toContainText('Has cambiado la fecha de inicio de Celeste');

  await sheet.getByRole('button', { name: /^Juego en/ }).click();
  await page.getByRole('menuitemradio', { name: 'Steam Deck' }).click();
  await expect(toast(page)).toContainText('Has cambiado «Juego en» de Celeste');
  await expectStored(page, 'steam:504230', {
    note: 'Fresas: 175',
    startedAt: '2019-02',
    platform: 'steam_deck',
  });

  await page.reload();
  const reloaded = page.getByRole('region', { name: 'Celeste' });
  await expect(reloaded.getByRole('textbox', { name: 'Nota' })).toHaveValue('Fresas: 175');
  await expect(reloaded.getByRole('textbox', { name: 'Empezado' })).toHaveValue('2019-02');
  await expect(reloaded.getByRole('button', { name: /^Juego en/ })).toContainText('Steam Deck');
  await checks.expectClean();
});

test('dos pestañas abiertas quedan coherentes', async ({ page, context }) => {
  const checks = await setup(page);
  await page.goto('/');
  const other = await context.newPage();
  const otherChecks = await setup(other);
  await other.goto('/');
  await expect(other.getByText('Tu agenda está vacía', { exact: false })).toBeVisible();

  await capture(page, 'hades ii', 'Hades II');
  await expect(row(other, 'Hades II')).toHaveCount(1);

  await setStatus(other, 'Hades II', 'Quiero jugar', 'Jugando');
  await expect(page.getByRole('heading', { name: 'Jugando ahora (1)' })).toBeVisible();

  // Cada pestaña puede seguir actuando sobre lo que ha cambiado la otra.
  await toggleFlag(page, 'Hades II', 'Comprado');
  await expect(row(other, 'Hades II').getByText('Comprado')).toBeVisible();
  await checks.expectClean();
  await otherChecks.expectClean();
});
