// «Importar desde Steam» en Ajustes › Datos (Fase 2, parte 2; ADR-012), con la micro-API real de la
// vista previa y el Steam falso de `e2e-api-server.ts`: Steam nunca se llama. La página de Steam la
// sustituye una ruta de Playwright que hace lo que haría Steam al iniciar sesión: volver a
// `return_to` con una aserción firmada por el Steam falso.
//
// - Nadie pide nada a `/api` hasta pulsar «Importar desde Steam», y entonces solo `start`, sin
//   cookies ni `Referer`.
// - En una pestaña: el botón oficial abre Steam en otra ventana, y al volver a la app, el resumen.
// - En la PWA de iOS (simulada): el login acaba en otro contexto (Safari, con otras cookies), y la
//   app canjea el ticket por su cuenta al volver a la vista.
// - El perfil privado, el ticket caducado, sin red y con la importación apagada en el servidor.
// - axe en cada estado. Lo de Steam va a un mundo de Steam por proyecto en la vista previa
//   (`e2e-api-server.ts`), compartido por las pruebas de este fichero, que por eso van en serie.
import type { BrowserContext, Page } from '@playwright/test';
import { expectAccessible, setup } from './helpers.ts';
import { expect, test } from './sync-server.ts';

test.describe.configure({ mode: 'serial' });

/** Un SteamID64 inventado por prueba: cada una tiene su biblioteca en el Steam falso. */
function newSteamId(): string {
  return `765611980${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
}

function steamSection(page: Page) {
  return page.getByRole('region', { name: 'Importar desde Steam' });
}

function steamStatus(page: Page) {
  return steamSection(page).getByRole('status');
}

function signInLink(page: Page) {
  return steamSection(page).getByRole('link', { name: 'Iniciar sesión con Steam' });
}

function button(page: Page, name: string) {
  return steamSection(page).getByRole('button', { name });
}

async function openData(page: Page) {
  await page.goto('/ajustes/datos');
  await expect(page.getByRole('heading', { level: 2, name: 'Datos' })).toBeVisible();
  await expect(steamSection(page)).toBeVisible();
}

/**
 * Hace de Steam en `context`: la página de login vuelve enseguida a `return_to` con una aserción
 * firmada por el Steam falso para `steamId`, como al pulsar «Iniciar sesión» en Steam.
 */
async function actAsSteam(context: BrowserContext, page: Page, steamId: string) {
  await context.route(/^https:\/\/steamcommunity\.com\/openid\/login\?/, async (route) => {
    const returnTo = new URL(route.request().url()).searchParams.get('openid.return_to') ?? '';
    const response = await page.request.post('/__e2e/steam/assertion', {
      data: { returnTo, steamId },
    });
    const { query } = (await response.json()) as { query: string };
    // Steam vuelve con un 302, pero el WebKit de Playwright no deja responder una ruta con una
    // redirección: una página que redirige sola (sin *scripts*) hace lo mismo en los dos motores.
    const back = `${returnTo}&${query}`.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><meta http-equiv="refresh" content="0;url=${back}"><title>Steam</title>`,
    });
  });
}

/** El ticket de la URL del botón de Steam (va en `return_to`). */
async function ticketOf(page: Page): Promise<string> {
  const href = (await signInLink(page).getAttribute('href')) ?? '';
  const returnTo = new URL(href).searchParams.get('openid.return_to') ?? '';
  return new URL(returnTo).searchParams.get('t') ?? '';
}

/** Vuelve a la app como lo haría el usuario: foco y vuelta a la vista. */
async function comeBack(page: Page) {
  await page.bringToFront();
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
}

/**
 * Pulsa el botón oficial: la app pasa a esperar, y Steam se abre en otra ventana, que acaba en la
 * página de la micro-API con `title`.
 */
