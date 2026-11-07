// La sincronización de extremo a extremo (M4) con la micro-API real de la vista previa
// (`sync-server.ts`) y dos o tres contextos de navegador, cada uno un «dispositivo» del mismo mundo:
// - CA4.2: sin red en los dos, las ediciones de campos distintos sobreviven, en el mismo campo gana
//   la HLC más reciente y el mismo juego apuntado en los dos queda en una sola entrada.
// - CA4.3: borrar solo IndexedDB y recargar trae la agenda sola (la cookie sigue), también si hay
//   una ronda con la app abierta antes de recargar; borrar los datos del sitio y canjear el código
//   de recuperación, también. En Chromium se borra con DevTools (CDP); en WebKit, con la app
//   cerrada, con `indexedDB.deleteDatabase` antes de que la abra.
// - Ajustes › Sincronización: un código de emparejamiento usado no vale; un código de recuperación
//   nuevo anula el anterior; desemparejar otro dispositivo lo deja fuera en su siguiente ronda
//   (401) y desemparejar este conserva la agenda; «Borrar todos mis datos» vacía D1 (CA4.7).
// - Quien no sincroniza no hace ninguna petición a `/api` ni descarga el motor.
//
// Las rondas las disparan el motor y sus disparadores (arranque, `online`, foco, escritura local),
// nunca «Sincronizar ahora». Se espera con los ganchos del modo `e2e` (`globalThis.__gaSync`: el
// estado, las rondas correctas de la pestaña e `idle()`), sin esperas fijas. Lo que ya prueba
// `sync-settings.spec.ts` (activar, `/emparejar#código`, «Borrar todos mis datos» con un solo
// dispositivo y sin red) no se repite aquí.
import { DEFAULT_MIN_AGE } from '@gameagenda/core/api';
import type { BrowserContext, Page } from '@playwright/test';
import { capture, setup, toast, waitForSearch } from './helpers.ts';
import { expectStored, storedMeta } from './storage.ts';
import {
  deviceCookies,
  expect,
  joinWorld,
  pageCookies,
  SYNC_HINT_COOKIE_NAME,
  serverAgenda,
  test,
} from './sync-server.ts';

const CELESTE = 'steam:504230';
const HADES_II = 'steam:1145350';
const TERRARIA = 'steam:105600';
const STARDEW = 'steam:413150';
const CODE = /^[0-9A-Z]{4}(?:-[0-9A-Z]{4}){6}$/;

// --- Los ganchos del motor (`src/sync/e2e-hooks.ts`), sin `declare global` ---

interface SyncHookState {
  readonly ready: boolean;
  readonly status: 'off' | 'paired' | 'restoring' | 'unpaired';
  readonly activity: string;
  readonly error: string | null;
  readonly unpairedReason: 'server' | 'cookies' | null;
  readonly deviceId: string | null;
  readonly pending: number;
}

interface SyncHook {
  readonly state: SyncHookState;
  readonly successes: number;
  idle(): Promise<void>;
}

function syncState(page: Page): Promise<SyncHookState | null> {
  return page.evaluate(() => {
    const state = (globalThis as { __gaSync?: SyncHook }).__gaSync?.state;
    return state ? { ...state } : null;
  });
}

/** Rondas correctas de la pestaña desde que se cargó la página. */
function successes(page: Page): Promise<number> {
  return page.evaluate(() => (globalThis as { __gaSync?: SyncHook }).__gaSync?.successes ?? 0);
}

async function syncIdle(page: Page): Promise<void> {
  await page.evaluate(() => (globalThis as { __gaSync?: SyncHook }).__gaSync?.idle());
}

/** Espera a que la pestaña acabe una ronda correcta más que `before` y no quede nada en marcha. */
async function waitForRound(page: Page, before: number): Promise<void> {
  await expect.poll(() => successes(page), { timeout: 20_000 }).toBeGreaterThan(before);
  await syncIdle(page);
}

