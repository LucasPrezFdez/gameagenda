// Más vías de captura (M3; RF-07, §9.2 y CA3.3): «Compartir» en Android (`share_target`, GET a
// `/share`), `Ctrl+V` con un enlace de Steam en cualquier pantalla y el chip «Pegar enlace». El
// acceso directo «Apuntar juego» (`/apuntar`) ya lo prueba `desktop.spec.ts`. La PWA instalada y
// la app de Steam no se pueden probar aquí: van en la prueba en el Android de referencia.
import { devices, expect, type Page, test } from '@playwright/test';
import { paletteInput, setup, toast } from './helpers.ts';
import { expectStored } from './storage.ts';

const HADES_URL = 'https://store.steampowered.com/app/1145350/Hades_II/';

const listRow = (page: Page, title: string) =>
  page.getByRole('main').getByRole('link', { name: new RegExp(`${title}$`) });

/** Un `paste` como el de `Ctrl+V` fuera de un campo (en `document.body` o en `selector`). */
async function pasteOutside(page: Page, text: string, selector = 'body') {
  await page.evaluate(
    ([data, target]) => {
      const transfer = new DataTransfer();
      transfer.setData('text/plain', data);
      const element = document.querySelector(target) ?? document.body;
      element.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
    },
    [text, selector] as const,
  );
}

test('«Compartir» con un enlace lo apunta con Deshacer y deja Mi lista en el historial (CA3.3)', async ({
  page,
}) => {
  const checks = await setup(page);
  await page.goto(`/share?url=${encodeURIComponent(HADES_URL)}&title=Hades%20II`);
  await expect(toast(page)).toContainText('Apuntado en Quiero jugar: Hades II');
  await expect(page).toHaveURL('/');
  await expect(listRow(page, 'Hades II')).toBeVisible();
  await expectStored(page, 'steam:1145350', { status: 'want_to_play' });
  await toast(page).getByRole('button', { name: 'Deshacer' }).click();
  await expect(listRow(page, 'Hades II')).toHaveCount(0);
  await checks.expectClean();
});

test('«Compartir» desde la app de Steam (enlace dentro del texto) y sin enlace, a la paleta', async ({
  page,
}) => {
  const checks = await setup(page);
  // La app de Steam manda el enlace en `text`, con más texto alrededor.
  const text = 'Mira este juego en Steam: https://store.steampowered.com/app/504230/Celeste/';
  await page.goto(`/share?text=${encodeURIComponent(text)}`);
  await expect(toast(page)).toContainText('Apuntado en Quiero jugar: Celeste');
  await expect(page).toHaveURL('/');
  await expectStored(page, 'steam:504230', { status: 'want_to_play' });

  // Otra vez el mismo: no lo duplica.
  await page.goto(`/share?url=${encodeURIComponent('https://s.team/a/504230')}`);
  await expect(toast(page)).toContainText('Celeste ya está en tu lista: Quiero jugar.');

  // Sin enlace: la paleta, con el texto ya buscado.
  await page.goto('/share?text=hollow%20knight');
  await expect(page).toHaveURL('/');
  await expect(paletteInput(page)).toBeFocused();
  await expect(paletteInput(page)).toHaveValue('hollow knight');
  await expect(page.getByRole('option').first()).toHaveAccessibleName(/^Hollow Knight/);
  await checks.expectClean();
});