async function signInInPopup(page: Page, title = 'Listo. Vuelve a GameAgenda') {
  const popupOpened = page.waitForEvent('popup');
  await signInLink(page).click();
  const popup = await popupOpened;
  await expect(popup.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await popup.close();
}

/**
 * Los errores de consola de la página, para las pruebas en las que alguno es esperado (el
 * navegador anota un 410, un 503 o una petición cortada). Las violaciones de CSP, ninguna.
 */
function consoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

async function expectOnly(page: Page, errors: string[], expected: RegExp) {
  expect(errors.filter((error) => !expected.test(error))).toEqual([]);
  expect(await page.evaluate(() => globalThis.__cspViolations)).toEqual([]);
}

test('nada a /api hasta pulsar; después, solo start, sin cookies ni Referer', async ({
  page,
  context,
}) => {
  const api: { line: string; cookie: string | undefined; referer: string | undefined }[] = [];
  context.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (!pathname.startsWith('/api/')) return;
    const headers = request.headers();
    api.push({
      line: `${request.method()} ${pathname}`,
      cookie: headers.cookie,
      referer: headers.referer,
    });
  });
  const checks = await setup(page);
  await openData(page);
  await expect(button(page, 'Importar desde Steam')).toBeVisible();
  await expectAccessible(page, 'Importar desde Steam, sin empezar');
  expect(api).toEqual([]);

  await button(page, 'Importar desde Steam').click();
  await expect(signInLink(page)).toBeVisible();
  await expect(steamStatus(page)).toContainText('Steam se abre en otra ventana.');
  const href = (await signInLink(page).getAttribute('href')) ?? '';
  expect(href.startsWith('https://steamcommunity.com/openid/login?')).toBe(true);
  await expect(signInLink(page)).toHaveAttribute('target', '_blank');
  await expectAccessible(page, 'Importar desde Steam, con el botón de Steam');
  expect(api).toEqual([
    { line: 'POST /api/v1/steam/start', cookie: undefined, referer: undefined },
  ]);
  await checks.expectClean();
});

test('en una pestaña: Steam en otra ventana y, al volver, el resumen sin tocar la lista', async ({
  page,
  context,
}) => {
  const steamId = newSteamId();
  await actAsSteam(context, page, steamId);
  const checks = await setup(page);
  await openData(page);
  await button(page, 'Importar desde Steam').click();
  await signInInPopup(page);
  await comeBack(page);
  await expect(steamStatus(page)).toContainText(
    'Hemos encontrado 4 juegos en tu biblioteca y 3 deseados.',
  );
  await expect(steamStatus(page)).toContainText('De momento no hemos cambiado nada de tu lista.');
  await expectAccessible(page, 'Importar desde Steam, con el resumen');
  // Vuelve a empezar desde cero, y la agenda sigue vacía: en esta parte no se aplica nada.
  await button(page, 'Volver a empezar').click();
  await expect(button(page, 'Importar desde Steam')).toBeVisible();
  await page.goto('/');
  await expect(page.getByText('Stardew Valley')).toHaveCount(0);
  await checks.expectClean();
});

test('PWA de iOS: el login acaba en otro contexto y la app canjea el ticket al volver', async ({
  page,
  browser,
  baseURL,
}) => {
  const steamId = newSteamId();
  const checks = await setup(page);
  await openData(page);
  await button(page, 'Importar desde Steam').click();
  const href = (await signInLink(page).getAttribute('href')) ?? '';
  // Como en la PWA: el enlace se abre en Safari, que no comparte nada con la app. Aquí el clic
  // no navega (se abre a mano en otro contexto), pero la app sí se entera.
  await signInLink(page).evaluate((link) =>
    link.addEventListener('click', (event) => event.preventDefault(), { once: true }),
  );
  await signInLink(page).click();
  await expect(steamStatus(page)).toContainText('Inicia sesión en Steam en la otra ventana.');
  await expectAccessible(page, 'Importar desde Steam, esperando');
  const safari = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
  try {
    const tab = await safari.newPage();
    await actAsSteam(safari, tab, steamId);
    await tab.goto(href);
    await expect(
      tab.getByRole('heading', { level: 1, name: 'Listo. Vuelve a GameAgenda' }),
    ).toBeVisible();
    expect(await safari.cookies()).toEqual([]);
  } finally {
    await safari.close();
  }
  await comeBack(page);
  await expect(steamStatus(page)).toContainText(
    'Hemos encontrado 4 juegos en tu biblioteca y 3 deseados.',
  );
  await checks.expectClean();
});