/** Emparejada, sin ronda en marcha y sin nada en la `outbox`. */
async function waitForSynced(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      await syncIdle(page);
      const state = await syncState(page);
      return state && `${state.status}:${state.activity}:${state.pending}`;
    })
    .toBe('paired:idle:0');
}

/**
 * Foco y visibilidad no repiten una ronda correcta de hace menos de 3 s (`minGapMs`): aquí sí, para
 * que «volver a la ventana» justo después de otra ronda sincronice. Antes de cargar la página.
 */
async function allowQuickRefocus(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    (globalThis as { __GA_SYNC_TEST__?: unknown }).__GA_SYNC_TEST__ = {
      timings: { minGapMs: 0 },
    };
  });
}

/**
 * Volver a la ventana: el `focus` de `window` que escucha el planificador. Playwright emula el foco
 * en todas las páginas a la vez, así que el navegador no lo dispara al cambiar de contexto.
 */
async function refocus(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}

/**
 * Antes de cortar la red: el catálogo entero en la pestaña (sin red habrá que apuntar) y su índice
 * ya guardado, porque el Worker de búsqueda carga después de `full` el *chunk* que lo guarda, y
 * sin red esa carga falla (lo anota WebKit en la consola).
 */
async function catalogSettled(page: Page): Promise<void> {
  await waitForSearch(page, 'full');
  await expect.poll(() => storedMeta(page, 'searchIndexKey'), { timeout: 15_000 }).not.toBeNull();
}

/**
 * Errores de la página y de sus Workers, como `setup().expectClean()` (que también hay que llamar,
 * por sus rutas y sus ganchos), menos uno que no es de la app: 10 s después de arrancar mira si hay
 * versión nueva con `registration.update()` (`pwa/update-policy.ts`) y, sin red, ignora el fallo,
 * pero el WebKit de Playwright lo anota en la consola («Failed to load resource» de `/sw.js`).
 */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const { url } = message.location();
    if (message.text().startsWith('Failed to load resource') && url.endsWith('/sw.js')) return;
    errors.push(`${message.text()} (${url})`);
  });
  page.on('worker', (worker) => {
    worker.on('console', (message) => {
      if (message.type() === 'error') errors.push(`Worker: ${message.text()}`);
    });
  });
  return {
    async expectClean() {
      expect(errors).toEqual([]);
      const csp = await page.evaluate(
        () => (globalThis as { __cspViolations?: string[] }).__cspViolations ?? [],
      );
      expect(csp).toEqual([]);
    },
  };
}

// --- Mi lista ---

const row = (page: Page, title: string) =>
  page
    .getByRole('main')
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: new RegExp(`${title}$`) }) });

async function setStatus(page: Page, title: string, from: string, to: string) {
  await page.getByRole('button', { name: `${from}: cambiar estado de ${title}` }).click();
  await page.getByRole('menuitemradio', { name: to }).click();
}

async function toggleFlag(page: Page, title: string, flag: string) {
  await page.getByRole('button', { name: `Más acciones: ${title}` }).click();
  await page.getByRole('menuitemcheckbox', { name: flag }).click();
}

async function openList(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Mi lista' })).toBeVisible();
}

// --- Ajustes › Sincronización (los nombres de `SyncPanel.tsx`) ---

function syncSection(page: Page) {
  return page.getByRole('region', { name: 'Sincronización' });
}

async function openSync(page: Page) {
  await page.goto('/ajustes/sincronizacion');
  await expect(page.getByRole('heading', { level: 2, name: 'Sincronización' })).toBeVisible();
}

async function shownCode(page: Page): Promise<string> {
  const code = (await syncSection(page).locator('[data-sync-code]').first().textContent()) ?? '';
  expect(code).toMatch(CODE);
  return code;
}

