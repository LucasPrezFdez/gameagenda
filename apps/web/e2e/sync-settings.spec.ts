// Ajustes › Sincronización (M4) con la micro-API real de la vista previa (`sync-server.ts`): activar
// con la declaración de edad y el código de recuperación una sola vez; emparejar otro dispositivo
// con el enlace del QR (`/emparejar#código`, que sale de la URL y nunca se canjea solo); la lista de
// dispositivos y «Desemparejar»; «Borrar todos mis datos» también en el servidor (CA4.7) y, sin
// red o ya desemparejado (401), sin borrar nada; y Mi lista vacía mientras se restaura la agenda
// (CA4.3). Con axe y a 320 px en los estados que solo salen con la micro-API, los estados ocupados
// (con la petición retenida en la vista previa: `holdServer()`), el foco tras cada cambio de vista,
// la nota de Safari de iOS y el reloj del dispositivo adelantado. Los dos contextos de CA4.2 y los
// borrados de CA4.3 completos van en sus propias pruebas.
import { DEFAULT_MIN_AGE, DEVICE_LABEL_MAX as LABEL_MAX } from '@gameagenda/core/api';
import type { Page } from '@playwright/test';
import { capture, expectAccessible, setup, toast } from './helpers.ts';
import { expectStored } from './storage.ts';
import {
  expect,
  holdServer,
  pageCookies,
  releaseServer,
  SYNC_HINT_COOKIE_NAME,
  serverAgenda,
  serverHolding,
  test,
} from './sync-server.ts';

const CODE = /^[0-9A-Z]{4}(?:-[0-9A-Z]{4}){6}$/;

function syncSection(page: Page) {
  return page.getByRole('region', { name: 'Sincronización' });
}

async function openSync(page: Page) {
  await page.goto('/ajustes/sincronizacion');
  await expect(page.getByRole('heading', { level: 2, name: 'Sincronización' })).toBeVisible();
}

/** Lo que deja la fachada en `globalThis.__gaSync` (solo en el *build* `e2e`; `e2e-hooks.ts`). */
interface SyncHook {
  readonly state: { readonly status: string; readonly deviceId: string | null };
  syncNow(): Promise<void>;
  idle(): Promise<void>;
}

function syncStatus(page: Page) {
  return page.evaluate(
    () => (globalThis as { __gaSync?: SyncHook }).__gaSync?.state.status ?? null,
  );
}

/** Espera a que no haya ronda ni restauración en marcha. */
async function syncIdle(page: Page): Promise<void> {
  await page.evaluate(() => (globalThis as { __gaSync?: SyncHook }).__gaSync?.idle());
}

/**
 * axe con la página arriba del todo, como las demás comprobaciones. Tras mover el foco a un
 * encabezado de más abajo, la fila del título (con «Apuntar un juego») queda bajo la cabecera fija
 * y axe la marca como `target-size` (tapada), que no es de lo que se comprueba aquí.
 */
async function expectAccessibleAtTop(page: Page, label: string): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await expectAccessible(page, label);
}

/** Píxeles que la página se sale por la derecha (0 si no hay desplazamiento horizontal). */
function overflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

function codeText(page: Page) {
  return page.locator('[data-sync-code]').first().textContent();
}

/** Activa la sincronización desde Ajustes y devuelve el código de recuperación que enseña. */
async function activate(page: Page, label?: string): Promise<string> {
  await openSync(page);
  if (label !== undefined) {
    await page.getByRole('textbox', { name: 'Nombre de este dispositivo' }).fill(label);
  }
  await page.getByRole('checkbox', { name: `Tengo ${DEFAULT_MIN_AGE} años o más` }).check();
  await page.getByRole('button', { name: 'Activar sincronización' }).click();
  await expect(page.getByRole('heading', { name: 'Tu código de recuperación' })).toBeFocused();
  const code = (await codeText(page)) ?? '';
  expect(code).toMatch(CODE);
  await page.getByRole('button', { name: 'Ya lo he guardado' }).click();
  await expect(page.getByRole('heading', { name: 'Estado' })).toBeFocused();
  await expect(page.locator('[data-sync-status]')).toContainText('Sincronizado', {
    timeout: 15_000,
  });
  return code;
}

