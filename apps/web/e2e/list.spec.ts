import { expect, type Page, test } from '@playwright/test';
import { capture, setup, toast, viewControl } from './helpers.ts';

const row = (page: Page, title: string) =>
  page
    .getByRole('main')
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: new RegExp(`${title}$`) }) });

async function threeGames(page: Page) {
  await capture(page, 'hades ii', 'Hades II');
  await capture(page, 'celeste', 'Celeste');
  await capture(page, 'terraria', 'Terraria');
}

test('estado en dos toques, con aviso de sección, Deshacer y foco en la siguiente fila', async ({
  page,
}) => {
  const checks = await setup(page);
  await page.goto('/');
  await threeGames(page);

  await page.getByRole('button', { name: 'Quiero jugar: cambiar estado de Hades II' }).click();
  await page.getByRole('menuitemradio', { name: 'Jugando' }).click();
  await expect(toast(page)).toContainText('Hades II pasa a Jugando');
  await expect(page.getByRole('link', { name: 'Prioridad 1: Celeste' })).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Jugando ahora (1)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Quiero jugar (2)' })).toBeVisible();

  await page.getByRole('button', { name: 'Más opciones' }).click();
  await page.getByRole('menuitem', { name: 'Deshacer último cambio' }).click();
  await expect(page.getByRole('heading', { name: 'Quiero jugar (3)' })).toBeVisible();
  await checks.expectClean();
});

