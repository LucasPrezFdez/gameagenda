// CA4.5 y CA4.7 con la micro-API real de la vista previa (`sync-server.ts`):
// - el Atajo de iOS: el *token* se enseña una vez, con la dirección y los pasos; un enlace que deja
//   el Atajo (sin `Origin` ni cookies, solo con el *token*) llega a Mi lista en la siguiente
//   sincronización, y revocado desde «Dispositivos» recibe 401;
// - `resolve`: un juego que no está en el catálogo se apunta al instante como provisional y su
//   nombre llega en ≤1,5 s (con el Steam falso de la vista previa, `POST /__e2e/steam`);
// - los textos legales: la primera capa junto a «Activar sincronización», la política y el aviso
//   legal, con axe y a 320 px.
import { DEFAULT_MIN_AGE } from '@gameagenda/core/api';
import type { APIRequestContext, Page } from '@playwright/test';
import { E2E_API_COOKIE } from '../e2e-api-plugin.ts';
import { expectAccessible, openPalette, setup, toast } from './helpers.ts';
import { expectStored } from './storage.ts';
import { expect, serverAgenda, test } from './sync-server.ts';

/** Lo que deja la fachada en `globalThis.__gaSync` (solo en el *build* `e2e`). */
interface SyncHook {
  readonly state: { readonly status: string; readonly deviceId: string | null };
  syncNow(): Promise<void>;
  idle(): Promise<void>;
}

const listRow = (page: Page, title: string) =>
  page.getByRole('main').getByRole('link', { name: new RegExp(`${title}$`) });

function syncSection(page: Page) {
  return page.getByRole('region', { name: 'Sincronización' });
}

async function openSync(page: Page) {
  await page.goto('/ajustes/sincronizacion');
  await expect(page.getByRole('heading', { level: 2, name: 'Sincronización' })).toBeVisible();
}

/** Una ronda y su final. Tras navegar, el gancho tarda un poco en existir: se le espera. */
async function syncNow(page: Page): Promise<void> {
  await page.waitForFunction(() => (globalThis as { __gaSync?: unknown }).__gaSync !== undefined);
  await page.evaluate(async () => {
    const hook = (globalThis as { __gaSync?: SyncHook }).__gaSync;
    await hook?.syncNow();
    await hook?.idle();
  });
}

/** Píxeles que la página se sale por la derecha (0 si no hay desplazamiento horizontal). */
function overflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

async function activate(page: Page): Promise<void> {
  await openSync(page);
  await page.getByRole('checkbox', { name: `Tengo ${DEFAULT_MIN_AGE} años o más` }).check();
  await page.getByRole('button', { name: 'Activar sincronización' }).click();
  await page.getByRole('button', { name: 'Ya lo he guardado' }).click();
  await expect(page.locator('[data-sync-status]')).toContainText('Sincronizado', {
    timeout: 15_000,
  });
}

/**
 * El Atajo de iOS, tal como llama: sin `Origin`, sin cookies del navegador (solo la del mundo de la
 * vista previa, que no llega a la micro-API) y con el *token* en `Authorization`.
 */
async function shortcutClient(
  playwright: { request: { newContext: (o: object) => Promise<APIRequestContext> } },
  baseURL: string,
  world: string,
  browserName: string,
): Promise<APIRequestContext> {
  return playwright.request.newContext({
    baseURL,
    ignoreHTTPSErrors: browserName === 'webkit',
    extraHTTPHeaders: { Cookie: `${E2E_API_COOKIE}=${world}` },
  });
}

test('el Atajo de iOS: token una vez, el enlace llega en la siguiente sincronización y revocado da 401 (CA4.5)', async ({
  page,
  playwright,
  baseURL,
  syncWorld,
  browserName,
}) => {
  const checks = await setup(page);
  await activate(page);
  const inbox = syncSection(page).locator('[data-sync-inbox]');
  await expect(inbox.getByRole('heading', { name: 'Atajo de iOS' })).toBeVisible();
  await inbox.getByRole('button', { name: 'Crear un token para el atajo' }).click();
  await expect(inbox.getByRole('heading', { name: 'Crea el atajo' })).toBeFocused();
  const address = (await inbox.locator('[data-sync-value$="-address"]').textContent()) ?? '';
  const header = (await inbox.locator('[data-sync-value$="-header"]').textContent()) ?? '';
  expect(address).toBe(`${new URL(page.url()).origin}/api/v1/inbox`);
  expect(header).toMatch(/^Bearer [A-Za-z0-9_-]{43}$/);
  await expect(inbox.getByRole('listitem')).toHaveCount(7);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expectAccessible(page, 'El token del Atajo de iOS');
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await overflow(page)).toBe(0);
  await page.setViewportSize({ width: 1280, height: 800 });
  // Sale en «Dispositivos», como Atajo de iOS.
  const device = syncSection(page).locator('.sync__device', { hasText: 'Atajo de iOS' });
  await expect(device).toBeVisible();
  // «Ya he creado el atajo» lo oculta: no se vuelve a ver.
  await inbox.getByRole('button', { name: 'Ya he creado el atajo' }).click();
  await expect(inbox.getByRole('button', { name: 'Crear un token para el atajo' })).toBeFocused();
  await expect(inbox.locator('[data-sync-value]')).toHaveCount(0);

  const shortcut = await shortcutClient(playwright, baseURL ?? '', syncWorld, browserName);
  const sent = await shortcut.post('/api/v1/inbox', {
    data: { url: 'Mira este juego https://store.steampowered.com/app/1145350/Hades_II/' },
    headers: { Authorization: header },
  });
  expect(sent.status()).toBe(201);
  expect(await sent.json()).toMatchObject({ ok: true, appid: 1145350 });

  // La siguiente sincronización lo apunta, con su nombre del catálogo, y lo dice.
  await page.goto('/');
  await syncNow(page);
  await expect(listRow(page, 'Hades II')).toBeVisible();
  await expect(toast(page)).toContainText('Hemos apuntado «Hades II» desde el Atajo de iOS.');
  await expectStored(page, 'steam:1145350', { status: 'want_to_play', deletedAt: null });
  const deviceId = await page.evaluate(
    () => (globalThis as { __gaSync?: SyncHook }).__gaSync?.state.deviceId ?? null,
  );
  // Confirmado en la petición siguiente de la misma ronda.
  await expect
    .poll(async () => (await serverAgenda(page, { device: deviceId ?? '' }))?.rows.inboxItem)
    .toBe(0);

  // Revocado desde Ajustes: 401, con el mensaje para el Atajo.
  await openSync(page);
  await device.getByRole('button', { name: 'Desemparejar: Atajo de iOS' }).click();
  await syncSection(page).getByRole('button', { name: 'Desemparejar: Atajo de iOS' }).click();
  await expect(device).toHaveCount(0);
  const revoked = await shortcut.post('/api/v1/inbox', {
    data: { url: 'https://store.steampowered.com/app/1145350/' },
    headers: { Authorization: header },
  });
  expect(revoked.status()).toBe(401);
  expect((await revoked.json()).message).toMatch(/Este atajo ya no vale/);
  await shortcut.dispose();
  await checks.expectClean();
});

