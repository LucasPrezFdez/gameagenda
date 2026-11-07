// La micro-API real en la vista previa de los E2E (M4): las *cookies* `__Host-` desde la página, el
// Service Worker y la CSP no se meten en `/api/*`, y las rutas de apoyo `/__e2e/*` funcionan. Es la
// base de los E2E de sincronización (CA4.2 y CA4.3). Chromium va por HTTP y WebKit por el espejo
// HTTPS (ver `sync-server.ts`).
import type { Page } from '@playwright/test';
import { setup } from './helpers.ts';
import {
  callApi,
  configureServer,
  createAgendaFromPage,
  DEVICE_COOKIE_NAME,
  deviceCookies,
  exampleOps,
  expect,
  moveServerClock,
  pageCookies,
  runServerMaintenance,
  SYNC_HINT_COOKIE_NAME,
  serverAgenda,
  serverState,
  test,
} from './sync-server.ts';

const DAY = 86_400_000;

async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Mi lista' })).toBeVisible();
}

test('crear la agenda desde la página guarda las cookies y autentica las siguientes peticiones', async ({
  page,
  context,
  baseURL,
  browserName,
}) => {
  const checks = await setup(page);
  await openApp(page);
  expect(new URL(page.url()).origin).toBe(new URL(baseURL ?? '').origin);

  const { deviceId, recoveryCode } = await createAgendaFromPage(page, 'Navegador de prueba');
  expect(recoveryCode).toMatch(/^[0-9A-Z]{4}(?:-[0-9A-Z]{4}){6}$/);

  // Las dos *cookies*, como las pone el Worker: la credencial `HttpOnly` y el indicio legible. El
  // WebKit de Playwright para Windows no implementa `SameSite` y las da todas como `None`.
  const sameSite = browserName === 'webkit' && process.platform === 'win32' ? 'None' : 'Lax';
  const cookies = await deviceCookies(context);
  expect(
    cookies.map(({ name, path, secure, httpOnly, sameSite }) => ({
      name,
      path,
      secure,
      httpOnly,
      sameSite,
    })),
  ).toEqual([
    { name: DEVICE_COOKIE_NAME, path: '/', secure: true, httpOnly: true, sameSite },
    { name: SYNC_HINT_COOKIE_NAME, path: '/', secure: true, httpOnly: false, sameSite },
  ]);
  expect(await pageCookies(page)).toBe(`${SYNC_HINT_COOKIE_NAME}=1`);

  // La siguiente petición lleva la credencial.
  const devices = await callApi<{ devices: { id: string; label: string; current: boolean }[] }>(
    page,
    'GET',
    '/api/v1/devices',
  );
  expect(devices.status).toBe(200);
  expect(devices.json.devices).toEqual([
    expect.objectContaining({ id: deviceId, label: 'Navegador de prueba', current: true }),
  ]);
  // Las cabeceras son las de la micro-API (§11.4), no las de la vista previa.
  expect(devices.headers['cache-control']).toBe('no-store');
  expect(devices.headers['content-security-policy']).toBe(
    "default-src 'none'; frame-ancestors 'none'",
  );
  expect(devices.headers['access-control-allow-origin']).toBeUndefined();

  // Con el Service Worker al mando (`clients.claim()` al activarse; en WebKit, la precaché tarda),
  // `/api/*` sigue yendo a la red, también tras recargar.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  expect((await callApi(page, 'GET', '/api/v1/devices')).status).toBe(200);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  expect((await callApi(page, 'GET', '/api/v1/devices')).status).toBe(200);
  await checks.expectClean();
});

test('sin la credencial, 401, y el servidor borra el indicio', async ({ page, context }) => {
  await openApp(page);
  await createAgendaFromPage(page);
  await context.clearCookies({ name: DEVICE_COOKIE_NAME });
  expect(await pageCookies(page)).toBe(`${SYNC_HINT_COOKIE_NAME}=1`);

  const response = await callApi(page, 'GET', '/api/v1/devices');
  expect(response).toMatchObject({ status: 401, json: { error: 'unauthorized' } });
  expect(await deviceCookies(context)).toEqual([]);
  expect(await pageCookies(page)).toBe('');
});

