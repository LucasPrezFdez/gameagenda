// «Importar desde Steam» en Ajustes › Datos (Fase 2, partes 2 y 3; ADR-012), con la micro-API real
// de la vista previa y el Steam falso de `e2e-api-server.ts`: Steam nunca se llama. La página de
// Steam la sustituye una ruta de Playwright que hace lo que haría Steam al iniciar sesión: volver a
// `return_to` con una aserción firmada por el Steam falso.
//
// - Nadie pide nada a `/api` hasta pulsar «Importar desde Steam», y entonces solo `start`, sin
//   cookies ni `Referer`.
// - En una pestaña: el botón oficial abre Steam en otra ventana, y al volver a la app, los logros y
//   el resumen, sin tocar la lista. «Aplicar» la cambia, y «Deshacer» la deja como estaba.
// - En la PWA de iOS (simulada): el login acaba en otro contexto (Safari, con otras cookies), y la
//   app canjea el ticket por su cuenta al volver a la vista.
// - El perfil privado, el ticket caducado, sin red y con la importación apagada en el servidor.
// - axe en cada estado. Lo de Steam va a un mundo de Steam por proyecto en la vista previa
//   (`e2e-api-server.ts`), compartido por las pruebas de este fichero, que por eso van en serie.
import { addEntry, type Entry } from '@gameagenda/core/entries';
import { formatHlc } from '@gameagenda/core/sync';
import type { BrowserContext, Page } from '@playwright/test';
import { v7 as uuidv7 } from 'uuid';
import { expectAccessible, setup, waitForSearch } from './helpers.ts';
import { putEntries, storedEntry, storedMeta } from './storage.ts';
import { expect, test } from './sync-server.ts';

/** El resumen de las *fixtures* (Outer Wilds, con todos los logros). */
const REVIEW = 'Se añadirán 4 juegos de tu biblioteca, como Comprados:';

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
  await expect(steamStatus(page)).toContainText(REVIEW);
  const counts = steamStatus(page).getByRole('listitem');
  await expect(counts).toHaveText([
    '2 a En pausa',
    '1 a Completado, con Platinado (tienen todos los logros)',
    '1 a Sin empezar (no los has jugado)',
  ]);
  const wishlist = steamSection(page).getByRole('checkbox', {
    name: 'Añadir también tu lista de deseados a Quiero jugar (3 juegos)',
  });
  await expect(wishlist).not.toBeChecked();
  await expectAccessible(page, 'Importar desde Steam, con el resumen');
  // «Cancelar»: vuelve a empezar desde cero, y la agenda sigue vacía.
  expect(await storedEntry(page, 'steam:413150')).toBeNull();
  await button(page, 'Cancelar').click();
  await expect(button(page, 'Importar desde Steam')).toBeVisible();
  expect(await storedEntry(page, 'steam:413150')).toBeNull();
  await checks.expectClean();
});