/** Activa la sincronización desde Ajustes (con la edad) y devuelve el código de recuperación. */
async function activate(page: Page, label: string): Promise<string> {
  await openSync(page);
  const section = syncSection(page);
  await section.getByRole('textbox', { name: 'Nombre de este dispositivo' }).fill(label);
  await section.getByRole('checkbox', { name: `Tengo ${DEFAULT_MIN_AGE} años o más` }).check();
  await section.getByRole('button', { name: 'Activar sincronización' }).click();
  await expect(section.getByRole('heading', { name: 'Tu código de recuperación' })).toBeFocused();
  const code = await shownCode(page);
  await section.getByRole('button', { name: 'Ya lo he guardado' }).click();
  await expect(section.locator('[data-sync-status]')).toContainText('Sincronizado', {
    timeout: 15_000,
  });
  return code;
}

/** «Emparejar otro dispositivo» en una sección ya emparejada: el código que enseña. */
async function newPairingCode(page: Page): Promise<string> {
  const section = syncSection(page);
  await section.getByRole('button', { name: 'Emparejar otro dispositivo' }).click();
  await expect(section.getByRole('heading', { name: 'Código de emparejamiento' })).toBeFocused();
  return shownCode(page);
}

/** Escribe (pega) un código en «Ya sincronizo en otro dispositivo» y pulsa el botón. */
async function enterCode(page: Page, code: string, kind: 'pair' | 'recover', label?: string) {
  const section = syncSection(page);
  if (label !== undefined) {
    await section.getByRole('textbox', { name: 'Nombre de este dispositivo' }).fill(label);
  }
  await section.getByRole('textbox', { name: 'Código' }).fill(code);
  await section
    .getByRole('button', {
      name: kind === 'pair' ? 'Emparejar este dispositivo' : 'Usar código de recuperación',
    })
    .click();
}

async function expectJoined(page: Page) {
  const section = syncSection(page);
  await expect(section.getByText('Este dispositivo ya está emparejado.')).toBeVisible();
  await expect(section.getByRole('heading', { name: 'Estado' })).toBeFocused();
}

// --- Borrar el almacenamiento ---

/**
 * «Con la app cerrada»: cierra la pestaña y abre otra del mismo contexto en la que IndexedDB (y,
 * con `localStorage`, también ese almacén) se borra antes de que la app la abra. Las peticiones de
 * apertura y borrado de una base van en cola y en orden, así que la app la encuentra vacía. Solo
 * una vez por pestaña: al recargar ya no se borra.
 */
async function reopenWithoutStorage(
  context: BrowserContext,
  old: Page,
  options: { localStorage?: boolean } = {},
): Promise<Page> {
  await old.close();
  const page = await context.newPage();
  await page.addInitScript((alsoLocal) => {
    // También corre en el `about:blank` inicial, que no tiene almacenamiento propio.
    if (!location.protocol.startsWith('http')) return;
    if (sessionStorage.getItem('ga-e2e-wiped') !== null) return;
    sessionStorage.setItem('ga-e2e-wiped', '1');
    indexedDB.deleteDatabase('gameagenda');
    if (alsoLocal) localStorage.clear();
  }, options.localStorage === true);
  return page;
}

