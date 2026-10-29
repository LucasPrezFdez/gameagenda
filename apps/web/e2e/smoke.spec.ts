import { expect, test } from '@playwright/test';

test('la página carga sin errores', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/');

  await expect(page).toHaveTitle('GameAgenda');
  await expect(page.getByRole('heading', { level: 1, name: 'GameAgenda' })).toBeVisible();
  expect(errors).toEqual([]);
});