test('marcas, filtro de compra en la URL, orden manual y «Quitar de mi lista»', async ({
  page,
}) => {
  const checks = await setup(page);
  await page.goto('/');
  await threeGames(page);

  await page.getByRole('button', { name: 'Más acciones: Celeste' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Comprado' }).click();
  await expect(toast(page)).toContainText('Marcado como Comprado: Celeste');
  await expect(row(page, 'Celeste').getByText('Comprado')).toBeVisible();

  await page.getByRole('button', { name: 'Comprados' }).click();
  await expect(page).toHaveURL('/?compra=comprados');
  await expect(page.getByRole('heading', { name: 'Quiero jugar (1)' })).toBeVisible();
  await page.getByRole('button', { name: 'Por comprar' }).click();
  await expect(page).toHaveURL('/?compra=por-comprar');
  await page.getByRole('group', { name: 'Compra' }).getByRole('button', { name: 'Todos' }).click();
  await expect(page).toHaveURL('/');

  await page.getByRole('button', { name: 'Más acciones: Terraria' }).click();
  await page.getByRole('menuitem', { name: 'Al principio' }).click();
  await expect(toast(page)).toContainText('Terraria: prioridad 1 de 3');
  await expect(
    page.getByRole('main').getByRole('listitem').first().getByRole('link'),
  ).toHaveAccessibleName('Prioridad 1: Terraria');

  await page.getByRole('button', { name: 'Más acciones: Hades II' }).click();
  await page.getByRole('menuitem', { name: 'Quitar de mi lista' }).click();
  await expect(toast(page)).toContainText('Quitado de tu lista: Hades II');
  await expect(row(page, 'Hades II')).toHaveCount(0);
  await toast(page).getByRole('button', { name: 'Deshacer' }).click();
  await expect(row(page, 'Hades II')).toHaveCount(1);
  await checks.expectClean();
});

test('Platinado pasa a Completado y lo dice el aviso; En pausa va plegada', async ({ page }) => {
  const checks = await setup(page);
  await page.goto('/');
  await threeGames(page);

  await page.getByRole('button', { name: 'Más acciones: Celeste' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Platinado' }).click();
  await expect(toast(page)).toContainText('Platinado. También lo hemos marcado como Completado.');
  await expect(row(page, 'Celeste')).toHaveCount(0);

  await page.getByRole('button', { name: 'Quiero jugar: cambiar estado de Terraria' }).click();
  await page.getByRole('menuitemradio', { name: 'En pausa' }).click();
  const show = page.getByRole('button', { name: 'Mostrar En pausa' });
  await expect(show).toHaveAttribute('aria-expanded', 'false');
  await expect(row(page, 'Terraria')).toHaveCount(0);
  await show.click();
  await expect(row(page, 'Terraria')).toHaveCount(1);

  await viewControl(page, /^Todos 3/).click();
  await expect(page).toHaveURL('/?vista=todos');
  await expect(page.getByRole('heading', { name: 'Completado (1)' })).toBeVisible();
  await checks.expectClean();
});

test('↑ y ↓ recorren las filas e Intro abre la ficha', async ({ page }) => {
  const checks = await setup(page);
  await page.goto('/');
  await threeGames(page);
  const first = page.getByRole('main').getByRole('link', { name: 'Prioridad 1: Hades II' });
  await first.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('link', { name: 'Prioridad 2: Celeste' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('link', { name: 'Prioridad 3: Terraria' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/juego/steam:105600');
  await checks.expectClean();
});

test('el Catálogo filtra sin apuntar con Intro y apunta con `(+)` o con `+`', async ({ page }) => {
  const checks = await setup(page);
  await page.goto('/catalogo');
  const filter = page.getByRole('textbox', { name: 'Filtrar el catálogo' });
  await filter.fill('elden');
  await expect(page).toHaveURL('/catalogo?q=elden');
  await expect(page.getByText('3 juegos')).toBeVisible();
  await filter.press('Enter');
  await expect(toast(page)).toBeEmpty();

  await page.getByRole('button', { name: 'Apuntar ELDEN RING NIGHTREIGN' }).click();
  await expect(toast(page)).toContainText('Apuntado en Quiero jugar: ELDEN RING NIGHTREIGN');
  await page.getByRole('link', { name: 'ELDEN RING', exact: true }).focus();
  await page.keyboard.press('+');
  await expect(toast(page)).toContainText('Apuntado en Quiero jugar: ELDEN RING');
  await expect(page.getByRole('main').getByText('Quiero jugar')).toHaveCount(2);
  await checks.expectClean();
});

test('el menú de «Orden» cabe en la pantalla, sin barra horizontal', async ({ page }) => {
  const checks = await setup(page);
  await page.goto('/');
  await threeGames(page);
  // 1 100 px es el ancho inicial de la ventana de escritorio (`tauri.conf.json`).
  for (const width of [1100, 900, 800, 375, 320]) {
    await page.setViewportSize({ width, height: 760 });
    await page.getByRole('button', { name: /^Orden: / }).click();
    const menu = page.getByRole('menu', { name: 'Orden' });
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    expect(box, `menú a ${width} px`).not.toBeNull();
    expect(box?.x ?? -1, `borde izquierdo del menú a ${width} px`).toBeGreaterThanOrEqual(0);
    expect(
      (box?.x ?? 0) + (box?.width ?? 0),
      `borde derecho del menú a ${width} px`,
    ).toBeLessThanOrEqual(width);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `desbordamiento horizontal a ${width} px`).toBe(0);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  }
  await checks.expectClean();
});

test('las acciones de la fila salen con el puntero o el teclado, y no se quedan tras un clic', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'con el dedo no hay acciones al pasar por encima');
  const checks = await setup(page);
  await page.goto('/');
  await capture(page, 'hades ii', 'Hades II');
  await capture(page, 'celeste', 'Celeste');
  const actions = row(page, 'Celeste').locator('.entry-row__actions');
  const body = row(page, 'Celeste').locator('.entry-row__body');
  const resting = await body.evaluate((el) => getComputedStyle(el).backgroundColor);

  await row(page, 'Celeste').hover();
  await expect(actions).toHaveCSS('opacity', '1');
  // Un clic deja el foco en la fila, pero sin el puntero encima vuelve a estar como antes.
  await actions.getByRole('button', { name: 'Comprado: Celeste' }).click();
  await page.mouse.move(4, 4);
  await expect(actions).toHaveCSS('opacity', '0');
  await expect(body).toHaveCSS('background-color', resting);

  // Con el teclado, la fila con el foco las enseña (WCAG 1.4.13).
  await page.keyboard.press('Tab');
  await expect(page.locator('.entry-row:has(:focus-visible) .entry-row__actions')).toHaveCSS(
    'opacity',
    '1',
  );
  await checks.expectClean();
});
