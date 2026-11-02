// Prueba de humo de `ga-web` en producción con un Chromium real (Playwright), lo que `vite preview`
// no ve (31-10-2026: el Service Worker no volvía a abrir la app por la redirección de
// `/index.html` de Workers Static Assets; ver ADR-003).
//
// 1. Primera visita: el catálogo llega a `full` sin error (firma y `minClientVersion` aceptados) y
//    queda `meta.catalog`. Anota lo que baja de `ga-catalog`.
// 2. Segunda visita: la página abre (desde el Service Worker) y no vuelve a pedir el *manifest*
//    antes de 12 h (§5.3).
// 3. Sin red: la página abre y el catálogo llega a `full`.
//
// Con `--profile=<carpeta>`, el navegador se conserva entre ejecuciones: la siguiente arranca con
// el catálogo y `meta.catalog` de la anterior. Así se mide CA2.4 tras una publicación nueva (lo
// que baja un cliente con el núcleo de ayer); si han pasado ≥12 h, la primera visita comprueba el
// *manifest*. Sin `--profile`, cada ejecución es una primera visita.
//
// Uso: npm run smoke:web [-- --url=https://… --profile=.cache/smoke-web]
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { type BrowserContext, chromium, type Page } from '@playwright/test';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'https://ga-web.gameagenda.workers.dev/' },
    profile: { type: 'string' },
  },
});
const appUrl = new URL(values.url ?? '').href;

// En Windows, un perfil en una ruta larga no abre: el 02-11-2026, una copia en una carpeta de 152
// caracteres (con ficheros de hasta 291 dentro) daba `net::ERR_FAILED` en la primera visita, y la
// misma copia en `.cache/` iba bien. Parece el límite de 260 caracteres (MAX_PATH).
const PROFILE_PATH_MAX = 120;
if (values.profile && process.platform === 'win32') {
  const length = resolve(values.profile).length;
  if (length > PROFILE_PATH_MAX) {
    console.warn(
      `· Aviso: la ruta del perfil tiene ${length} caracteres (>${PROFILE_PATH_MAX}); si la primera visita da net::ERR_FAILED, usa una más corta, como .cache/smoke-web`,
    );
  }
}

// Código que corre en la página, como texto (`scripts/` compila sin los tipos del navegador). Va
// siempre por `page.evaluate`, que Playwright ejecuta por fuera de la página. `waitForFunction`
// no sirve aquí: lo evalúa dentro, y la CSP de `ga-web` no admite `unsafe-eval`.

/**
 * Guarda en `__smokeStatus` el último `status` del Worker de búsqueda (sin ganchos de prueba), en
 * `__smokeFullAt` cuándo llegó a `full` por primera vez y en `__smokeLong` las tareas largas del
 * hilo principal.
 */
const WATCH_STATUS = `{
  globalThis.__smokeLong = [];
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        globalThis.__smokeLong.push({ start: entry.startTime, duration: entry.duration });
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
  const Native = globalThis.Worker;
  globalThis.Worker = class extends Native {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', (event) => {
        const data = event.data;
        if (data && data.type === 'status') {
          globalThis.__smokeStatus = { state: data.state, version: data.version, error: data.error };
          if (data.state === 'full' && globalThis.__smokeFullAt === undefined) {
            globalThis.__smokeFullAt = performance.now();
          }
        }
      });
    }
  };
}`;
const STATUS = 'globalThis.__smokeStatus ?? null';
/** Las tareas largas del hilo principal desde que el catálogo llegó a `full` (en ms). */
const LONG_AFTER_FULL = `(globalThis.__smokeLong ?? [])
  .filter((task) => task.start >= (globalThis.__smokeFullAt ?? Infinity))
  .map((task) => Math.round(task.duration))`;
const CONTROLLED = 'Boolean(navigator.serviceWorker?.controller)';
const FULL_OR_ERROR =
  "globalThis.__smokeStatus?.state === 'full' || Boolean(globalThis.__smokeStatus?.error)";

/** Repite `expression` en la página cada 250 ms hasta que dé `true` o pasen `timeoutMs`. */
async function waitInPage(page: Page, expression: string, timeoutMs: number): Promise<void> {
  const limit = Date.now() + timeoutMs;
  while (Date.now() < limit) {
    if ((await page.evaluate(expression).catch(() => false)) === true) return;
    await page.waitForTimeout(250);
  }
}

