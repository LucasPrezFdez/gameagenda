// Navegación (DECISIONES §10.33): en el PC, la barra lateral se encoge a un riel de iconos y lo
// recuerda (`sidebarCollapsed`, en la tabla `settings`); en el móvil, las secciones van en una
// cápsula flotante, con el buscador redondo aparte.
import { devices, expect, type Page, test } from '@playwright/test';
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

  // Por etapas (§10.56): las de conjunto siempre; las de estado, solo con juegos.
  const labels = () =>
    views.locator('.sidebar-views__label').evaluateAll((els) => els.map((e) => e.textContent));
  await expect.poll(labels).toEqual(['Pendientes', 'Próximos', 'Todos', 'Quiero jugar']);
  await expect(views.getByRole('heading', { name: 'Por jugar' })).toBeVisible();
  await expect(views.getByRole('heading', { name: 'Ahora' })).toHaveCount(0);

  // A Jugando: entra en «Jugando ahora», que abre la ficha; en la barra sale la etapa «Ahora».
  await page.getByRole('button', { name: 'Quiero jugar: cambiar estado de Hades II' }).click();
  await page.getByRole('menuitemradio', { name: 'Jugando' }).click();
  await expect(views.getByRole('link', { name: 'Jugando 1' })).toBeVisible();
  await expect(views.getByRole('heading', { name: 'Ahora' })).toBeVisible();
  await expect.poll(labels).toEqual(['Pendientes', 'Próximos', 'Todos', 'Jugando', 'Quiero jugar']);
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

test('en la tablet, la barra lateral empieza encogida y recuerda aparte lo que se elija allí', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'en el móvil no hay barra lateral');
  const checks = await setup(page);
  await page.setViewportSize({ width: 900, height: 1100 });
  await page.goto('/');
  // Con algún juego: con la lista vacía no hay pestañas de vista.
  await capture(page, 'hades ii', 'Hades II');
  const toggle = page.getByRole('button', { name: 'Barra lateral' });
  const nav = page.getByRole('navigation', { name: 'Principal' });
  const navWidth = async () => (await nav.boundingBox())?.width ?? 0;

  // Encogida sin haberla tocado: el contenido se queda con casi todo el ancho y las pestañas de
  // vista vuelven arriba.
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(await navWidth()).toBeLessThan(80);
  await expect(page.getByRole('group', { name: 'Vistas' })).toBeVisible();

  // Abierta a mano en la tablet: se recuerda solo para la tablet.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => storedSetting(page, 'sidebarCollapsedNarrow')).toBe(false);

  // En el PC sigue su propio ajuste (abierta por defecto); encogerla allí no toca la de la tablet.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => storedSetting(page, 'sidebarCollapsed')).toBe(true);
  await page.setViewportSize({ width: 900, height: 1100 });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  await page.reload();
  await expect(page.getByRole('button', { name: 'Barra lateral' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await checks.expectClean();
});

test.describe('un móvil en horizontal', () => {
  // Pixel 7 girado: 915 × 412. Más de 768 px de ancho, pero con 412 de alto no cabe la barra.
  test.use({
    viewport: { width: 915, height: 412 },
    deviceScaleFactor: devices['Pixel 7'].deviceScaleFactor,
    userAgent: devices['Pixel 7'].userAgent,
    isMobile: true,
    hasTouch: true,
  });
  test.skip(({ browserName }) => browserName !== 'chromium', 'emulación táctil: solo Chromium');

  test('lleva la maqueta del móvil: cápsula abajo, sin barra lateral, y la paleta como hoja', async ({
    page,
  }) => {
    const checks = await setup(page);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Barra lateral' })).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'Vistas' })).toBeHidden();
    const box = await page.getByRole('navigation', { name: 'Principal' }).boundingBox();
    expect(box).not.toBeNull();
    expect(412 - ((box?.y ?? 0) + (box?.height ?? 0))).toBeGreaterThanOrEqual(8);
    expect(box?.height ?? 0).toBeLessThan(80);

    // La paleta se abre a pantalla completa, como en el móvil en vertical.
    await paletteInput(page).click();
    await expect(paletteInput(page)).toBeFocused();
    const sheet = await page.locator('.app-header > .palette.is-open').boundingBox();
    expect(sheet?.width ?? 0).toBe(915);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
    await checks.expectClean();
  });
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