test('«Aplicar»: entran como Comprados (Outer Wilds, Platinado) y «Deshacer» lo quita todo', async ({
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
  await expect(steamStatus(page)).toContainText(REVIEW);
  await steamSection(page).getByRole('checkbox').check();
  await expect(steamStatus(page)).toContainText(
    'Y 3 deseados de tu lista de deseados, a Quiero jugar.',
  );
  await button(page, 'Aplicar').click();
  await expect(steamStatus(page)).toContainText('Hecho: 7 juegos añadidos a tu lista.');
  await expectAccessible(page, 'Importar desde Steam, aplicada');
  await expect
    .poll(() => storedEntry(page, 'steam:753640'))
    .toMatchObject({
      status: 'completed',
      flags: { owned: true, platinum: true },
      platinumAt: '2023-11-26',
      title: 'Outer Wilds',
    });
  expect(await storedEntry(page, 'steam:220')).toMatchObject({
    status: 'on_hold',
    flags: { owned: true },
  });
  expect(await storedEntry(page, 'steam:1245620')).toMatchObject({ status: 'want_to_play' });
  // A Mi lista sin recargar (el flujo vive en memoria, como en la app). En Pendientes: Quiero jugar,
  // solo con los deseados; En pausa (Stardew Valley y Half-Life 2), plegada; y Hades, sin jugar, no
  // sale: está en Sin empezar.
  await page.getByRole('link', { name: 'Mi lista' }).first().click();
  await expect(page.getByRole('region', { name: 'Quiero jugar (3)' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'En pausa (2)' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Quiero jugar: cambiar estado de Hollow Knight' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /cambiar estado de Hades$/ })).toHaveCount(0);
  expect(await storedEntry(page, 'steam:1145360')).toMatchObject({
    status: 'not_started',
    flags: { owned: true },
  });
  // Y de vuelta a Ajustes, con «Atrás».
  await page.goBack();
  await button(page, 'Deshacer').click();
  await expect(steamStatus(page)).toContainText('Importación deshecha');
  await expect
    .poll(async () => ((await storedEntry(page, 'steam:753640')) as Entry).deletedAt)
    .not.toBeNull();
  await button(page, 'Listo').click();
  await expect(button(page, 'Importar desde Steam')).toBeVisible();
  await checks.expectClean();
});

test('lo que ya tenías: gana Comprado sin cambiar de estado', async ({ page, context }) => {
  const steamId = newSteamId();
  await actAsSteam(context, page, steamId);
  const checks = await setup(page);
  await page.goto('/');
  await waitForSearch(page, 'full');
  await expect.poll(() => storedMeta(page, 'searchIndexKey'), { timeout: 15_000 }).not.toBeNull();
  const result = addEntry(
    undefined,
    { id: 'steam:1145360', title: 'Hades', status: 'dropped' },
    {
      hlc: formatHlc({ ms: Date.now() - 60_000, counter: 0, node: 'e2e00002' }),
      today: new Date().toISOString().slice(0, 10),
      newOpId: uuidv7,
      lastRank: null,
    },
  );
  if (!result) throw new Error('No se pudo apuntar Hades');
  await putEntries(page, [result.entry]);
  await page.reload();
  await openData(page);
  await button(page, 'Importar desde Steam').click();
  await signInInPopup(page);
  await comeBack(page);
  await expect(steamStatus(page)).toContainText('Se añadirán 3 juegos de tu biblioteca');
  await expect(steamStatus(page)).toContainText('Uno que ya tenías se marcará como Comprado.');
  await button(page, 'Aplicar').click();
  await expect(steamStatus(page)).toContainText(
    'Hecho: 3 juegos añadidos a tu lista y 1 marcado como Comprado.',
  );
  expect(await storedEntry(page, 'steam:1145360')).toMatchObject({
    status: 'dropped',
    flags: { owned: true },
  });
  await checks.expectClean();
});

test('Software (§10.57): Wallpaper Engine, que estaba en Jugando, pasa a Software', async ({
  page,
  context,
}) => {
  const steamId = newSteamId();
  const yesterday = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
  await page.request.post('/__e2e/steam/library', {
    data: {
      steamId,
      owned: {
        response: {
          game_count: 2,
          games: [
            {
              appid: 431960,
              name: 'Wallpaper Engine',
              playtime_forever: 6000,
              rtime_last_played: yesterday,
            },
            { appid: 1145360, name: 'Hades', playtime_forever: 0 },
          ],
        },
      },
      wishlist: { response: {} },
    },
  });
  await actAsSteam(context, page, steamId);
  const checks = await setup(page);
  await page.goto('/');
  await waitForSearch(page, 'full');
  await expect.poll(() => storedMeta(page, 'searchIndexKey'), { timeout: 15_000 }).not.toBeNull();
  const result = addEntry(
    undefined,
    { id: 'steam:431960', title: 'Wallpaper Engine', status: 'playing' },
    {
      hlc: formatHlc({ ms: Date.now() - 60_000, counter: 0, node: 'e2e00003' }),
      today: new Date().toISOString().slice(0, 10),
      newOpId: uuidv7,
      lastRank: null,
    },
  );
  if (!result) throw new Error('No se pudo apuntar Wallpaper Engine');
  await putEntries(page, [result.entry]);
  await page.reload();
  await openData(page);
  await button(page, 'Importar desde Steam').click();
  await signInInPopup(page);
  await comeBack(page);
  await expect(steamStatus(page)).toContainText(
    'Uno que ya tenías es un programa, no un juego: pasará a Software.',
  );
  await expect(steamStatus(page).getByRole('listitem')).toHaveText([
    '1 a Sin empezar (no los has jugado)',
  ]);
  await expectAccessible(page, 'Importar desde Steam, resumen con Software');
  await button(page, 'Aplicar').click();
  await expect(steamStatus(page)).toContainText('Hecho:');
  expect(await storedEntry(page, 'steam:431960')).toMatchObject({
    status: 'software',
    flags: { owned: true },
  });
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
  await expect(steamStatus(page)).toContainText(REVIEW);
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
  await expect(steamStatus(page)).toContainText(REVIEW);
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
  await expect(steamStatus(page)).toContainText(REVIEW);
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