/** `meta.catalog` de la base `gameagenda`, sin crearla si aún no existe. */
const READ_META = `new Promise((resolve) => {
  const request = indexedDB.open('gameagenda');
  request.onupgradeneeded = () => request.transaction.abort();
  request.onerror = () => resolve(null);
  request.onsuccess = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains('meta')) {
      db.close();
      resolve(null);
      return;
    }
    const get = db.transaction('meta').objectStore('meta').get('catalog');
    get.onsuccess = () => {
      db.close();
      resolve(get.result ? get.result.value : null);
    };
  };
})`;

interface Traffic {
  manifests: number;
  catalogFiles: string[];
  catalogBytes: number;
  failed: string[];
}

interface Status {
  readonly state: string;
  readonly version: string | null;
  readonly error: unknown;
}

interface CatalogMeta {
  readonly version: string;
  readonly checkedAt: number;
}

/** Cada cuánto comprueba la app el *manifest* (§5.3; `CHECK_INTERVAL_MS` de `host.ts`). */
const CHECK_INTERVAL_MS = 12 * 3_600_000;
/** Lo más que puede bajar un cliente con un núcleo de ≤7 días (CA2.4). */
const CA24_MAX_KB = 200;
const RE_CORE_FILE = /(^|\/)core\.[^/]*\.tsv$/;

function isCatalogMeta(value: unknown): value is CatalogMeta {
  const meta = value as Partial<CatalogMeta> | null;
  return typeof meta?.version === 'string' && typeof meta.checkedAt === 'number';
}

const failures: string[] = [];
function check(ok: boolean, message: string): void {
  console.log(`${ok ? '✓' : '✗'} ${message}`);
  if (!ok) failures.push(message);
}

function trafficOf(context: BrowserContext): Traffic {
  const traffic: Traffic = { manifests: 0, catalogFiles: [], catalogBytes: 0, failed: [] };
  context.on('requestfinished', async (request) => {
    const url = new URL(request.url());
    if (!url.hostname.startsWith('ga-catalog.')) return;
    const path = url.pathname.slice(1);
    if (path === 'manifest.json') traffic.manifests++;
    traffic.catalogFiles.push(path);
    traffic.catalogBytes += (await request.sizes()).responseBodySize;
  });
  context.on('requestfailed', (request) => {
    const url = new URL(request.url());
    if (!url.hostname.startsWith('ga-catalog.')) return;
    traffic.failed.push(`${url.pathname.slice(1)} (${request.failure()?.errorText ?? '?'})`);
  });
  return traffic;
}

