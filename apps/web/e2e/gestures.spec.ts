// Gestos de M3 (§9.4; RF-15, RF-16 y CA3.4): deslizar una fila (→ avanza el estado, ← las
// marcas), mantenerla pulsada (selector de estado), arrastrar `::`, ↓ en la hoja de la paleta y
// mantener pulsado un resultado. Con el dedo, en Chromium con toques de verdad por CDP
// (`Input.dispatchTouchEvent`): pasan por `touch-action`, el desplazamiento de la página y los
// gestos del navegador, como en un Android. El WebKit de Playwright no tiene cómo deslizar: los
// botones equivalentes ya los prueban `list.spec.ts` y `shortcuts.spec.ts`.
import { type CDPSession, devices, expect, type Locator, type Page, test } from '@playwright/test';
import { capture, expectAccessible, paletteInput, setup, toast } from './helpers.ts';
import { expectStored, expectStoredSetting } from './storage.ts';

const HADES = 'steam:1145350';
const CELESTE = 'steam:504230';
const TERRARIA = 'steam:105600';

const row = (page: Page, title: string) =>
  page
    .getByRole('main')
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: new RegExp(`${title}$`) }) });

/** Los `id` de una sección, en el orden en que se ven. */
const order = (page: Page, section: string) =>
  page
    .getByRole('region', { name: new RegExp(`^${section}`) })
    .locator('[data-entry-id]')
    .evaluateAll((rows) => rows.map((element) => (element as HTMLElement).dataset.entryId));

interface Point {
  readonly x: number;
  readonly y: number;
}

/** Un dedo de `from` a `to` en `steps` pasos; con `hold`, se queda quieto antes de soltar. */
async function touchPath(page: Page, points: readonly Point[], { holdMs = 0 } = {}) {
  const cdp: CDPSession = await page.context().newCDPSession(page);
  const [first, ...rest] = points;
  if (!first) throw new Error('sin puntos');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
  let last = first;
  for (const point of rest) {
    for (let step = 1; step <= 8; step++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          {
            x: last.x + ((point.x - last.x) * step) / 8,
            y: last.y + ((point.y - last.y) * step) / 8,
          },
        ],
      });
    }
    last = point;
  }
  if (holdMs > 0) await page.waitForTimeout(holdMs);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

async function box(locator: Locator) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error('no se ve');
  return rect;
}

/** Desliza la fila en horizontal una fracción de su ancho (negativa: a la izquierda). */
async function swipeRow(
  page: Page,
  target: Locator,
  fraction: number,
  { startX = 0.5, back = 0 } = {},
) {
  const rect = await box(target);
  const y = rect.y + rect.height / 2;
  const from = { x: rect.x + rect.width * startX, y };
  const to = { x: from.x + rect.width * fraction, y: y + 3 };
  const points = back === 0 ? [from, to] : [from, to, { x: from.x + rect.width * back, y }];
  await touchPath(page, points);
}

