import { expect, test } from '@playwright/test';
import { setup } from './helpers.ts';

test('la página carga sin errores ni violaciones de CSP', async ({ page }) => {
  const checks = await setup(page);
  await page.goto('/');

  await expect(page).toHaveTitle('Mi lista · GameAgenda');
  await expect(page.getByRole('heading', { level: 1, name: 'Mi lista' })).toBeVisible();
  await expect(page.getByText('Tu agenda está vacía.', { exact: false })).toBeVisible();
  await checks.expectClean();
});