/** Repite `probe` cada 250 ms hasta que dé `true` o pasen `timeoutMs`; dice si lo ha dado. */
async function waitUntil(probe: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const limit = Date.now() + timeoutMs;
  while (Date.now() < limit) {
    if (await probe().catch(() => false)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function readMeta(page: Page): Promise<CatalogMeta | null> {
  const meta: unknown = await page.evaluate(READ_META);
  return isCatalogMeta(meta) ? meta : null;
}

async function waitFull(page: Page): Promise<Status | null> {
  await waitInPage(page, FULL_OR_ERROR, 120_000);
  return (await page.evaluate(STATUS)) as Status | null;
}

async function open(page: Page, label: string): Promise<boolean> {
  try {
    await page.goto(appUrl);
    return true;
  } catch (error) {
    check(false, `${label}: la página no abre (${String(error).split('\n')[0]})`);
    return false;
  }
}

/** `meta.catalog` desde una página del origen que no arranca la app (un perfil conservado). */
async function metaBeforeVisit(page: Page): Promise<unknown> {
  try {
    await page.goto(new URL('/manifest.webmanifest', appUrl).href);
    return await page.evaluate(READ_META);
  } catch {
    return null;
  }
}

// Sin perfil, el navegador se cierra aparte: cerrar solo el contexto lo dejaba abierto, y Node no
// terminaba nunca (con perfil, cerrar el contexto cierra el navegador).
const browser = values.profile ? null : await chromium.launch();
const context = browser
  ? await browser.newContext()
  : await chromium.launchPersistentContext(values.profile ?? '');
await context.addInitScript({ content: WATCH_STATUS });
const page = context.pages()[0] ?? (await context.newPage());
const beforeValue = values.profile ? await metaBeforeVisit(page) : null;
const before = isCatalogMeta(beforeValue) ? beforeValue : null;
// Con un perfil conservado y 12 h desde la última comprobación, la primera visita pide el
// *manifest* (en segundo plano, sin esperar a `full`) y baja lo que haya cambiado.
const checkDue = before !== null && Date.now() - before.checkedAt >= CHECK_INTERVAL_MS;
const traffic = trafficOf(context);
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));

try {
  // 1. Primera visita (o la siguiente de un perfil conservado).
  const started = Date.now();
  if (await open(page, 'Primera visita')) {
    const status = await waitFull(page);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    check(
      status?.state === 'full' && !status.error,
      `Primera visita: catálogo ${status?.version ?? '—'} en ${status?.state ?? '—'} en ${seconds} s, sin error (${JSON.stringify(status?.error ?? null)})`,
    );
    await page.waitForTimeout(1500);
    if (checkDue && before) {
      // La comprobación termina al apuntarla en `meta.catalog`; una versión nueva se adopta
      // después, al acabar de indexarla en segundo plano.
      const checkedIn = Date.now();
      const isChecked = await waitUntil(
        async () => ((await readMeta(page))?.checkedAt ?? 0) > before.checkedAt,
        60_000,
      );
      const meta = await readMeta(page);
      check(
        isChecked,
        `Primera visita: comprueba el manifest (${((Date.now() - checkedIn) / 1000 + 1.5).toFixed(1)} s tras full; antes, meta.catalog era ${JSON.stringify(before)})`,
      );
      if (meta && meta.version !== before.version) {
        const isAdopted = await waitUntil(async () => {
          const now = (await page.evaluate(STATUS)) as Status | null;
          return now?.version === meta.version && now.state === 'full';
        }, 120_000);
        check(isAdopted, `Primera visita: pasa a ${meta.version} en segundo plano`);
      }
    }
    const meta = await page.evaluate(READ_META);
    check(meta !== null, `meta.catalog guardado: ${JSON.stringify(meta)}`);
    const kb = (traffic.catalogBytes / 1024).toFixed(1);
    console.log(
      `  de ga-catalog: ${traffic.catalogFiles.length} ficheros, ${kb} KB transferidos (${traffic.manifests} manifest)` +
        (before && !checkDue ? `; antes, meta.catalog era ${JSON.stringify(before)}` : ''),
    );
    if (traffic.catalogFiles.length <= 20) console.log(`  ${traffic.catalogFiles.join(', ')}`);
    if (traffic.failed.length > 0) console.log(`  fallidas: ${traffic.failed.join(', ')}`);
    if (checkDue && isCatalogMeta(meta) && meta.version !== before?.version) {
      // CA2.4: con un núcleo de ≤7 días baja el *manifest*, los recientes y poco más.
      const cores = traffic.catalogFiles.filter((path) => RE_CORE_FILE.test(path));
      check(
        traffic.catalogBytes / 1024 <= CA24_MAX_KB && cores.length === 0,
        `CA2.4: ${kb} KB de ga-catalog (≤${CA24_MAX_KB} KB) y ${cores.length === 0 ? 'sin núcleo' : `con núcleo (${cores.join(', ')})`}`,
      );
      const long = (await page.evaluate(LONG_AFTER_FULL)) as number[];
      check(
        long.length === 0,
        `CA2.4: ${long.length} tareas largas en el hilo principal durante la actualización${long.length > 0 ? ` (${long.join(', ')} ms)` : ''}`,
      );
    }
  }
  await waitInPage(page, CONTROLLED, 30_000);
  const isControlled = (await page.evaluate(CONTROLLED)) === true;

  // 2. Segunda visita: desde el Service Worker y sin pedir el *manifest*.
  traffic.manifests = 0;
  traffic.catalogFiles = [];
  traffic.failed = [];
  if (await open(page, 'Segunda visita')) {
    const status = await waitFull(page);
    await page.waitForTimeout(1500);
    check(status?.state === 'full', `Segunda visita: abre y llega a ${status?.state ?? '—'}`);
    check(
      traffic.manifests === 0,
      `Segunda visita: ${traffic.manifests} peticiones del manifest (0 antes de 12 h)`,
    );
    if (traffic.catalogFiles.length > 0) {
      console.log(`  de ga-catalog: ${traffic.catalogFiles.slice(0, 20).join(', ')}`);
    }
  }

  // 3. Sin red, si el Service Worker controla la página.
  if (isControlled) {
    await context.setOffline(true);
    if (await open(page, 'Sin red')) {
      const status = await waitFull(page);
      check(
        status?.state === 'full',
        `Sin red: abre y el catálogo llega a ${status?.state ?? '—'}`,
      );
    }
    await context.setOffline(false);
  } else {
    console.log('· Sin red: no se prueba, el Service Worker no controla la página');
  }
  check(
    errors.length === 0,
    `Sin errores de JavaScript${errors.length > 0 ? `: ${errors.join(' | ')}` : ''}`,
  );
} finally {
  await context.close();
  await browser?.close();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} comprobaciones fallan`);
  process.exit(1);
}
console.log('\nTodo en orden');