/** «Emparejar otro dispositivo» en una sección ya emparejada: el código que enseña. */
async function newPairingCode(page: Page): Promise<string> {
  const section = syncSection(page);
  await section.getByRole('button', { name: 'Emparejar otro dispositivo' }).click();
  await expect(section.getByRole('heading', { name: 'Código de emparejamiento' })).toBeFocused();
  const code = (await codeText(page)) ?? '';
  expect(code).toMatch(CODE);
  return code;
}

test('activar: pide la edad, enseña el código de recuperación una vez y queda emparejada', async ({
  page,
}) => {
  const checks = await setup(page);
  await openSync(page);
  const section = syncSection(page);
  // Qué guarda y dónde, la cookie que crea el gesto y el hueco de los textos legales.
  await expect(section.getByText(/Cloudflare en la Unión Europea/)).toBeVisible();
  await expect(section.getByText(/guarda dos cookies/)).toBeVisible();
  await expect(section.locator('[data-sync-legal]')).toBeVisible();
  // El nombre, prellenado según el navegador y el sistema.
  await expect(section.getByRole('textbox', { name: 'Nombre de este dispositivo' })).toHaveValue(
    /^\S.* en \S/,
  );
  await expectAccessible(page, 'Sincronización sin activar');

  // Sin la casilla de edad no se activa: lo dice junto a la casilla y le lleva el foco.
  await section.getByRole('button', { name: 'Activar sincronización' }).click();
  const age = section.getByRole('checkbox', { name: `Tengo ${DEFAULT_MIN_AGE} años o más` });
  await expect(age).toBeFocused();
  await expect(age).toHaveAttribute('aria-invalid', 'true');
  await expect(age).toHaveAccessibleDescription(
    `Para sincronizar tienes que tener ${DEFAULT_MIN_AGE} años o más. Si es tu caso, marca la casilla.`,
  );
  expect(await syncStatus(page)).toBe('off');

  // Sin nombre, tampoco.
  const name = section.getByRole('textbox', { name: 'Nombre de este dispositivo' });
  await name.fill('   ');
  await age.check();
  await section.getByRole('button', { name: 'Activar sincronización' }).click();
  await expect(name).toBeFocused();
  await expect(name).toHaveAccessibleDescription(/Escribe un nombre para este dispositivo/);
  await name.fill('PC de prueba');

  await section.getByRole('button', { name: 'Activar sincronización' }).click();
  await expect(section.getByRole('heading', { name: 'Tu código de recuperación' })).toBeFocused();
  expect(await codeText(page)).toMatch(CODE);
  await expect(section.getByText('Solo lo verás ahora.', { exact: false })).toBeVisible();
  await expectAccessible(page, 'Código de recuperación');
  // A 320 px (el zoom al 400 %), el código se parte por grupos y nada se sale (WCAG 1.4.10).
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await overflow(page), 'código de recuperación a 320 px').toBeLessThanOrEqual(0);
  if (viewport) await page.setViewportSize(viewport);

  await section.getByRole('button', { name: 'Ya lo he guardado' }).click();
  await expect(section.getByRole('heading', { name: 'Estado' })).toBeFocused();
  await expect(section.locator('[data-sync-status]')).toContainText('Sincronizado', {
    timeout: 15_000,
  });
  // El código ya no se ve, y no vuelve al recargar.
  await expect(section.locator('[data-sync-code]')).toHaveCount(0);
  const devices = section.getByRole('list', { name: 'Dispositivos' });
  await expect(devices.getByRole('listitem')).toHaveCount(1);
  await expect(devices).toContainText('PC de prueba');
  await expect(devices).toContainText('Este dispositivo');
  expect(await pageCookies(page)).toContain(`${SYNC_HINT_COOKIE_NAME}=1`);
  expect(await syncStatus(page)).toBe('paired');
  await expectAccessible(page, 'Sincronización emparejada');

  await page.reload();
  await expect(syncSection(page).getByRole('heading', { name: 'Estado' })).toBeVisible();
  await expect(syncSection(page).locator('[data-sync-code]')).toHaveCount(0);
  await checks.expectClean();
});