test('Ctrl+V con un enlace lo apunta desde cualquier pantalla; en un campo, pega (CA3.3)', async ({
  page,
}) => {
  const checks = await setup(page);
  await page.goto('/');
  await expect(paletteInput(page)).toBeAttached();
  await pasteOutside(page, HADES_URL);
  await expect(toast(page)).toContainText('Apuntado en Quiero jugar: Hades II');
  await expect(listRow(page, 'Hades II')).toBeVisible();

  // Desde Ajustes, un `appid` desconocido: provisional con el título del *slug*.
  await page
    .getByRole('navigation', { name: 'Principal' })
    .getByRole('link', { name: 'Ajustes' })
    .click();
  await expect(page).toHaveURL('/ajustes');
  await pasteOutside(page, 'https://store.steampowered.com/app/3999990/Mi_Juego_Indie/');
  await expect(toast(page)).toContainText('Apuntado: «Mi Juego Indie» (provisional).');
  await expectStored(page, 'steam:3999990', { title: 'Mi Juego Indie' });

  // Texto que no es un enlace: no se toca.
  await pasteOutside(page, 'hola');
  await expect(toast(page)).toContainText('Mi Juego Indie');

  // En un campo de texto se pega como siempre: el filtro del Catálogo.
  await page
    .getByRole('navigation', { name: 'Principal' })
    .getByRole('link', { name: 'Catálogo' })
    .click();
  const filter = page.getByRole('textbox', { name: 'Filtrar el catálogo' });
  await filter.focus();
  await pasteOutside(page, 'https://s.team/a/504230', 'input[data-filter-field]');
  await expect(toast(page)).not.toContainText('Celeste');
  await expectStored(page, 'steam:3999990', { title: 'Mi Juego Indie' });
  await checks.expectClean();
});

test('Ctrl+V de verdad, con el portapapeles del sistema y el foco en la página', async ({
  page,
  context,
  browserName,
  isMobile,
}) => {
  test.skip(browserName !== 'chromium' || isMobile, 'permisos de portapapeles: Chromium');
  const checks = await setup(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/catalogo');
  await expect(page.getByRole('heading', { level: 1, name: 'Catálogo' })).toBeVisible();
  await page.evaluate((url) => navigator.clipboard.writeText(url), HADES_URL);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+v');
  await expect(toast(page)).toContainText('Apuntado en Quiero jugar: Hades II');
  await expectStored(page, 'steam:1145350', { status: 'want_to_play' });
  await checks.expectClean();
});

test('el manifest declara «Compartir» y el acceso directo «Apuntar juego»', async ({ page }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = await (await page.request.get(href ?? '/manifest.webmanifest')).json();
  expect(manifest.share_target).toEqual({
    action: '/share',
    method: 'GET',
    params: { title: 'title', text: 'text', url: 'url' },
  });
  expect(manifest.shortcuts).toContainEqual(
    expect.objectContaining({ name: 'Apuntar juego', url: '/apuntar' }),
  );
});

test.describe('chip «Pegar enlace» (con el dedo)', () => {
  test.use({
    viewport: devices['Pixel 7'].viewport,
    userAgent: devices['Pixel 7'].userAgent,
    isMobile: true,
    hasTouch: true,
  });
  test.skip(({ browserName }) => browserName !== 'chromium', 'móvil emulado en Chromium');

  test('lee el portapapeles y apunta el enlace; sin enlace, lo dice', async ({ page }) => {
    const checks = await setup(page);
    await page.addInitScript(() => {
      const clip = { text: '' };
      (globalThis as { __clip?: typeof clip }).__clip = clip;
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { readText: async () => clip.text, writeText: async () => undefined },
      });
    });
    await page.goto('/');
    const setClipboard = (text: string) =>
      page.evaluate((value) => {
        const clip = (globalThis as { __clip?: { text: string } }).__clip;
        if (clip) clip.text = value;
      }, text);

    await setClipboard('nada que ver');
    await paletteInput(page).tap();
    const chip = page.getByRole('button', { name: 'Pegar enlace' });
    await chip.tap();
    await expect(page.getByText('No hay ningún enlace de Steam en el portapapeles.')).toBeVisible();

    await setClipboard(`Mira: ${HADES_URL}`);
    await chip.tap();
    await expect(toast(page)).toContainText('Apuntado en Quiero jugar: Hades II');
    await expect(page.locator('.palette.is-open')).toHaveCount(0);
    await expect(listRow(page, 'Hades II')).toBeVisible();
    await checks.expectClean();
  });
});