test.describe('con el dedo', () => {
  test.use({
    viewport: devices['Pixel 7'].viewport,
    deviceScaleFactor: devices['Pixel 7'].deviceScaleFactor,
    userAgent: devices['Pixel 7'].userAgent,
    isMobile: true,
    hasTouch: true,
  });
  test.skip(({ browserName }) => browserName !== 'chromium', 'toques por CDP: solo Chromium');

  test('→ avanza el estado al pasar el 40 %; a medias, volviendo atrás o en el borde, nada', async ({
    page,
  }) => {
    const checks = await setup(page);
    await page.goto('/');
    await capture(page, 'hades ii', 'Hades II');
    await capture(page, 'celeste', 'Celeste');
    const celeste = row(page, 'Celeste');

    // A medias (30 %), pasado el umbral y vuelta atrás, o desde la zona muerta del borde.
    await swipeRow(page, celeste, 0.3, { startX: 0.25 });
    await swipeRow(page, celeste, 0.6, { startX: 0.2, back: 0.05 });
    const rect = await box(celeste);
    await touchPath(page, [
      { x: 20, y: rect.y + rect.height / 2 },
      { x: 20 + rect.width * 0.6, y: rect.y + rect.height / 2 },
    ]);
    await expect(page.getByRole('heading', { name: 'Quiero jugar (2)' })).toBeVisible();
    await expect(page).toHaveURL('/');

    // Quiero jugar → Jugando.
    await swipeRow(page, celeste, 0.55, { startX: 0.2 });
    await expect(toast(page)).toContainText('Celeste pasa a Jugando');
    await expect(page.getByRole('heading', { name: 'Jugando ahora (1)' })).toBeVisible();
    await expect(page).toHaveURL('/');
    await expectStored(page, CELESTE, { status: 'playing' });

    // Jugando → Completado (sale de Pendientes), con Deshacer.
    await swipeRow(page, row(page, 'Celeste'), 0.55, { startX: 0.2 });
    await expect(toast(page)).toContainText('Celeste pasa a Completado');
    await expect(page.getByRole('heading', { name: /^Jugando ahora/ })).toHaveCount(0);
    await toast(page).getByRole('button', { name: 'Deshacer' }).click();
    await expect(page.getByRole('heading', { name: 'Jugando ahora (1)' })).toBeVisible();
    await checks.expectClean();
  });

  test('← enseña las marcas: un toque marca y cierra la bandeja; tocar fuera la cierra', async ({
    page,
  }) => {
    const checks = await setup(page);
    await page.goto('/');
    await capture(page, 'hades ii', 'Hades II');
    const hades = row(page, 'Hades II');
    const tray = page.getByRole('group', { name: 'Marcas: Hades II' });

    await swipeRow(page, hades, -0.5, { startX: 0.8 });
    await expect(tray).toBeVisible();
    await expectAccessible(page, 'bandeja de marcas');
    await tray.getByRole('button', { name: 'Comprado' }).tap();
    await expect(toast(page)).toContainText('Marcado como Comprado: Hades II');
    await expect(tray).toHaveCount(0);
    await expect(hades.getByText('Comprado')).toBeVisible();
    await expectStored(page, HADES, { flags: { owned: true } });

    // Tocar la fila abierta solo cierra la bandeja: ni abre la ficha ni pulsa sus botones.
    await swipeRow(page, hades, -0.5, { startX: 0.8 });
    await expect(tray).toBeVisible();
    const open = await box(hades);
    await page.touchscreen.tap(open.x + 40, open.y + open.height / 2);
    await expect(tray).toHaveCount(0);
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('menu')).toHaveCount(0);

    // Tocar fuera también la cierra, sin cambiar nada.
    await swipeRow(page, hades, -0.5, { startX: 0.8 });
    await expect(tray).toBeVisible();
    await page.getByRole('heading', { level: 1, name: 'Mi lista' }).tap();
    await expect(tray).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Quiero jugar (1)' })).toBeVisible();
    await checks.expectClean();
  });

  test('mantener pulsada una fila abre el selector de estado, sin abrir la ficha', async ({
    page,
  }) => {
    const checks = await setup(page);
    await page.goto('/');
    await capture(page, 'hades ii', 'Hades II');
    const link = row(page, 'Hades II').getByRole('link');
    const rect = await box(link);
    const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    await touchPath(page, [center], { holdMs: 800 });

    const menu = page.getByRole('menu', { name: 'Quiero jugar: cambiar estado de Hades II' });
    await expect(menu).toBeVisible();
    await expect(page).toHaveURL('/');
    await menu.getByRole('menuitemradio', { name: 'En pausa' }).tap();
    await expect(toast(page)).toContainText('Hades II pasa a En pausa');
    await checks.expectClean();
  });

  test('arrastrar :: con el dedo cambia la prioridad', async ({ page }) => {
    const checks = await setup(page);
    await page.goto('/');
    await capture(page, 'hades ii', 'Hades II');
    await capture(page, 'celeste', 'Celeste');
    await capture(page, 'terraria', 'Terraria');
    await expect(page.getByText('Arrastra :: para ordenar')).toBeVisible();

    const handle = await box(row(page, 'Terraria').locator('[data-drag-handle]'));
    const first = await box(row(page, 'Hades II'));
    await touchPath(page, [
      { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 },
      { x: handle.x + handle.width / 2, y: first.y + 4 },
    ]);
    await expect(toast(page)).toContainText('Terraria: prioridad 1 de 3');
    expect(await order(page, 'Quiero jugar')).toEqual([TERRARIA, HADES, CELESTE]);
    await checks.expectClean();
  });

  test('↓ cierra la hoja de la paleta; a medias, vuelve', async ({ page }) => {
    const checks = await setup(page);
    await page.goto('/');
    const input = paletteInput(page);
    await input.tap();
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    const sheet = page.locator('.palette.is-open');
    await expect(sheet).toBeVisible();
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('sin ventana');
    const x = viewport.width / 2;
    const y = viewport.height * 0.4;

    await touchPath(page, [
      { x, y },
      { x, y: y + viewport.width * 0.25 },
    ]);
    await expect(sheet).toBeVisible();
    await expect(sheet).not.toHaveAttribute('style', /translate/);

    await touchPath(page, [
      { x, y },
      { x, y: y + viewport.width * 0.6 },
    ]);
    await expect(sheet).toHaveCount(0);
    await checks.expectClean();
  });

  test('mantener pulsado un resultado de la paleta es «Apuntar como…» (RF-06)', async ({
    page,
  }) => {
    const checks = await setup(page);
    await page.goto('/');
    await paletteInput(page).tap();
    await page.keyboard.type('celeste');
    const option = page.getByRole('option').first();
    await expect(option).toHaveAccessibleName(/^Celeste/);
    const rect = await box(option);
    await touchPath(page, [{ x: rect.x + rect.width / 3, y: rect.y + rect.height / 2 }], {
      holdMs: 800,
    });
    await expect(page.getByText('Apuntar «Celeste» como…')).toBeVisible();
    // No se ha apuntado en Quiero jugar por el toque.
    await expect(toast(page)).not.toContainText('Apuntado');
    await checks.expectClean();
  });

  test('con «Gestos táctiles» apagado, deslizar no hace nada y el asa sigue', async ({ page }) => {
    const checks = await setup(page);
    await page.goto('/');
    await capture(page, 'hades ii', 'Hades II');
    await capture(page, 'celeste', 'Celeste');
    await expectStored(page, CELESTE, { status: 'want_to_play' });
    await page.goto('/ajustes/teclado');
    await page.getByRole('checkbox', { name: 'Gestos táctiles' }).tap();
    await expectStoredSetting(page, 'touchGestures', false);
    await page.goto('/');

    await swipeRow(page, row(page, 'Hades II'), 0.6, { startX: 0.2 });
    await swipeRow(page, row(page, 'Hades II'), -0.5, { startX: 0.8 });
    await expect(page.getByRole('heading', { name: 'Quiero jugar (2)' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Marcas: Hades II' })).toHaveCount(0);

    const handle = await box(row(page, 'Celeste').locator('[data-drag-handle]'));
    const first = await box(row(page, 'Hades II'));
    await touchPath(page, [
      { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 },
      { x: handle.x + handle.width / 2, y: first.y + 4 },
    ]);
    await expect(toast(page)).toContainText('Celeste: prioridad 1 de 2');
    await checks.expectClean();
  });
});

test('arrastrar :: con el ratón cambia la prioridad, y Esc lo cancela', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'con ratón, en escritorio');
  const checks = await setup(page);
  await page.goto('/');
  await capture(page, 'hades ii', 'Hades II');
  await capture(page, 'celeste', 'Celeste');
  await capture(page, 'terraria', 'Terraria');
  await page.keyboard.press('Escape');
  await expect(page.getByText('Arrastra :: o usa Alt+↑/↓')).toBeVisible();

  async function drag(from: string, onto: string, { cancel = false } = {}) {
    const handle = await box(row(page, from).locator('[data-drag-handle]'));
    const target = await box(row(page, onto));
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, target.y + target.height - 4, {
      steps: 10,
    });
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
  }

  // Hades II, de la primera a la última.
  await drag('Hades II', 'Terraria');
  await expect(toast(page)).toContainText('Hades II: prioridad 3 de 3');
  expect(await order(page, 'Quiero jugar')).toEqual([CELESTE, TERRARIA, HADES]);

  // Con Esc no cambia nada, y nada queda desplazado.
  await drag('Celeste', 'Hades II', { cancel: true });
  expect(await order(page, 'Quiero jugar')).toEqual([CELESTE, TERRARIA, HADES]);
  await expect(page.locator('.entry-row[style*="transform"]')).toHaveCount(0);

  // Deshacer devuelve el orden de antes.
  await page.keyboard.press('Control+z');
  await expect.poll(() => order(page, 'Quiero jugar')).toEqual([HADES, CELESTE, TERRARIA]);
  await checks.expectClean();
});