test('emparejar con el enlace del QR: sale de la URL, no se canjea solo y el otro lo ve', async ({
  page,
  newDevice,
}) => {
  test.setTimeout(60_000);
  const checks = await setup(page);
  await activate(page, 'PC de prueba');
  const section = syncSection(page);

  await section.getByRole('button', { name: 'Emparejar otro dispositivo' }).click();
  await expect(section.getByRole('heading', { name: 'Código de emparejamiento' })).toBeFocused();
  const qr = section.getByRole('img', { name: 'Código QR para emparejar otro dispositivo' });
  await expect(qr).toBeVisible();
  // Se lee bien con una cámara: al menos 200 px de lado, y oscuro sobre claro.
  const box = await qr.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(200);
  await expect(section.locator('[data-sync-countdown]')).toHaveText(/^Caduca en (10:00|9:\d\d)\.$/);
  const code = (await codeText(page)) ?? '';
  expect(code).toMatch(CODE);
  await expectAccessible(page, 'Código de emparejamiento');
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 640 });
  await expect(qr).toBeVisible();
  expect(await overflow(page), 'QR y código a 320 px').toBeLessThanOrEqual(0);
  if (viewport) await page.setViewportSize(viewport);

  const other = await newDevice();
  await setup(other);
  await other.goto(`/emparejar#${code.toLowerCase()}`);
  const otherSection = syncSection(other);
  const pair = otherSection.getByRole('button', { name: 'Emparejar este dispositivo' });
  await expect(pair).toBeFocused();
  // El código no se queda en la URL ni en el historial, y no se ha canjeado solo.
  expect(other.url()).toMatch(/\/ajustes\/sincronizacion$/);
  expect(await other.evaluate(() => location.hash)).toBe('');
  await expect(otherSection.getByRole('textbox', { name: 'Código' })).toHaveValue(
    code.toLowerCase(),
  );
  await expect(pair).toHaveAccessibleDescription(/Has abierto un enlace para emparejar/);
  expect(await syncStatus(other)).toBe('off');

  // Fuera de Safari de iOS, la nota del enlace no habla de Safari.
  await expect(pair).not.toHaveAccessibleDescription(/Este enlace se ha abierto en Safari/);

  // En Safari de iPhone o iPad (fuera de la pantalla de inicio), la nota avisa de que la app de
  // la pantalla de inicio guarda sus datos aparte. Solo se abre el enlace: el código no se gasta.
  const safari = await newDevice();
  await safari.addInitScript(() =>
    Object.defineProperty(Navigator.prototype, 'standalone', { get: () => false }),
  );
  await setup(safari);
  await safari.goto(`/emparejar#${code.toLowerCase()}`);
  const safariPair = syncSection(safari).getByRole('button', {
    name: 'Emparejar este dispositivo',
  });
  await expect(safariPair).toBeFocused();
  await expect(safariPair).toHaveAccessibleDescription(/Este enlace se ha abierto en Safari/);
  await safari.close();

  await otherSection.getByRole('textbox', { name: 'Nombre de este dispositivo' }).fill('Móvil');
  await pair.click();
  await expect(otherSection.getByRole('heading', { name: 'Estado' })).toBeFocused();
  await expect(otherSection.getByText('Este dispositivo ya está emparejado.')).toBeVisible();
  // El código del enlace ya está gastado: la vista emparejada no lo menciona.
  await expect(otherSection.getByText('no necesita el código del enlace')).toHaveCount(0);
  await expect(
    otherSection.getByRole('list', { name: 'Dispositivos' }).getByRole('listitem'),
  ).toHaveCount(2);

  // El primero se entera solo (mira la lista cada 5 s mientras enseña el código) y lo oculta. Lo
  // dice en el aviso de la app, que no empuja nada (§9.5).
  await expect(toast(page)).toContainText('«Móvil» ya está emparejado.', { timeout: 15_000 });
  await expect(section.locator('[data-sync-code]')).toHaveCount(0);
  const devices = section.getByRole('list', { name: 'Dispositivos' });
  await expect(devices.getByRole('listitem')).toHaveCount(2);

  // Desemparejar el otro, con confirmación en el sitio.
  await devices.getByRole('button', { name: 'Desemparejar: Móvil' }).click();
  await expect(devices.getByRole('group')).toContainText('¿Desemparejar «Móvil»?');
  await expect(devices.getByRole('button', { name: 'Desemparejar: Móvil' })).toBeFocused();
  await devices.getByRole('button', { name: 'Desemparejar: Móvil' }).click();
  await expect(toast(page)).toContainText('Hemos desemparejado «Móvil».');
  await expect(devices.getByRole('listitem')).toHaveCount(1);
  await checks.expectClean();

  // El otro lo sabe en su siguiente ronda (401) y conserva su agenda. El foco estaba en
  // «Sincronizar ahora», que desaparece con la vista: va al encabezado de la vista nueva.
  await otherSection.getByRole('button', { name: 'Sincronizar ahora' }).focus();
  await other.evaluate(() => (globalThis as { __gaSync?: SyncHook }).__gaSync?.syncNow());
  const unpairedHeading = otherSection.getByRole('heading', {
    name: 'Este dispositivo ya no sincroniza',
  });
  await expect(unpairedHeading).toBeVisible();
  await expect(unpairedHeading).toBeFocused();
  await expect(otherSection.locator('[data-sync-unpaired="server"]')).toBeVisible();
  await expect(
    otherSection.getByRole('button', { name: 'Usar código de recuperación' }),
  ).toBeVisible();
  // El código del enlace se olvidó al emparejar: ni rellena el campo ni lo menciona.
  await expect(otherSection.getByRole('textbox', { name: 'Código' })).toHaveValue('');
  await expect(otherSection.getByText('Has abierto un enlace')).toHaveCount(0);
  await expect(
    otherSection.getByRole('button', { name: 'Emparejar este dispositivo' }),
  ).not.toBeFocused();
  // El aviso de la vista emparejada se ha ido con ella.
  await expect(otherSection.getByText('Este dispositivo ya está emparejado.')).toHaveCount(0);
  // Volver a emparejar crea otra vez las cookies: aquí también se avisa, con el hueco legal.
  await expect(otherSection.locator('[data-sync-legal]')).toBeVisible();
  await expect(otherSection.getByText(/guarda dos cookies/)).toBeVisible();
  await expectAccessibleAtTop(other, 'Sincronización desemparejada por el servidor');
});