test('CA4.2: sin red en los dos, los campos distintos sobreviven, en el mismo gana el último y el mismo juego queda una vez', async ({
  page: a,
  context,
  newDevice,
}) => {
  test.setTimeout(150_000);
  await allowQuickRefocus(context);
  await setup(a);
  const checksA = watchErrors(a);
  await openList(a);
  await capture(a, 'celeste', 'Celeste');
  await capture(a, 'hades ii', 'Hades II');
  await expectStored(a, HADES_II, { title: 'Hades II' });
  await catalogSettled(a);
  await activate(a, 'PC');
  const pairing = await newPairingCode(a);

  // B tiene juegos suyos, uno de ellos el mismo, y se empareja pegando el código.
  const b = await newDevice();
  await allowQuickRefocus(b.context());
  await setup(b);
  const checksB = watchErrors(b);
  await openList(b);
  await capture(b, 'celeste', 'Celeste');
  await capture(b, 'terraria', 'Terraria');
  await expectStored(b, TERRARIA, { title: 'Terraria' });
  await catalogSettled(b);
  await openSync(b);
  await enterCode(b, pairing, 'pair', 'Móvil');
  await expectJoined(b);
  await waitForSynced(b);

  // Al volver a Mi lista, cada uno sincroniza al arrancar: los dos tienen los tres juegos, y
  // Celeste una sola vez.
  for (const page of [a, b]) {
    await catalogSettled(page);
    await openList(page);
    await waitForRound(page, 0);
    await expect(page.getByRole('heading', { name: 'Quiero jugar (3)' })).toBeVisible();
    await expect(row(page, 'Celeste')).toHaveCount(1);
    await expect(row(page, 'Terraria')).toHaveCount(1);
    await expect(row(page, 'Hades II')).toHaveCount(1);
    await waitForSynced(page);
    await catalogSettled(page);
  }

  // Sin red en los dos.
  await context.setOffline(true);
  await b.context().setOffline(true);
  for (const page of [a, b]) {
    await expect.poll(async () => (await syncState(page))?.activity).toBe('offline');
  }

  // Campos distintos del mismo juego: el estado en A y la marca de compra en B.
  await setStatus(a, 'Celeste', 'Quiero jugar', 'Jugando');
  await expect(toast(a)).toContainText('Celeste pasa a Jugando');
  await toggleFlag(b, 'Celeste', 'Comprado');
  await expect(toast(b)).toContainText('Marcado como Comprado: Celeste');
  // El mismo campo: primero A y después B, con una HLC más reciente.
  await setStatus(a, 'Hades II', 'Quiero jugar', 'Jugando');
  await expectStored(a, HADES_II, { status: 'playing' });
  await setStatus(b, 'Hades II', 'Quiero jugar', 'En pausa');
  await expectStored(b, HADES_II, { status: 'on_hold' });
  // El mismo juego apuntado en los dos.
  await capture(a, 'stardew', 'Stardew Valley');
  await capture(b, 'stardew', 'Stardew Valley');
  for (const page of [a, b]) {
    await expectStored(page, STARDEW, { title: 'Stardew Valley' });
    // Tres juegos con cambios sin subir, y la actividad sigue en «sin conexión».
    await expect
      .poll(async () => {
        const state = await syncState(page);
        return state && `${state.activity}:${state.pending}`;
      })
      .toBe('offline:3');
  }

  // Vuelve la red: cada uno sincroniza solo (`online`). A sube lo suyo; B sube lo suyo y baja lo de
  // A; y A, al volver a su ventana (foco), baja lo de B.
  const roundsA = await successes(a);
  await context.setOffline(false);
  await waitForRound(a, roundsA);
  const roundsB = await successes(b);
  await b.context().setOffline(false);
  await waitForRound(b, roundsB);
  const refocused = await successes(a);
  await refocus(a);
  await waitForRound(a, refocused);

  async function expectConverged(page: Page) {
    await expectStored(page, CELESTE, { status: 'playing', flags: { owned: true } });
    await expectStored(page, HADES_II, { status: 'on_hold' });
    await expectStored(page, STARDEW, { title: 'Stardew Valley', status: 'want_to_play' });
    await expectStored(page, TERRARIA, { title: 'Terraria', status: 'want_to_play' });
    await expect(page.getByRole('heading', { name: 'Jugando ahora (1)' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Quiero jugar (2)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mostrar En pausa' })).toBeVisible();
    await expect(row(page, 'Celeste').getByText('Comprado')).toBeVisible();
    await expect(row(page, 'Stardew Valley')).toHaveCount(1);
    await waitForSynced(page);
  }
  for (const page of [a, b]) await expectConverged(page);

  // D1 tiene lo mismo.
  const deviceId = (await syncState(a))?.deviceId ?? '';
  const server = await serverAgenda(a, { device: deviceId }, { entries: true });
  const byId = new Map((server?.entries ?? []).map((e) => [e.id, e]));
  expect(byId.get(CELESTE)).toMatchObject({ status: 'playing', flags: { owned: true } });
  expect(byId.get(HADES_II)).toMatchObject({ status: 'on_hold' });
  expect(byId.get(STARDEW)).toMatchObject({ title: 'Stardew Valley' });
  expect(byId.get(TERRARIA)).toMatchObject({ title: 'Terraria' });

  // Lo guardado en IndexedDB: al recargar sigue igual (y la ronda del arranque no cambia nada).
  for (const page of [a, b]) {
    await page.reload();
    await waitForRound(page, 0);
    await expectConverged(page);
  }
  await checksA.expectClean();
  await checksB.expectClean();
});

test('CA4.3: borrar solo IndexedDB y recargar trae la agenda sola, porque la cookie sigue', async ({
  page,
  context,
  browserName,
}) => {
  test.setTimeout(90_000);
  await setup(page);
  await openList(page);
  await capture(page, 'celeste', 'Celeste');
  await capture(page, 'terraria', 'Terraria');
  await setStatus(page, 'Celeste', 'Quiero jugar', 'Jugando');
  await expectStored(page, CELESTE, { status: 'playing' });
  await activate(page, 'PC');
  await waitForSynced(page);
  const deviceId = (await syncState(page))?.deviceId ?? '';
  const agendaId = (await serverAgenda(page, { device: deviceId }))?.agendaId ?? '';

  let app = page;
  if (browserName === 'chromium') {
    // Como «Borrar IndexedDB» en DevTools, con la app abierta en una página tranquila.
    await page.goto('/ajustes/acerca-de');
    await syncIdle(page);
    const origin = new URL(page.url()).origin;
    const cdp = await context.newCDPSession(page);
    await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'indexeddb' });
  } else {
    app = await reopenWithoutStorage(context, page);
    await setup(app);
  }
  await openList(app);
  // Vuelve sola: el indicio sigue y no hay estado, así que restaura desde 0.
  await expect(app.getByRole('heading', { name: 'Jugando ahora (1)' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(app.getByRole('heading', { name: 'Quiero jugar (1)' })).toBeVisible();
  await expectStored(app, CELESTE, { status: 'playing', title: 'Celeste' });
  await expectStored(app, TERRARIA, { title: 'Terraria' });
  await waitForSynced(app);
  expect(await pageCookies(app)).toContain(`${SYNC_HINT_COOKIE_NAME}=1`);
  // Sigue siendo el mismo dispositivo: restaurar no crea otro.
  expect((await serverAgenda(app, { agenda: agendaId }))?.rows.device).toBe(1);

  // Y queda guardada: al recargar sale de IndexedDB.
  await app.reload();
  await expect(app.getByRole('heading', { name: 'Jugando ahora (1)' })).toBeVisible();
  await expect(row(app, 'Terraria')).toHaveCount(1);
  await waitForRound(app, 0);
  await waitForSynced(app);
});

test('CA4.3: borrar IndexedDB con la app abierta y sincronizar antes de recargar tampoco pierde la agenda', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'borra IndexedDB con la app abierta con DevTools (CDP)');
  test.setTimeout(90_000);
  await allowQuickRefocus(context);
  await setup(page);
  await openList(page);
  await capture(page, 'celeste', 'Celeste');
  await capture(page, 'terraria', 'Terraria');
  await expectStored(page, TERRARIA, { title: 'Terraria' });
  await activate(page, 'PC');
  await waitForSynced(page);
  await openList(page);
  await waitForRound(page, 0);

  // Dexie vuelve a abrir la base, ya vacía, con la siguiente operación. Si antes de recargar hay
  // una ronda (aquí, al volver a la ventana), lee el cursor de esa base vacía: baja desde 0 y
  // vuelve a guardar toda la agenda. Al recargar, o la encuentra guardada o, si la fachada ya no
  // encontró `meta.syncState` (lo relee cuando cambia `meta`), la restaura como sin estado.
  const origin = new URL(page.url()).origin;
  const cdp = await context.newCDPSession(page);
  await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'indexeddb' });
  const before = await successes(page);
  await refocus(page);
  await waitForRound(page, before);
  await expectStored(page, CELESTE, { title: 'Celeste' });
  await expectStored(page, TERRARIA, { title: 'Terraria' });

  await page.reload();
  await waitForRound(page, 0);
  await expect(row(page, 'Celeste')).toHaveCount(1);
  await expect(row(page, 'Terraria')).toHaveCount(1);
  await waitForSynced(page);
});

