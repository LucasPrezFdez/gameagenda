import { expect, test } from '@playwright/test';
import { capture, setup } from './helpers.ts';

test('navega por las rutas con la barra lateral o las pestañas y vuelve atrás', async ({
  page,
}) => {
  const checks = await setup(page);
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Principal' });

  await nav.getByRole('link', { name: 'Catálogo' }).click();
  await expect(page).toHaveURL('/catalogo');
  await expect(page.getByRole('heading', { level: 1, name: 'Catálogo de Steam' })).toBeFocused();
  await expect(page.getByText('294 juegos')).toBeVisible();

  await nav.getByRole('link', { name: 'Ajustes' }).click();
  await expect(page).toHaveURL('/ajustes');
  await page.getByRole('link', { name: 'Acerca de' }).click();
  await expect(page).toHaveURL('/ajustes/acerca-de');
  await expect(
    page.getByText('GameAgenda no está afiliada a Valve', { exact: false }),
  ).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL('/ajustes');
  await page.goBack();
  await expect(page).toHaveURL('/catalogo');
  await nav.getByRole('link', { name: 'Mi lista' }).click();
  await expect(page).toHaveURL('/');
  await checks.expectClean();
});

test('la ficha se abre desde Mi lista y Esc devuelve el foco a la fila', async ({ page }) => {
  const checks = await setup(page);
  await page.goto('/');
  await capture(page, 'hades ii', 'Hades II');

  const row = page.getByRole('link', { name: /Hades II$/ });
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/juego/steam:1145350');
  await expect(page.getByRole('heading', { level: 1, name: 'Hades II' })).toBeFocused();
  const sheet = page.getByRole('region', { name: 'Hades II' });
  await expect(sheet.getByRole('button', { name: 'Quiero jugar', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await sheet.getByRole('button', { name: 'Jugando', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Avisos' })).toContainText(
    'Hades II pasa a Jugando',
  );
  await expect(sheet.getByRole('button', { name: 'Jugando', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.keyboard.press('Escape');
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('link', { name: /Hades II$/ })).toBeFocused();
  await checks.expectClean();
});

test('rutas directas: ficha de un juego no apuntado, `/apuntar` y página inexistente', async ({
  page,
}) => {
  const checks = await setup(page);
  await page.goto('/juego/steam:367520');
  await expect(page.getByRole('heading', { level: 1, name: 'Hollow Knight' })).toBeVisible();
  await page.getByRole('button', { name: 'Apuntar en Quiero jugar' }).click();
  const sheet = page.getByRole('region', { name: 'Hollow Knight' });
  await expect(sheet.getByRole('button', { name: 'Quiero jugar', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.goto('/apuntar');
  await expect(page.getByRole('combobox', { name: 'Apunta un juego' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL('/');

  await page.goto('/no-existe');
  await expect(
    page.getByRole('heading', { level: 1, name: 'No encontramos esta página' }),
  ).toBeVisible();
  await checks.expectClean();
});
