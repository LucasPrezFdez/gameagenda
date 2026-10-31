// Portadas y aviso de primera capa (M2; CA2.6 y CA2.7): el aviso sale antes de la primera
// portada; con «Cargar portadas» apagado o el *kill switch* `covers`, 0 peticiones a
// `*.steamstatic.com`; `library_capsule` → `header` → portada generada; 0 violaciones de CSP.
import { expect, type Page, test } from '@playwright/test';
import { coverUrl, serveCovers, serveDetails, watchSteamRequests } from './details.ts';
import { capture, expectAccessible, openPalette, setup } from './helpers.ts';
import { expectStoredSetting } from './storage.ts';

const HADES_II = 1145350;
const CELESTE = 504230;
const HOLLOW_KNIGHT = 367520;
const TERRARIA = 105600;

const GAMES = {
  [HADES_II]: { deck: 3, platforms: 3 },
  // Sin `library_capsule`: va el `header`.
  [CELESTE]: { capsule: null },
  // `library_capsule` roto: cae al `header`.
  [HOLLOW_KNIGHT]: { capsule: 'roto.jpg' },
  // Las dos rotas: la portada generada.
  [TERRARIA]: { capsule: 'roto.jpg', header: 'roto-tambien.jpg' },
};

const notice = (page: Page) => page.getByRole('region', { name: 'Aviso sobre las portadas' });

function rowCover(page: Page, title: string) {
  return page
    .getByRole('main')
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: new RegExp(`${title}$`) }) })
    .locator('.cover');
}

/** La portada de la fila es la imagen `src` y ya está cargada. */
async function expectImage(page: Page, title: string, src: string) {
  const cover = rowCover(page, title);
  // `loading="lazy"`: en el móvil, la fila tiene que estar a la vista.
  await cover.scrollIntoViewIfNeeded();
  await expect(cover).toHaveClass(/has-image/);
  const img = cover.locator('img');
  await expect(img).toHaveAttribute('src', src);
  await expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(img).toHaveAttribute('crossorigin', 'anonymous');
  await expect(img).toHaveAttribute('loading', 'lazy');
  expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
}

test('el aviso de primera capa sale antes de la primera portada y se cierra con «Entendido»', async ({
  page,
  context,
}) => {
  const checks = await setup(page);
  await serveDetails(context, GAMES);
  const covers = await serveCovers(context, { broken: ['roto'] });
  await page.goto('/');
  await capture(page, 'hades ii', 'Hades II');

  await expect(notice(page)).toBeVisible();
  await expect(notice(page)).toContainText(
    'Las portadas se cargan desde servidores de Valve en EE. UU., que reciben tu dirección IP.',
  );
  await expectImage(page, 'Hades II', coverUrl(HADES_II, 'library_600x900_spanish.jpg'));
  expect(covers.length).toBeGreaterThan(0);
  expect(covers.every((request) => request.noticeVisible)).toBe(true);
  await expectStoredSetting(page, 'coverNotice', 'shown');
  await expectAccessible(page, 'Aviso de las portadas');

  // `library_capsule` → `header` → portada generada (§9.5, regla 5).
  await capture(page, 'celeste', 'Celeste');
  await expectImage(page, 'Celeste', coverUrl(CELESTE, 'header.jpg'));
  await capture(page, 'hollow knight', 'Hollow Knight');
  await expectImage(page, 'Hollow Knight', coverUrl(HOLLOW_KNIGHT, 'header.jpg'));
  await capture(page, 'terraria', 'Terraria');
  const terraria = rowCover(page, 'Terraria');
  await terraria.scrollIntoViewIfNeeded();
  await expect(terraria.locator('img')).toHaveCount(0);
  await expect(terraria).not.toHaveClass(/has-image/);
  await expect(terraria).toHaveText('T');
  // Ninguna URL fuera de `asset_url_format` (CA2.6).
  for (const { url } of covers) {
    expect(url).toMatch(
      /^https:\/\/shared\.akamai\.steamstatic\.com\/store_item_assets\/steam\/apps\/\d+\/[a-z0-9_.-]+\.(jpg|png)\?t=1700000000$/,
    );
  }

  // «Entendido» lo cierra para siempre; las portadas siguen.
  await notice(page).getByRole('button', { name: 'Entendido' }).click();
  await expect(notice(page)).toHaveCount(0);
  await expectStoredSetting(page, 'coverNotice', 'done');
  await page.reload();
  await expectImage(page, 'Hades II', coverUrl(HADES_II, 'library_600x900_spanish.jpg'));
  await expect(notice(page)).toHaveCount(0);

  // En la paleta, también (tras 150 ms sin teclear).
  await openPalette(page);
  await page.keyboard.type('celeste');
  const option = page.getByRole('option').first();
  await expect(option).toHaveAccessibleName(/^Celeste/);
  await expect(option.locator('.cover')).toHaveClass(/has-image/);
  await expect(option.locator('img')).toHaveAttribute('src', coverUrl(CELESTE, 'header.jpg'));
  await checks.expectClean();
});