test('CA4.3: borrar los datos del sitio y canjear el código de recuperación trae la agenda', async ({
  page,
  context,
  browserName,
  syncWorld,
  baseURL,
}) => {
  test.setTimeout(90_000);
  await setup(page);
  await openList(page);
  await capture(page, 'celeste', 'Celeste');
  await capture(page, 'hades ii', 'Hades II');
  await toggleFlag(page, 'Hades II', 'Comprado');
  await expectStored(page, HADES_II, { flags: { owned: true } });
  const recovery = await activate(page, 'PC');
  await waitForSynced(page);

  let app = page;
  if (browserName === 'chromium') {
    // Como «Borrar datos del sitio» en DevTools: cookies, IndexedDB, cachés y Service Worker.
    await page.goto('/ajustes/acerca-de');
    await syncIdle(page);
    const origin = new URL(page.url()).origin;
    const cdp = await context.newCDPSession(page);
    await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
  } else {
    await context.clearCookies();
    app = await reopenWithoutStorage(context, page, { localStorage: true });
    await setup(app);
  }
  expect(await deviceCookies(context)).toEqual([]);
  // La *cookie* del mundo de la vista previa también se ha ido (no es de la app).
  await joinWorld(context, syncWorld, baseURL ?? '');

  await openList(app);
  await expect(app.getByText('Tu agenda está vacía', { exact: false })).toBeVisible();
  await expect.poll(async () => (await syncState(app))?.status).toBe('off');

  await openSync(app);
  await enterCode(app, recovery.toLowerCase().replaceAll('-', ' '), 'recover', 'PC otra vez');
  await expectJoined(app);
  await waitForSynced(app);
  await openList(app);
  await expect(app.getByRole('heading', { name: 'Quiero jugar (2)' })).toBeVisible();
  await expect(row(app, 'Hades II').getByText('Comprado')).toBeVisible();
  await expectStored(app, CELESTE, { title: 'Celeste' });
  await expectStored(app, HADES_II, { flags: { owned: true } });
  expect(await pageCookies(app)).toContain(`${SYNC_HINT_COOKIE_NAME}=1`);
});