test('con un código mal escrito no llama al servidor; uno inventado no vale', async ({ page }) => {
  await setup(page);
  await openSync(page);
  const section = syncSection(page);
  const field = section.getByRole('textbox', { name: 'Código' });
  let redeems = 0;
  page.on('request', (request) => {
    if (request.url().includes('/redeem')) redeems += 1;
  });

  await field.fill('ABCD-EFGH');
  await section.getByRole('button', { name: 'Emparejar este dispositivo' }).click();
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAccessibleDescription(/está incompleto/);
  expect(redeems).toBe(0);

  // Con O, I y L en vez de 0 y 1, en minúsculas y con espacios: tiene la forma de un código.
  await field.fill('oooo iiii llll 2345 6789 abcd efgh');
  await section.getByRole('button', { name: 'Usar código de recuperación' }).click();
  await expect(field).toHaveAccessibleDescription(/Este código de recuperación no vale/);
  expect(redeems).toBe(1);
  expect(await syncStatus(page)).toBe('off');
});

test('«Borrar todos mis datos» con la sincronización activada borra también el servidor (CA4.7)', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const checks = await setup(page);
  await page.goto('/');
  await capture(page, 'celeste', 'Celeste');
  await expectStored(page, 'steam:504230', { title: 'Celeste' });
  await activate(page);
  const deviceId = await page.evaluate(
    () => (globalThis as { __gaSync?: SyncHook }).__gaSync?.state.deviceId ?? null,
  );
  expect(deviceId).not.toBeNull();
  const before = await serverAgenda(page, { device: deviceId ?? '' });
  expect(before?.rows.op ?? 0).toBeGreaterThan(0);

  await page.goto('/ajustes/datos');
  await expect(page.getByText(/y tu agenda sincronizada del servidor/)).toBeVisible();
  await page.getByRole('button', { name: 'Borrar todos mis datos' }).click();
  await page.getByRole('textbox', { name: 'Escribe BORRAR para confirmar' }).fill('BORRAR');
  // Mientras espera al servidor, el botón está ocupado (`aria-disabled`, no `disabled`), lo dice y
  // conserva el foco (§9.7). Con el teclado, para que el foco esté en él en los dos motores.
  await holdServer(page, /^\/api\/v1\/agenda\/delete$/);
  await page.getByRole('button', { name: 'Borrar todo' }).press('Enter');
  await serverHolding(page);
  const busy = page.getByRole('button', { name: 'Borrando…' });
  await expect(busy).toHaveAttribute('aria-disabled', 'true');
  await expect(busy).toBeFocused();
  await expectAccessibleAtTop(page, 'Borrar todo, ocupado');
  await releaseServer(page);
  await expect(toast(page)).toContainText(
    'Hemos borrado todos tus datos de este dispositivo y tu agenda sincronizada del servidor.',
  );
  // El formulario se cierra y el foco vuelve a «Borrar todos mis datos».
  await expect(page.getByRole('button', { name: 'Borrar todos mis datos' })).toBeFocused();
  const after = await serverAgenda(page, { agenda: before?.agendaId ?? '' });
  expect(after?.exists).toBe(false);
  expect(await pageCookies(page)).not.toContain(SYNC_HINT_COOKIE_NAME);

  // Nada vuelve al recargar: ni la agenda ni la sincronización.
  await page.goto('/');
  await expect(page.getByText('Tu agenda está vacía', { exact: false })).toBeVisible();
  await expect.poll(() => syncStatus(page)).toBe('off');
  await checks.expectClean();
});

