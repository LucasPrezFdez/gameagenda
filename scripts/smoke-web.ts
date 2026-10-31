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
import { parseArgs } from 'node:util';
import { type BrowserContext, chromium, type Page } from '@playwright/test';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'https://ga-web.gameagenda.workers.dev/' },
    profile: { type: 'string' },
  },
});
const appUrl = new URL(values.url ?? '').href;

// Código que corre en la página, como texto (`scripts/` compila sin los tipos del navegador). Va
// siempre por `page.evaluate`, que Playwright ejecuta por fuera de la página. `waitForFunction`
// no sirve aquí: lo evalúa dentro, y la CSP de `ga-web` no admite `unsafe-eval`.

/** Guarda en `__smokeStatus` el último `status` del Worker de búsqueda (sin ganchos de prueba). */
const WATCH_STATUS = `{
  const Native = globalThis.Worker;
  globalThis.Worker = class extends Native {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', (event) => {
        const data = event.data;
        if (data && data.type === 'status') {
          globalThis.__smokeStatus = { state: data.state, version: data.version, error: data.error };
        }
      });
    }
  };
}`;
const STATUS = 'globalThis.__smokeStatus ?? null';
const CONTROLLED = 'navigator.serviceWorker.controller !== null';
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
}

interface Status {
  readonly state: string;
  readonly version: string | null;
  readonly error: unknown;
}

const failures: string[] = [];
function check(ok: boolean, message: string): void {
  console.log(`${ok ? '✓' : '✗'} ${message}`);
  if (!ok) failures.push(message);
}

function trafficOf(context: BrowserContext): Traffic {
  const traffic: Traffic = { manifests: 0, catalogFiles: [], catalogBytes: 0 };
  context.on('requestfinished', async (request) => {
    const url = new URL(request.url());
    if (!url.hostname.startsWith('ga-catalog.')) return;
    const path = url.pathname.slice(1);
    if (path === 'manifest.json') traffic.manifests++;
    traffic.catalogFiles.push(path);
    traffic.catalogBytes += (await request.sizes()).responseBodySize;
  });
  return traffic;
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

const context = values.profile
  ? await chromium.launchPersistentContext(values.profile)
  : await (await chromium.launch()).newContext();
await context.addInitScript({ content: WATCH_STATUS });
const page = context.pages()[0] ?? (await context.newPage());
const before = values.profile ? await metaBeforeVisit(page) : null;
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
    const meta = await page.evaluate(READ_META);
    check(meta !== null, `meta.catalog guardado: ${JSON.stringify(meta)}`);
    const kb = (traffic.catalogBytes / 1024).toFixed(1);
    console.log(
      `  de ga-catalog: ${traffic.catalogFiles.length} ficheros, ${kb} KB transferidos (${traffic.manifests} manifest)` +
        (before ? `; antes, meta.catalog era ${JSON.stringify(before)}` : ''),
    );
    if (traffic.catalogFiles.length <= 20) console.log(`  ${traffic.catalogFiles.join(', ')}`);
  }
  await waitInPage(page, CONTROLLED, 30_000);
  const isControlled = (await page.evaluate(CONTROLLED)) === true;

  // 2. Segunda visita: desde el Service Worker y sin pedir el *manifest*.
  traffic.manifests = 0;
  if (await open(page, 'Segunda visita')) {
    const status = await waitFull(page);
    await page.waitForTimeout(1500);
    check(status?.state === 'full', `Segunda visita: abre y llega a ${status?.state ?? '—'}`);
    check(
      traffic.manifests === 0,
      `Segunda visita: ${traffic.manifests} peticiones del manifest (0 antes de 12 h)`,
    );
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
}

if (failures.length > 0) {
  console.error(`\n${failures.length} comprobaciones fallan`);
  process.exit(1);
}
console.log('\nTodo en orden');