test('Ajustes: un código de emparejamiento usado no vale, y uno de recuperación nuevo anula el anterior', async ({
  page: a,
  newDevice,
}) => {
  test.setTimeout(90_000);
  await setup(a);
  const first = await activate(a, 'PC');
  const pairing = await newPairingCode(a);

  const b = await newDevice();
  await setup(b);
  await openSync(b);
  await enterCode(b, pairing, 'pair', 'Móvil');
  await expectJoined(b);

  // El mismo código, otra vez: ya está usado.
  const c = await newDevice();
  await setup(c);
  await openSync(c);
  await enterCode(c, pairing, 'pair', 'Tableta');
  const field = syncSection(c).getByRole('textbox', { name: 'Código' });
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAccessibleDescription(/Este código no vale: .*ya se haya usado/);
  expect((await syncState(c))?.status).toBe('off');

  // Un código de recuperación nuevo, con confirmación en el sitio; se ve una sola vez.
  const section = syncSection(a);
  await section.getByRole('button', { name: 'Código de recuperación nuevo' }).click();
  await section.getByRole('button', { name: 'Crear código nuevo' }).click();
  await expect(section.getByRole('heading', { name: 'Tu código de recuperación' })).toBeFocused();
  const second = await shownCode(a);
  expect(second).not.toBe(first);
  await section.getByRole('button', { name: 'Ya lo he guardado' }).click();
  await expect(section.locator('[data-sync-code]')).toHaveCount(0);

  // El anterior ya no vale; el nuevo, sí.
  await enterCode(c, first, 'recover');
  await expect(field).toHaveAccessibleDescription(/Este código de recuperación no vale/);
  expect((await syncState(c))?.status).toBe('off');
  await enterCode(c, second, 'recover');
  await expectJoined(c);
  const devices = syncSection(c).getByRole('list', { name: 'Dispositivos' });
  await expect(devices.getByRole('listitem')).toHaveCount(3);
  await expect(devices).toContainText('Tableta');
});