test('sin red, «Borrar todos mis datos» no borra nada y lo dice', async ({ page, context }) => {
  test.setTimeout(60_000);
  await setup(page);
  await page.goto('/');
  await capture(page, 'celeste', 'Celeste');
  await expectStored(page, 'steam:504230', { title: 'Celeste' });
  await activate(page);
  await page.goto('/ajustes/datos');
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Borrar todos mis datos' }).click();
  await page.getByRole('textbox', { name: 'Escribe BORRAR para confirmar' }).fill('BORRAR');
  await page.getByRole('button', { name: 'Borrar todo' }).press('Enter');
  await expect(page.getByRole('alert')).toContainText('así que no hemos borrado nada');
  // El foco sigue en el botón, desde el que se vuelve a intentar.
  await expect(page.getByRole('button', { name: 'Borrar todo' })).toBeFocused();
  await expectStored(page, 'steam:504230', { title: 'Celeste' });
  expect(await syncStatus(page)).toBe('paired');
  await context.setOffline(false);
});

test('«Borrar todos mis datos» en un dispositivo ya desemparejado no borra nada y lo dice (CA4.7)', async ({
  page: a,
  newDevice,
}) => {
  test.setTimeout(90_000);
  await setup(a);
  await a.goto('/');
  await capture(a, 'celeste', 'Celeste');
  await expectStored(a, 'steam:504230', { title: 'Celeste' });
  await activate(a, 'PC');
  const deviceId = await a.evaluate(
    () => (globalThis as { __gaSync?: SyncHook }).__gaSync?.state.deviceId ?? null,
  );
  const agendaId = (await serverAgenda(a, { device: deviceId ?? '' }))?.agendaId ?? '';
  expect(agendaId).not.toBe('');
  const pairing = await newPairingCode(a);

  const b = await newDevice();
  await setup(b);
  await openSync(b);
  const sectionB = syncSection(b);
  await sectionB.getByRole('textbox', { name: 'Nombre de este dispositivo' }).fill('Móvil');
  await sectionB.getByRole('textbox', { name: 'Código' }).fill(pairing);
  await sectionB.getByRole('button', { name: 'Emparejar este dispositivo' }).click();
  await expect(sectionB.getByRole('heading', { name: 'Estado' })).toBeFocused();

  // A abre Ajustes › Datos (con la ronda del arranque ya acabada): aún cree que está emparejado.
  await a.goto('/ajustes/datos');
  await expect(a.getByText(/y tu agenda sincronizada del servidor/)).toBeVisible();
  await syncIdle(a);
  expect(await syncStatus(a)).toBe('paired');

  // B desempareja a A. Mientras espera al servidor, el botón dice «Desemparejando…», está ocupado
  // y conserva el foco; al soltarlo, todo sigue como siempre.
  const devicesB = sectionB.getByRole('list', { name: 'Dispositivos' });
  await expect(devicesB.getByRole('listitem')).toHaveCount(2);
  await devicesB.getByRole('button', { name: 'Desemparejar: PC' }).click();
  await holdServer(b, /^\/api\/v1\/devices\/[^/]+\/revoke$/);
  // Con el teclado: en WebKit, un clic no deja el foco en un botón.
  await devicesB.getByRole('button', { name: 'Desemparejar: PC' }).press('Enter');
  await serverHolding(b);
  const unpairing = devicesB.getByRole('button', { name: 'Desemparejando…' });
  await expect(unpairing).toHaveAttribute('aria-disabled', 'true');
  await expect(unpairing).toBeFocused();
  await releaseServer(b);
  await expect(toast(b)).toContainText('Hemos desemparejado «PC».');
  await expect(devicesB.getByRole('listitem')).toHaveCount(1);

  // A intenta borrarlo todo: el servidor responde 401. No da la agenda por borrada (puede seguir
  // en D1 con los demás), no borra nada y lo dice.
  await a.getByRole('button', { name: 'Borrar todos mis datos' }).click();
  await a.getByRole('textbox', { name: 'Escribe BORRAR para confirmar' }).fill('BORRAR');
  await a.getByRole('button', { name: 'Borrar todo' }).press('Enter');
  const alert = a.getByRole('alert');
  await expect(alert).toContainText('Este dispositivo ya no está emparejado');
  await expect(alert).toContainText('no hemos borrado nada');
  await expectStored(a, 'steam:504230', { title: 'Celeste' });
  await expect.poll(() => syncStatus(a)).toBe('unpaired');
  await expect(a.getByText(/Como ya no está emparejado/)).toBeVisible();
  await expectAccessibleAtTop(a, 'Datos: no se ha borrado nada (401)');
  expect((await serverAgenda(a, { agenda: agendaId }))?.exists).toBe(true);

  // Otro «Borrar todo» ya borra solo lo de este dispositivo, y lo dice así.
  await a.getByRole('button', { name: 'Borrar todo' }).press('Enter');
  await expect(toast(a)).toContainText('Hemos borrado todos tus datos de este dispositivo.');
  await expect(toast(a)).not.toContainText('servidor');
  expect((await serverAgenda(a, { agenda: agendaId }))?.exists).toBe(true);
  await a.goto('/');
  await expect(a.getByText('Tu agenda está vacía', { exact: false })).toBeVisible();
});