test('perfil privado: la guía corta y el enlace a la privacidad de Steam', async ({
  page,
  context,
}) => {
  const steamId = newSteamId();
  await page.request.post('/__e2e/steam/library', {
    data: { steamId, owned: { response: {} }, wishlist: { response: {} } },
  });
  await actAsSteam(context, page, steamId);
  const checks = await setup(page);
  await openData(page);
  await button(page, 'Importar desde Steam').click();
  await signInInPopup(page);
  await comeBack(page);
  await expect(steamStatus(page)).toContainText('Tu biblioteca de Steam es privada');
  await expect(steamStatus(page)).toContainText('«Detalles de juegos» en Público');
  await expect(
    steamSection(page).getByRole('link', { name: 'Abrir la privacidad de Steam' }),
  ).toHaveAttribute('href', 'https://steamcommunity.com/my/edit/settings');
  await expectAccessible(page, 'Importar desde Steam, perfil privado');
  await checks.expectClean();
});

test('ticket caducado: lo dice y «Volver a empezar» da uno nuevo que vale', async ({
  page,
  context,
}) => {
  const steamId = newSteamId();
  await actAsSteam(context, page, steamId);
  const errors = consoleErrors(page);
  await setup(page);
  await openData(page);
  await button(page, 'Importar desde Steam').click();
  const ticket = await ticketOf(page);
  await page.request.post('/__e2e/steam/expire', { data: { ticket } });
  await signInInPopup(page, 'Este enlace ya no vale');
  await comeBack(page);
  await expect(steamStatus(page)).toContainText(
    'El inicio de sesión ha caducado o se ha cancelado.',
  );
  await expectAccessible(page, 'Importar desde Steam, caducado');
  await button(page, 'Volver a empezar').click();
  await expect(signInLink(page)).toBeVisible();
  expect(await ticketOf(page)).not.toBe(ticket);
  await signInInPopup(page);
  await comeBack(page);
  await expect(steamStatus(page)).toContainText('Hemos encontrado 4 juegos');
  await expectOnly(page, errors, /status of 410/);
});

test('sin red al volver: lo dice, y «Reintentar» canjea el mismo ticket', async ({
  page,
  context,
}) => {
  const steamId = newSteamId();
  await actAsSteam(context, page, steamId);
  const errors = consoleErrors(page);
  await setup(page);
  await openData(page);
  await button(page, 'Importar desde Steam').click();
  // Antes del login: al cerrar la ventana de Steam, la app puede volver a tener el foco y canjear.
  await page.request.post('/__e2e/steam/hold', {
    data: { pattern: '/api/v1/steam/redeem', mode: 'fail' },
  });
  try {
    await signInInPopup(page);
    await comeBack(page);
    await expect(steamStatus(page)).toContainText('No hay conexión.');
    await expectAccessible(page, 'Importar desde Steam, sin red');
  } finally {
    await page.request.post('/__e2e/steam/release');
  }
  await button(page, 'Reintentar').click();
  await expect(steamStatus(page)).toContainText('Hemos encontrado 4 juegos');
  await expectOnly(page, errors, /ERR_|Failed to load resource|Load failed|network/i);
});

test('con la importación apagada en el servidor, lo dice', async ({ page }) => {
  await page.request.post('/__e2e/steam/config', { data: { steamEnabled: false } });
  try {
    const errors = consoleErrors(page);
    await setup(page);
    await openData(page);
    await button(page, 'Importar desde Steam').click();
    await expect(steamStatus(page)).toContainText(
      'La importación de Steam no está disponible ahora mismo.',
    );
    await expect(button(page, 'Volver a empezar')).toBeVisible();
    await expectAccessible(page, 'Importar desde Steam, apagada');
    await expectOnly(page, errors, /status of 503/);
  } finally {
    await page.request.post('/__e2e/steam/config', { data: { steamEnabled: true } });
  }
});