test('Ajustes: desemparejar otro lo deja fuera en su siguiente ronda (401) con su agenda; desemparejar este conserva la agenda', async ({
  page: a,
  context,
  newDevice,
}) => {
  test.setTimeout(90_000);
  await setup(a);
  await openList(a);
  await capture(a, 'celeste', 'Celeste');
  await expectStored(a, CELESTE, { title: 'Celeste' });
  await activate(a, 'PC');
  const deviceId = (await syncState(a))?.deviceId ?? '';
  const agendaId = (await serverAgenda(a, { device: deviceId }))?.agendaId ?? '';
  const pairing = await newPairingCode(a);

  const b = await newDevice();
  await setup(b);
  await openSync(b);
  await enterCode(b, pairing, 'pair', 'Móvil');
  await expectJoined(b);
  await openList(b);
  await waitForRound(b, 0);
  await expect(row(b, 'Celeste')).toHaveCount(1);

  // A desempareja a B desde la lista (A se ha enterado de B mientras enseñaba el código).
  const section = syncSection(a);
  const devices = section.getByRole('list', { name: 'Dispositivos' });
  await expect(devices.getByRole('listitem')).toHaveCount(2, { timeout: 15_000 });
  await devices.getByRole('button', { name: 'Desemparejar: Móvil' }).click();
  await devices.getByRole('button', { name: 'Desemparejar: Móvil' }).click();
  await expect(section.getByText('Hemos desemparejado «Móvil».')).toBeVisible();

  // B apunta otro juego: su siguiente ronda (2 s después de escribir) recibe 401. Se queda con
  // toda su agenda y con lo que no ha podido subir.
  await capture(b, 'terraria', 'Terraria');
  await expect
    .poll(
      async () => {
        const state = await syncState(b);
        return state && `${state.status}:${state.unpairedReason}`;
      },
      { timeout: 20_000 },
    )
    .toBe('unpaired:server');
  expect((await syncState(b))?.pending).toBe(1);
  expect(await pageCookies(b)).not.toContain(SYNC_HINT_COOKIE_NAME);
  await b.reload();
  await expect(row(b, 'Celeste')).toHaveCount(1);
  await expect(row(b, 'Terraria')).toHaveCount(1);
  await expectStored(b, TERRARIA, { title: 'Terraria' });
  await openSync(b);
  await expect(syncSection(b).locator('[data-sync-unpaired="server"]')).toBeVisible();

  // A se desempareja a sí mismo: deja de sincronizar y conserva la agenda.
  await section.getByRole('button', { name: 'Desemparejar este dispositivo' }).click();
  const confirm = section
    .getByRole('group', { name: '¿Desemparejar este dispositivo?', exact: false })
    .getByRole('button', { name: 'Desemparejar este dispositivo' });
  await expect(confirm).toBeFocused();
  await confirm.click();
  await expect(
    section.getByText('Este dispositivo ya no sincroniza. Tu agenda sigue aquí.'),
  ).toBeVisible();
  await expect(section.getByRole('heading', { name: 'Empezar a sincronizar' })).toBeFocused();
  expect(await deviceCookies(context)).toEqual([]);
  expect((await syncState(a))?.status).toBe('off');
  await openList(a);
  await expect(row(a, 'Celeste')).toHaveCount(1);
  await expectStored(a, CELESTE, { title: 'Celeste' });
  await expect.poll(async () => (await syncState(a))?.status).toBe('off');
  // La agenda sigue en D1, sin dispositivos (se borra a los 13 meses sin sincronizar).
  const server = await serverAgenda(a, { agenda: agendaId });
  expect(server).toMatchObject({ exists: true, rows: { device: 0 } });
});

