// Una versión nueva de la app entra sola cuando no se nota (§5.2; DECISIONES §10.29): tras 1 minuto
// con la página oculta, sin nada a medias y sin otra ventana de la app a la vista.
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { E2E_SW_COOKIE } from '../e2e-sw-plugin.ts';
import { setup, waitForSearch } from './helpers.ts';

test.skip(({ browserName }) => browserName !== 'chromium', 'Service Worker: en Chromium');

/** Más de lo que espera `update-policy.ts` con la página oculta. */
const HIDDEN_WAIT = 61_000;

async function start(page: Page, path = '/') {
  const checks = await setup(page);
  await page.goto(path);
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
  await waitForSearch(page, 'full');
  // El reloj de la página, falso pero en marcha, con la app ya arrancada: así se adelanta el minuto
  // de espera (los temporizadores de la política se crean al ocultarse).
  await page.clock.install();
  return checks;
}

/**
 * Un `sw.js` con otro byte, como tras un despliegue (lo sirve `e2e-sw-plugin.ts` con la *cookie*),
 * y la página que lo encuentra.
 */
async function deployNewVersion(context: BrowserContext, page: Page) {
  await context.addCookies([{ name: E2E_SW_COOKIE, value: 'v2', url: page.url() }]);
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())?.update();
  });
  await expect.poll(() => hasWaiting(page), { timeout: 15_000 }).toBe(true);
}

function hasWaiting(page: Page) {
  return page.evaluate(
    async () => (await navigator.serviceWorker.getRegistration())?.waiting != null,
  );
}

/** La pestaña oculta o a la vista, como la ve la página (`document.visibilityState`). */
async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate((value) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (value ? 'hidden' : 'visible'),
    });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

/** Una marca en la página: si sigue, no ha recargado. */
async function mark(page: Page) {
  await page.evaluate(() => {
    (globalThis as { __e2eSameDocument?: boolean }).__e2eSameDocument = true;
  });
}
function sameDocument(page: Page) {
  return page.evaluate(
    () => (globalThis as { __e2eSameDocument?: boolean }).__e2eSameDocument === true,
  );
}

test('una versión nueva entra al recargar con la página oculta, en la misma ruta', async ({
  page,
  context,
}) => {
  const checks = await start(page, '/?vista=todos');
  await deployNewVersion(context, page);
  await mark(page);

  // A la vista no recarga.
  await page.clock.fastForward(HIDDEN_WAIT);
  expect(await sameDocument(page)).toBe(true);

  const reloaded = page.waitForEvent('load');
  await setHidden(page, true);
  await page.clock.fastForward(HIDDEN_WAIT);
  await reloaded;

  expect(await sameDocument(page)).toBe(false);
  expect(new URL(page.url()).search).toBe('?vista=todos');
  expect(await hasWaiting(page)).toBe(false);
  await expect(page.getByRole('heading', { level: 1, name: 'Mi lista' })).toBeVisible();
  await checks.expectClean();
});

test('con texto a medio escribir en la paleta no recarga; al vaciarla, sí', async ({
  page,
  context,
}) => {
  const checks = await start(page);
  await deployNewVersion(context, page);
  await mark(page);

  const palette = page.getByRole('combobox', { name: 'Apunta un juego' });
  await palette.click();
  await page.keyboard.type('hades');
  await expect(page.getByRole('option').first()).toBeVisible();
  await setHidden(page, true);
  await page.clock.fastForward(HIDDEN_WAIT);
  await page.clock.fastForward(HIDDEN_WAIT);
  expect(await sameDocument(page)).toBe(true);
  expect(await hasWaiting(page)).toBe(true);

  // La persona vuelve, borra lo escrito y se va otra vez.
  await setHidden(page, false);
  await palette.fill('');
  await expect(palette).toHaveAttribute('aria-expanded', 'false');
  const reloaded = page.waitForEvent('load');
  await setHidden(page, true);
  await page.clock.fastForward(HIDDEN_WAIT);
  await reloaded;
  expect(await sameDocument(page)).toBe(false);
  await checks.expectClean();
});

test('con otra pestaña de la app a la vista no la pone; al cerrarla, sí', async ({
  page,
  context,
}) => {
  const checks = await start(page);
  const other = await context.newPage();
  await other.goto('/catalogo');
  await expect(other.getByRole('heading', { level: 1, name: 'Catálogo de Steam' })).toBeVisible();
  await deployNewVersion(context, page);
  await mark(page);

  await setHidden(page, true);
  await page.clock.fastForward(HIDDEN_WAIT);
  // El Service Worker no toma el relevo: la otra pestaña, a la vista, se quedaría sin precaché.
  await page.clock.fastForward(11_000);
  expect(await sameDocument(page)).toBe(true);
  expect(await hasWaiting(page)).toBe(true);

  await other.close();
  const reloaded = page.waitForEvent('load');
  await page.clock.fastForward(HIDDEN_WAIT);
  await reloaded;
  expect(await sameDocument(page)).toBe(false);
  expect(await hasWaiting(page)).toBe(false);
  await checks.expectClean();
});
