// Capas (§9): un menú abierto queda por encima del aviso. En móvil, el aviso de la acción anterior
// puede caer sobre el final del menú de una fila y se quedaría con el toque.
import { expect, test } from '@playwright/test';
import { capture, setup, toast } from './helpers.ts';

test('el menú de una fila queda por encima del aviso', async ({ page }) => {
  const checks = await setup(page);
  await page.goto('/');
  await capture(page, 'hades ii', 'Hades II');
  await capture(page, 'terraria', 'Terraria');
  await expect(toast(page)).toContainText('Terraria');
  await page.getByRole('button', { name: 'Más acciones: Terraria' }).click();
  const item = page.getByRole('menuitemcheckbox', { name: 'Comprado' });
  const box = await item.boundingBox();
  if (!box) throw new Error('El menú no está a la vista');
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // El aviso, justo encima del elemento del menú (por CSSOM: la CSP no admite estilos en línea).
  await page.evaluate(({ x, y }) => {
    const region = document.querySelector('.toaster');
    if (!(region instanceof HTMLElement)) throw new Error('Sin región de avisos');
    region.style.left = `${x}px`;
    region.style.top = `${y - 20}px`;
    region.style.bottom = 'auto';
  }, center);
  const hit = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest('[role="menuitemcheckbox"]') !== null,
    center,
  );
  expect(hit).toBe(true);
  await item.click();
  await expect(item).toHaveCount(0);
  await checks.expectClean();
});