test('un juego que no está en el catálogo: provisional al instante y su nombre en ≤1,5 s (CA4.5)', async ({
  page,
}) => {
  const checks = await setup(page);
  // El Steam falso es uno para todas las pruebas (la app pide `resolve` sin cookies): cada
  // ejecución, con sus `appid`, que no están en el mini-catálogo.
  const known = 4_100_000 + Math.floor(Math.random() * 400_000) * 2;
  const unknown = known + 1;
  const steam = await page.request.post('/__e2e/steam', {
    data: { names: { [known]: 'Mi Juego Indie: Edición Definitiva' } },
  });
  expect(steam.status()).toBe(200);
  await page.goto('/');
  await openPalette(page);
  await page.keyboard.insertText(`https://store.steampowered.com/app/${known}/Mi_Juego_Indie/`);
  await expect(page.getByRole('option').first()).toHaveAccessibleName(
    /^Apuntar «Mi Juego Indie».*Provisional/,
  );
  await page.keyboard.press('Enter');
  const captured = Date.now();
  await expect(toast(page)).toContainText('Apuntado: «Mi Juego Indie» (provisional).');
  await expect(listRow(page, 'Mi Juego Indie: Edición Definitiva')).toBeVisible({
    timeout: 5000,
  });
  expect(Date.now() - captured).toBeLessThanOrEqual(1500);
  await expectStored(page, `steam:${known}`, { title: 'Mi Juego Indie: Edición Definitiva' });
  // Un juego que Steam no conoce se queda como estaba, sin errores en la consola.
  await openPalette(page);
  await page.keyboard.insertText(`appid:${unknown}`);
  await page.keyboard.press('Enter');
  await expect(toast(page)).toContainText(`Apuntado: «Juego de Steam ${unknown}» (provisional).`);
  await expect
    .poll(
      async () => (await (await page.request.get(`/__e2e/steam?appid=${unknown}`)).json()).calls,
    )
    .toBe(1);
  await expect(listRow(page, `Juego de Steam ${unknown}`)).toBeVisible();
  await checks.expectClean();
});

test('los textos legales: la primera capa junto a «Activar», la política y el aviso legal (CA4.7)', async ({
  page,
}) => {
  const checks = await setup(page);
  await openSync(page);
  const legal = syncSection(page).locator('[data-sync-legal]');
  await expect(legal).toContainText('Responsable:');
  await expect(legal).toContainText('Cloudflare en la Unión Europea');
  await legal.getByRole('link', { name: 'política de privacidad' }).click();
  await expect(page).toHaveURL('/privacidad');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Política de privacidad' }),
  ).toBeVisible();
  await expect(page).toHaveTitle(/Política de privacidad/);
  await expect(page.getByRole('navigation', { name: 'Secciones' }).getByRole('link')).toHaveCount(
    11,
  );
  await page
    .getByRole('navigation', { name: 'Secciones' })
    .getByRole('link', {
      name: 'Tus derechos',
    })
    .click();
  await expect(page.getByRole('heading', { level: 2, name: 'Tus derechos' })).toBeFocused();
  await expect(page).toHaveURL('/privacidad');
  await page.evaluate(() => window.scrollTo(0, 0));
  await expectAccessible(page, 'Política de privacidad');
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await overflow(page)).toBe(0);
  await page.setViewportSize({ width: 1280, height: 800 });

  // Desde Acerca de, los dos.
  await page.goto('/ajustes/acerca-de');
  await page.getByRole('link', { name: 'Aviso legal y condiciones de uso' }).click();
  await expect(page).toHaveURL('/aviso-legal');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Aviso legal y condiciones de uso' }),
  ).toBeVisible();
  await expectAccessible(page, 'Aviso legal');
  await page.getByRole('link', { name: 'política de privacidad' }).click();
  await expect(page).toHaveURL('/privacidad');
  await checks.expectClean();
});
