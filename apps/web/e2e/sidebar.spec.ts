// Navegación (DECISIONES §10.33): en el PC, la barra lateral se encoge a un riel de iconos y lo
// recuerda (`sidebarCollapsed`, en la tabla `settings`); en el móvil, las secciones van en una
// cápsula flotante, con el buscador redondo aparte.
import { expect, type Page, test } from '@playwright/test';
import { capture, paletteInput, setup } from './helpers.ts';

/** El ajuste guardado en Dexie (una fila por clave), para no recargar antes de que se escriba. */
function storedSetting(page: Page, key: string): Promise<unknown> {
  return page.evaluate(
    (name) =>
      new Promise((resolve) => {
        const open = indexedDB.open('gameagenda');
        open.onerror = () => resolve(undefined);
        open.onsuccess = () => {
          const db = open.result;
          const get = db.transaction('settings').objectStore('settings').get(name);
          get.onsuccess = () => {
            db.close();
            resolve((get.result as { value?: unknown } | undefined)?.value);
          };
          get.onerror = () => {
            db.close();
            resolve(undefined);
          };
        };
      }),
    key,
  );
}

test('en el PC, la barra lateral se encoge a iconos, conserva los nombres y lo recuerda', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'en el móvil no hay barra lateral');
  const checks = await setup(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Barra lateral' });
  const nav = page.getByRole('navigation', { name: 'Principal' });
  const navWidth = async () => (await nav.boundingBox())?.width ?? 0;

  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(await navWidth()).toBeGreaterThan(200);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(navWidth).toBeLessThan(80);
  // Los nombres siguen en el árbol de accesibilidad y salen con el puntero.
  const catalog = nav.getByRole('link', { name: 'Catálogo' });
  await expect(catalog).toHaveAttribute('title', 'Catálogo');
  await catalog.click();
  await expect(page).toHaveURL('/catalogo');

  await expect.poll(() => storedSetting(page, 'sidebarCollapsed')).toBe(true);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Barra lateral' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  expect(await navWidth()).toBeLessThan(80);

  // La lupa abre la paleta, y el campo se despliega para teclear.
  await page.keyboard.press('Control+k');
  await expect(paletteInput(page)).toBeFocused();
  expect((await paletteInput(page).boundingBox())?.width ?? 0).toBeGreaterThan(300);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Barra lateral' }).click();
  await expect.poll(navWidth).toBeGreaterThan(200);
  await checks.expectClean();
});

test('en el PC, la barra lateral lleva las vistas con su contador y lo que se está jugando', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'en el móvil no hay barra lateral');
  const checks = await setup(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await capture(page, 'hades ii', 'Hades II');
  await capture(page, 'celeste', 'Celeste');
  const views = page.getByRole('navigation', { name: 'Vistas' });

  // Contadores, y la vista abierta marcada; las pestañas de arriba no se ven con la barra.
  await expect(views.getByRole('link', { name: 'Quiero jugar 2' })).toBeVisible();
  await expect(views.getByRole('link', { name: /^Pendientes/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('group', { name: 'Vistas' })).toBeHidden();

  // A Jugando: entra en «Jugando ahora», que abre la ficha.
  await page.getByRole('button', { name: 'Quiero jugar: cambiar estado de Hades II' }).click();
  await page.getByRole('menuitemradio', { name: 'Jugando' }).click();
  await expect(views.getByRole('link', { name: 'Jugando 1' })).toBeVisible();
  // Exacta: la sección de Mi lista se llama «Jugando ahora (1)».
  const playing = page.getByRole('region', { name: 'Jugando ahora', exact: true });
  await playing.getByRole('link', { name: 'Hades II' }).click();
  await expect(page).toHaveURL('/juego/steam:1145350');

  // Cambiar de vista desde la barra conserva el filtro de compra, como las pestañas.
  await page.goto('/?compra=por-comprar');
  await views.getByRole('link', { name: /^Todos/ }).click();
  await expect(page).toHaveURL('/?vista=todos&compra=por-comprar');
  await expect(views.getByRole('link', { name: /^Todos/ })).toHaveAttribute('aria-current', 'page');

  // Encogida: las pestañas vuelven arriba.
  await page.getByRole('button', { name: 'Barra lateral' }).click();
  await expect(page.getByRole('group', { name: 'Vistas' })).toBeVisible();
  await page.getByRole('button', { name: 'Barra lateral' }).click();
  await checks.expectClean();
});

test('en el móvil, las secciones van en la cápsula flotante y no hay botón de encoger', async ({
  page,
}) => {
  const checks = await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Barra lateral' })).toBeHidden();
  const box = await page.getByRole('navigation', { name: 'Principal' }).boundingBox();
  expect(box).not.toBeNull();
  // Flotante: separada de los bordes, abajo.
  expect(box?.x ?? 0).toBeGreaterThanOrEqual(12);
  expect(844 - ((box?.y ?? 0) + (box?.height ?? 0))).toBeGreaterThanOrEqual(8);
  // El buscador, a su derecha, abre la paleta al tocarlo.
  await paletteInput(page).click();
  await expect(paletteInput(page)).toBeFocused();
  await checks.expectClean();
});