test('Dispositivos: «Volver a cargar» lleva el foco al encabezado y la fila de carga tiene la altura de la de verdad', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await setup(page);
  await activate(page, 'PC de prueba');
  const section = syncSection(page);
  const devices = section.getByRole('list', { name: 'Dispositivos' });
  await expect(devices.getByRole('listitem')).toHaveCount(1);
  const realBox = await devices.getByRole('listitem').first().boundingBox();

  // La lista no llega (como sin servidor): lo dice y ofrece «Volver a cargar».
  await holdServer(page, /^\/api\/v1\/devices$/, 'fail');
  await page.goto('/ajustes/acerca-de');
  await openSync(page);
  const retry = section.getByRole('button', { name: 'Volver a cargar' });
  await expect(retry).toBeVisible();
  await expect(section.getByText('No hemos podido conectar con el servidor')).toBeVisible();
  await expectAccessibleAtTop(page, 'Dispositivos sin cargar');

  // Al pulsarlo, el botón desaparece: el foco va a «Dispositivos». Mientras carga, la fila de este
  // dispositivo reserva su sitio con la misma altura (§9.5, regla 3).
  await holdServer(page, /^\/api\/v1\/devices$/);
  await retry.click();
  await expect(section.getByRole('heading', { name: 'Dispositivos' })).toBeFocused();
  await serverHolding(page);
  const skeleton = section.locator('.sync__devices[aria-busy="true"] .sync__device');
  await expect(skeleton).toHaveCount(1);
  const skeletonBox = await skeleton.boundingBox();
  await expectAccessibleAtTop(page, 'Dispositivos cargando');
  await releaseServer(page);
  await expect(devices.getByRole('listitem')).toHaveCount(1);
  await expect(devices).toContainText('PC de prueba');
  const afterBox = await devices.getByRole('listitem').first().boundingBox();
  expect(Math.abs((skeletonBox?.height ?? 0) - (afterBox?.height ?? -10))).toBeLessThanOrEqual(1);
  expect(Math.abs((realBox?.height ?? 0) - (afterBox?.height ?? -10))).toBeLessThanOrEqual(1);
});