test('rutas de apoyo: dos dispositivos, reloj, interruptor, purga y «Borrar todos mis datos»', async ({
  page,
  context,
  syncWorld,
  newDevice,
  browser,
}) => {
  await openApp(page);
  const state = await serverState(page);
  expect(state).toMatchObject({ world: syncWorld, offsetMs: 0, syncEnabled: true, minAge: 14 });
  const { deviceId } = await createAgendaFromPage(page, 'Primero');

  // Un juego apuntado, por `sync`, desde la página.
  const added = exampleOps('steam:620', {
    status: 'want_to_play',
    title: 'Portal 2',
    rank: 'a0',
    addedAt: '2026-11-07',
  });
  const first = await callApi<{ accepted: string[]; cursor: number }>(
    page,
    'POST',
    '/api/v1/sync',
    { cursor: 0, purgedSeq: 0, ops: added },
  );
  expect(first.status).toBe(200);
  expect(first.json.accepted).toHaveLength(added.length);
  const report = await serverAgenda(page, { device: deviceId }, { entries: true });
  expect(report).toMatchObject({ exists: true, rows: { device: 1, op: 4 } });
  expect(report?.entries).toEqual([
    expect.objectContaining({ id: 'steam:620', title: 'Portal 2', status: 'want_to_play' }),
  ]);

  // Otro dispositivo del mismo mundo canjea un código; pasados 10 min, el siguiente ya no vale.
  const pairing = await callApi<{ code: string }>(page, 'POST', '/api/v1/pairing');
  expect(pairing.status).toBe(201);
  const phone = await newDevice();
  await openApp(phone);
  const redeemed = await callApi(phone, 'POST', '/api/v1/pairing/redeem', {
    code: pairing.json.code,
    label: 'Segundo',
  });
  expect(redeemed.status).toBe(201);
  expect((await serverAgenda(page, { device: deviceId }))?.rows.device).toBe(2);
  const late = await callApi<{ code: string }>(page, 'POST', '/api/v1/pairing');
  const moved = await moveServerClock(page, { advanceMs: 11 * 60_000 });
  expect(Date.parse(moved.now) - Date.parse(state.now)).toBeGreaterThanOrEqual(11 * 60_000);
  const third = await newDevice();
  await openApp(third);
  expect(
    await callApi(third, 'POST', '/api/v1/pairing/redeem', {
      code: late.json.code,
      label: 'Tarde',
    }),
  ).toMatchObject({ status: 400, json: { error: 'invalid_code' } });

  // El interruptor general.
  await configureServer(page, { syncEnabled: false });
  expect(await callApi(page, 'GET', '/api/v1/devices')).toMatchObject({
    status: 503,
    json: { error: 'sync_disabled' },
  });
  await configureServer(page, { syncEnabled: true });

  // Borrado hoy y purgado el lunes que cae pasados 90 días: `purged_seq` sube y no quedan filas.
  const deleted = exampleOps('steam:620', { deletedAt: new Date().toISOString() }, Date.now() + 1);
  const second = await callApi(page, 'POST', '/api/v1/sync', {
    cursor: first.json.cursor,
    purgedSeq: 0,
    ops: deleted,
  });
  expect(second.status).toBe(200);
  const { ranAt } = await runServerMaintenance(page, { afterDays: 91 });
  expect(new Date(ranAt).getUTCDay()).toBe(1);
  expect(Date.parse(ranAt) - Date.now()).toBeGreaterThan(91 * DAY - 60_000);
  const purged = await serverAgenda(page, { device: deviceId });
  expect(purged?.rows.op).toBe(0);
  expect(purged?.purgedSeq).toBeGreaterThan(0);
  // La seq sube con la purga y purged_seq pasa a ser esa seq nueva: todo dispositivo que sincronizó
  // antes recibe reset. La época, de 16 cifras hexadecimales, no cambia.
  expect(purged?.purgedSeq).toBe(purged?.seq);
  expect(purged?.epoch).toMatch(/^[0-9a-f]{16}$/);

  // Otro mundo (un contexto sin la *cookie* del mundo) no ve esta agenda.
  const outsider = await browser.newContext();
  expect(await serverAgenda(outsider, { device: deviceId })).toBeNull();
  await outsider.close();

  // «Borrar todos mis datos» vacía D1 (CA4.7): el dispositivo ya no existe y la agenda, tampoco.
  const agendaId = purged?.agendaId ?? '';
  const wiped = await callApi(page, 'POST', '/api/v1/agenda/delete', { confirm: true });
  expect(wiped).toMatchObject({ status: 200, json: { ok: true } });
  expect(await deviceCookies(context)).toEqual([]);
  expect(await serverAgenda(page, { device: deviceId })).toBeNull();
  expect(await serverAgenda(page, { agenda: agendaId })).toEqual({
    agendaId,
    exists: false,
    seq: null,
    purgedSeq: null,
    epoch: null,
    rows: { device: 0, op: 0, pairingToken: 0, inboxItem: 0 },
  });
});
