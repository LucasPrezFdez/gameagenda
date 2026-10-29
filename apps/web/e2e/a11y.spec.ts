import { expect, test } from '@playwright/test';
import { capture, expectAccessible, openPalette, paletteInput, setup } from './helpers.ts';

for (const colorScheme of ['light', 'dark'] as const) {
  test(`axe sin violaciones graves ni críticas en cada pantalla (tema ${colorScheme})`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const checks = await setup(page);
    await page.emulateMedia({ colorScheme });
    await page.goto('/');
    await expectAccessible(page, 'Mi lista vacía');

    await capture(page, 'hades ii', 'Hades II');
    await capture(page, 'celeste', 'Celeste');
    await page.getByRole('button', { name: 'Más acciones: Celeste' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Próximo' }).click();
    await expectAccessible(page, 'Mi lista con juegos y aviso');

    await page.getByRole('button', { name: 'Quiero jugar: cambiar estado de Hades II' }).click();
    await expectAccessible(page, 'Menú de estado');
    await page.keyboard.press('Escape');

    await openPalette(page);
    await page.keyboard.type('hollow knigth');
    await expect(page.getByRole('group', { name: '¿Quizás buscabas…?' })).toBeVisible();
    await expectAccessible(page, 'Paleta con sugerencias');
    await page.keyboard.press('Escape');

    await paletteInput(page).focus();
    await page.keyboard.type('celeste');
    await page.keyboard.press('Alt+Enter');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    const nav = page.getByRole('navigation', { name: 'Principal' });
    await page
      .getByRole('main')
      .getByRole('link', { name: /Hades II$/ })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Hades II' })).toBeVisible();
    await expectAccessible(page, 'Ficha');

    await nav.getByRole('link', { name: 'Catálogo' }).click();
    await expect(page.getByText('40 juegos')).toBeVisible();
    await expectAccessible(page, 'Catálogo');

    await nav.getByRole('link', { name: 'Ajustes' }).click();
    await expectAccessible(page, 'Ajustes');
    for (const section of ['Apariencia', 'Contenido', 'Teclado y gestos', 'Datos', 'Acerca de']) {
      await page.getByRole('link', { name: section, exact: true }).click();
      await expect(page.getByRole('heading', { level: 2, name: section })).toBeVisible();
      await expectAccessible(page, `Ajustes › ${section}`);
      if (await page.getByRole('link', { name: 'Ajustes', exact: true }).first().isVisible()) {
        await page.goBack();
      }
    }
    await checks.expectClean();
  });
}

test('axe en páginas abiertas directamente: ficha no apuntada, sin catálogo y 404', async ({
  page,
}) => {
  const checks = await setup(page, { boot: 'none' });
  await page.goto('/juego/steam:367520');
  await expect(page.getByRole('heading', { level: 1, name: 'Hollow Knight' })).toBeVisible();
  await expectAccessible(page, 'Ficha sin catálogo');
  await page.goto('/catalogo');
  await expect(page.getByText(/Preparando el catálogo/)).toBeVisible();
  await expectAccessible(page, 'Catálogo sin catálogo');
  await page.goto('/no-existe');
  await expectAccessible(page, '404');
  await checks.expectClean();
});
