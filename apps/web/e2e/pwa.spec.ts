import { expect, test } from '@playwright/test';
import { setup, waitForSearch } from './helpers.ts';

test('el manifest está en español y sin marcas de Valve', async ({ request }) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest).toMatchObject({ name: 'GameAgenda', lang: 'es-ES', start_url: '/' });
  expect(JSON.stringify(manifest)).not.toMatch(/steam|valve/i);
  for (const icon of manifest.icons as { src: string }[]) {
    expect((await request.get(icon.src)).ok()).toBe(true);
  }
});

test('tras la primera visita, la app abre sin red (precaché del Service Worker)', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Service Worker y modo sin red: en Chromium');
  const checks = await setup(page);
  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  // El catálogo queda en Cache Storage (lo guarda el Worker de búsqueda, no el Service Worker).
  await waitForSearch(page, 'full');

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Mi lista' })).toBeVisible();
  await expect(
    page.getByText('Sin conexión. Puedes seguir apuntando', { exact: false }),
  ).toBeVisible();

  // Los *chunks* diferidos también salen de la precaché.
  await page
    .getByRole('navigation', { name: 'Principal' })
    .getByRole('link', { name: 'Catálogo' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Catálogo de Steam' })).toBeVisible();
  await page.goto('/juego/steam:1145350');
  await expect(page.getByRole('heading', { level: 1, name: 'Hades II' })).toBeVisible();
  await context.setOffline(false);
  await checks.expectClean();
});