test('a 320 px, un nombre de dispositivo largo sin espacios no se sale en la confirmación ni en el aviso (1.4.10)', async ({
  page: a,
  newDevice,
}) => {
  test.setTimeout(60_000);
  await setup(a);
  await activate(a, 'PC');
  const pairing = await newPairingCode(a);
  await a.setViewportSize({ width: 320, height: 640 });

  const long = 'Portátil'.padEnd(LABEL_MAX, 'X');
  const b = await newDevice();
  await setup(b);
  await openSync(b);
  const sectionB = syncSection(b);
  await sectionB.getByRole('textbox', { name: 'Nombre de este dispositivo' }).fill(long);
  await sectionB.getByRole('textbox', { name: 'Código' }).fill(pairing);
  await sectionB.getByRole('button', { name: 'Emparejar este dispositivo' }).click();
  await expect(sectionB.getByRole('heading', { name: 'Estado' })).toBeFocused();

  // A se entera solo: el aviso de la app parte el nombre y no se sale de la pantalla.
  await expect(toast(a)).toContainText(`«${long}» ya está emparejado.`, { timeout: 15_000 });
  const box = await toast(a).boundingBox();
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 999)).toBeLessThanOrEqual(320);
  expect(await overflow(a), 'aviso con un nombre largo a 320 px').toBeLessThanOrEqual(0);

  const devices = syncSection(a).getByRole('list', { name: 'Dispositivos' });
  await expect(devices.getByRole('listitem')).toHaveCount(2);
  await devices.getByRole('button', { name: `Desemparejar: ${long}` }).click();
  await expect(devices.getByRole('group')).toContainText(`¿Desemparejar «${long}»?`);
  expect(await overflow(a), 'confirmación con un nombre largo a 320 px').toBeLessThanOrEqual(0);
});

test('Mi lista vacía mientras vuelve la agenda sincronizada (CA4.3) dice que la está trayendo', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'borra solo IndexedDB con DevTools (CDP)');
  test.setTimeout(60_000);
  await setup(page);
  await page.goto('/');
  await capture(page, 'celeste', 'Celeste');
  await expectStored(page, 'steam:504230', { title: 'Celeste' });
  await activate(page);

  // Como «Borrar IndexedDB» en DevTools: la cookie de dispositivo y el indicio se quedan.
  const origin = new URL(page.url()).origin;
  const cdp = await context.newCDPSession(page);
  await page.goto('/ajustes/acerca-de');
  await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'indexeddb' });
  // La bajada espera hasta que la prueba la suelte, para ver el estado vacío mientras tanto.
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/sync', async (route) => {
    await held;
    await route.continue();
  });
  await page.goto('/');
  const empty = page.locator('[data-empty-text]');
  await expect(empty).toHaveAttribute('data-empty-text', 'restoring');
  await expect(
    page.getByRole('status').filter({ hasText: 'Estamos trayendo tu agenda' }),
  ).toBeVisible();
  await expect(page.getByText('Tu agenda está vacía', { exact: false })).toBeHidden();
  // Los demás textos posibles reservan su hueco en la misma celda (§9.5, regla 3).
  await expect(empty.locator('p')).toHaveCount(4);
  release();
  await expect(page.getByRole('main').getByRole('link', { name: /Celeste$/ })).toBeVisible({
    timeout: 15_000,
  });
});

test('con el reloj de este dispositivo 11 minutos adelantado, el código de emparejamiento dura sus 10 minutos', async ({
  page,
}) => {
  test.setTimeout(60_000);
  // Antes de cargar la página: el reloj de la app va 11 min por delante del servidor (y sigue
  // corriendo). La cuenta atrás va con el reloj de este dispositivo, no con el `expiresAt`.
  await page.clock.setSystemTime(Date.now() + 11 * 60_000);
  await setup(page);
  await activate(page, 'PC');
  const section = syncSection(page);
  await newPairingCode(page);
  await expect(section.locator('[data-sync-countdown]')).toHaveText(/^Caduca en (10:00|9:\d\d)\.$/);
  await expect(
    section.getByRole('img', { name: 'Código QR para emparejar otro dispositivo' }),
  ).toBeVisible();
  await expect(section.getByText('Este código ha caducado')).toHaveCount(0);
});