test('«Desactivar portadas» en el aviso: la portada generada y ninguna petición más', async ({
  page,
  context,
}) => {
  const checks = await setup(page);
  await serveDetails(context, GAMES);
  await serveCovers(context);
  await page.goto('/');
  await capture(page, 'hades ii', 'Hades II');
  await notice(page).getByRole('button', { name: 'Desactivar portadas' }).click();
  await expect(notice(page)).toHaveCount(0);
  await expectStoredSetting(page, 'loadCovers', false);
  await expect(rowCover(page, 'Hades II').locator('img')).toHaveCount(0);

  const seen = watchSteamRequests(context);
  await page.reload();
  await capture(page, 'celeste', 'Celeste');
  await page
    .getByRole('main')
    .getByRole('link', { name: /Celeste$/ })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Celeste' })).toBeVisible();
  await expect(page.getByText('Steam Deck: Desconocido')).toBeVisible();
  await page.waitForTimeout(500);
  expect(seen.map((request) => request.url())).toEqual([]);
  await checks.expectClean();
});

test('con «Cargar portadas» apagado: 0 peticiones a *.steamstatic.com y sin aviso (CA2.7)', async ({
  page,
  context,
}) => {
  const checks = await setup(page);
  const details = await serveDetails(context, GAMES);
  const seen = watchSteamRequests(context);
  await page.goto('/ajustes/privacidad');
  await expect(page.getByRole('heading', { level: 2, name: 'Privacidad' })).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 3, name: 'Datos de Steam que guardamos' }),
  ).toBeVisible();
  const toggle = page.getByRole('checkbox', { name: 'Cargar portadas' });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expectStoredSetting(page, 'loadCovers', false);

  await page
    .getByRole('navigation', { name: 'Principal' })
    .getByRole('link', { name: 'Mi lista' })
    .click();
  await capture(page, 'hades ii', 'Hades II');
  await capture(page, 'celeste', 'Celeste');
  await openPalette(page);
  await page.keyboard.type('hollow');
  await expect(page.getByRole('option').first()).toHaveAccessibleName(/^Hollow Knight/);
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page
    .getByRole('main')
    .getByRole('link', { name: /Hades II$/ })
    .click();
  await expect(page.getByText('Steam Deck: Verificado')).toBeVisible();
  await page.waitForTimeout(500);

  expect(seen.map((request) => request.url())).toEqual([]);
  await expect(notice(page)).toHaveCount(0);
  await expect(page.locator('.cover img')).toHaveCount(0);
  // Los detalles sí llegan (son del catálogo propio, no de Valve).
  expect(details.requests.length).toBeGreaterThan(0);
  await checks.expectClean();
});

test('con el *kill switch* `covers`: sin aviso ni peticiones, aunque el ajuste esté encendido', async ({
  page,
  context,
}) => {
  const checks = await setup(page);
  await serveDetails(context, GAMES, { covers: true, details: false });
  const seen = watchSteamRequests(context);
  await page.goto('/');
  await capture(page, 'hades ii', 'Hades II');
  await page
    .getByRole('main')
    .getByRole('link', { name: /Hades II$/ })
    .click();
  await expect(page.getByText('Steam Deck: Verificado')).toBeVisible();
  await page.waitForTimeout(500);
  expect(seen).toEqual([]);
  await expect(notice(page)).toHaveCount(0);

  await page
    .getByRole('navigation', { name: 'Principal' })
    .getByRole('link', { name: 'Ajustes' })
    .click();
  await page.getByRole('link', { name: 'Privacidad', exact: true }).click();
  await expect(
    page.getByText('Ahora mismo las portadas están desactivadas para todos.'),
  ).toBeVisible();
  await expectAccessible(page, 'Ajustes › Privacidad');
  await checks.expectClean();
});