test('«Borrar todos mis datos» emparejado vacía D1 (CA4.7), y el otro dispositivo queda fuera con su agenda', async ({
  page: a,
  newDevice,
}) => {
  test.setTimeout(90_000);
  const checks = await setup(a);
  await openList(a);
  await capture(a, 'celeste', 'Celeste');
  await expectStored(a, CELESTE, { title: 'Celeste' });
  await catalogSettled(a);
  await activate(a, 'PC');
  const deviceId = (await syncState(a))?.deviceId ?? '';
  const agendaId = (await serverAgenda(a, { device: deviceId }))?.agendaId ?? '';
  const pairing = await newPairingCode(a);

  const b = await newDevice();
  await allowQuickRefocus(b.context());
  await setup(b);
  await openSync(b);
  await enterCode(b, pairing, 'pair', 'Móvil');
  await expectJoined(b);
  await openList(b);
  await waitForRound(b, 0);
  await expect(row(b, 'Celeste')).toHaveCount(1);
  expect((await serverAgenda(a, { agenda: agendaId }))?.rows.device).toBe(2);

  await catalogSettled(a);
  await a.goto('/ajustes/datos');
  await a.getByRole('button', { name: 'Borrar todos mis datos' }).click();
  await a.getByRole('textbox', { name: 'Escribe BORRAR para confirmar' }).fill('BORRAR');
  await a.getByRole('button', { name: 'Borrar todo' }).click();
  await expect(toast(a)).toContainText(
    'Hemos borrado todos tus datos de este dispositivo y tu agenda sincronizada del servidor.',
  );
  // En cascada: la agenda, sus dos dispositivos, sus operaciones y sus códigos.
  expect(await serverAgenda(a, { agenda: agendaId })).toMatchObject({
    exists: false,
    rows: { device: 0, op: 0, pairingToken: 0, inboxItem: 0 },
  });
  await checks.expectClean();

  // B, al volver a su ventana, sincroniza y recibe 401: su agenda se queda.
  await refocus(b);
  await expect
    .poll(async () => {
      const state = await syncState(b);
      return state && `${state.status}:${state.unpairedReason}`;
    })
    .toBe('unpaired:server');
  await expect(row(b, 'Celeste')).toHaveCount(1);
  await expectStored(b, CELESTE, { title: 'Celeste' });
});

test('quien no sincroniza no hace ninguna petición a /api ni descarga el motor', async ({
  page,
  context,
}) => {
  const api: string[] = [];
  const engine: string[] = [];
  context.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith('/api/')) api.push(`${request.method()} ${pathname}`);
  });
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    // El motor (`sync/runtime.ts`) va en su propio *chunk*; la precaché del Service Worker no cuenta.
    if (/\/assets\/runtime-[^/]+\.js$/.test(pathname)) engine.push(pathname);
  });
  const checks = await setup(page);
  await openList(page);
  await capture(page, 'celeste', 'Celeste');
  await setStatus(page, 'Celeste', 'Quiero jugar', 'Jugando');
  await expectStored(page, CELESTE, { status: 'playing' });
  // Los disparadores de la sincronización: foco, red otra vez, volver a la vista y escribir. Los
  // eventos, sin tocar la red: cortarla de verdad corta también las cargas del Worker de búsqueda.
  await refocus(page);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await toggleFlag(page, 'Celeste', 'Comprado');
  await expectStored(page, CELESTE, { flags: { owned: true } });
  // Ajustes › Sincronización sin activar tampoco pregunta nada al servidor, y al volver a cargar
  // Mi lista, tampoco. Antes de cada navegación, el catálogo asentado (ver `catalogSettled`).
  await catalogSettled(page);
  await openSync(page);
  await expect(syncSection(page).locator('[data-sync-view="off"]')).toBeVisible();
  await catalogSettled(page);
  await openList(page);
  await expect(row(page, 'Celeste')).toHaveCount(1);
  await syncIdle(page);
  expect(await syncState(page)).toMatchObject({ ready: true, status: 'off', pending: 0 });
  expect(api).toEqual([]);
  expect(engine).toEqual([]);
  expect(await deviceCookies(context)).toEqual([]);
  await checks.expectClean();
});
