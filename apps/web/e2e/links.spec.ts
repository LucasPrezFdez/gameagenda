// Pegar un enlace de Steam en la paleta (RF-04; CA1.9) y vincular un juego manual (RF-05).
import { expect, type Page, test } from '@playwright/test';
import { openPalette, setup, toast } from './helpers.ts';
import { expectStored } from './storage.ts';

const listRow = (page: Page, title: string) =>
  page.getByRole('main').getByRole('link', { name: new RegExp(`${title}$`) });

/** `Ctrl+K` y pegar (el texto llega de una vez, como con `Ctrl+V`). */
async function paste(page: Page, text: string) {
  await openPalette(page);
  await page.keyboard.insertText(text);
}

test('pegar un enlace de la tienda apunta ese juego con su nombre del catálogo', async ({
  page,
}) => {
  const checks = await setup(page);
  await page.goto('/');
  await paste(page, 'https://store.steampowered.com/app/1145350/Hades_II/');
  const option = page.getByRole('option').first();
  await expect(option).toHaveAccessibleName(/^Apuntar «Hades II».*2025/);
  await expect(page.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(toast(page)).toContainText('Apuntado en Quiero jugar: Hades II');
  await expect(listRow(page, 'Hades II')).toBeVisible();

  // Pegarlo otra vez no lo duplica: dice dónde está y abre su ficha.
  await paste(page, 'https://s.team/a/1145350');
  await expect(page.getByRole('option').first()).toHaveAccessibleName(
    /^Hades II.*En tu lista: Quiero jugar/,
  );
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/juego/steam:1145350');
  await checks.expectClean();
});

test('un `appid` desconocido queda provisional con el título del *slug* y se conserva', async ({
  page,
}) => {
  const checks = await setup(page);
  await page.goto('/');
  await paste(page, 'Mira: https://store.steampowered.com/app/3999990/Mi_Juego_Indie/?l=spanish');
  await expect(page.getByRole('option').first()).toHaveAccessibleName(
    /^Apuntar «Mi Juego Indie».*Provisional/,
  );
  await page.keyboard.press('Enter');
  await expect(toast(page)).toContainText(
    'Apuntado: «Mi Juego Indie» (provisional). Lo completaremos cuando llegue al catálogo.',
  );
  await expectStored(page, 'steam:3999990', { title: 'Mi Juego Indie', deletedAt: null });
  await page.reload();
  await listRow(page, 'Mi Juego Indie').click();
  await expect(page).toHaveURL('/juego/steam:3999990');
  await expect(page.getByRole('heading', { level: 1, name: 'Mi Juego Indie' })).toBeVisible();
  await expect(page.getByText('Provisional', { exact: true })).toBeVisible();

  // Sin *slug* (solo `appid:`), el título es «Juego de Steam <appid>».
  await paste(page, 'appid:3999991');
  await expect(page.getByRole('option').first()).toHaveAccessibleName(
    /^Apuntar «Juego de Steam 3999991»/,
  );
  await page.keyboard.press('Enter');
  await expect(toast(page)).toContainText('Apuntado: «Juego de Steam 3999991» (provisional).');
  await checks.expectClean();
});

test('sin catálogo, el juego queda provisional y se resuelve cuando el catálogo llega', async ({
  page,
}) => {
  const checks = await setup(page, { boot: 'none' });
  await page.goto('/');
  await paste(page, 'https://store.steampowered.com/app/1145350/Hades_2/');
  await expect(page.getByRole('option').first()).toHaveAccessibleName(
    /^Apuntar «Hades 2».*Provisional/,
  );
  await page.keyboard.press('Enter');
  await expect(toast(page)).toContainText('Apuntado: «Hades 2» (provisional).');
  await expect(listRow(page, 'Hades 2')).toBeVisible();
  await expectStored(page, 'steam:1145350', { title: 'Hades 2' });

  // La siguiente visita ya tiene el catálogo: el título pasa a ser el suyo, con el mismo id.
  await page.addInitScript(() => {
    globalThis.__GA_FAKE_SEARCH__ = { boot: 'full' };
  });
  await page.reload();
  await expect(listRow(page, 'Hades II')).toBeVisible();
  await expect(listRow(page, 'Hades 2')).toHaveCount(0);
  await expectStored(page, 'steam:1145350', { title: 'Hades II' });
  await listRow(page, 'Hades II').click();
  await expect(page).toHaveURL('/juego/steam:1145350');
  await checks.expectClean();
});

test('un juego manual propone «Vincular» con su juego de Steam', async ({ page }) => {
  const checks = await setup(page);
  await page.goto('/');
  await openPalette(page);
  await page.keyboard.type('Celeste');
  await expect(page.getByRole('option').first()).toHaveAccessibleName(/^Celeste/);
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('option', { name: 'Apuntar «Celeste» a mano' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(toast(page)).toContainText('Apuntado en Quiero jugar: Celeste');

  await listRow(page, 'Celeste').click();
  await expect(page).toHaveURL(/\/juego\/manual:/);
  await expect(page.getByText('¿Es «Celeste» de Steam?')).toBeVisible();
  await page.getByRole('button', { name: 'Vincular' }).click();
  await expect(toast(page)).toContainText('Vinculado con Steam: Celeste');
  await expect(page).toHaveURL('/juego/steam:504230');
  await expect(page.getByRole('heading', { level: 1, name: 'Celeste' })).toBeVisible();
  await expect(page.getByText('2018')).toBeVisible();
  await checks.expectClean();
});
