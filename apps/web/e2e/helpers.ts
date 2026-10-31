import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** Ganchos del Worker de búsqueda en el *build* del modo `e2e` (`src/search-client/e2e-hooks.ts`). */
export interface SearchTestOptions {
  /** Retraso de cada respuesta del Worker, en ms. */
  readonly latencyMs?: number;
  /** El Worker se queda en `none` o en `scan` hasta `releaseCatalog(page)`. */
  readonly hold?: 'none' | 'scan';
  /** La primera carga del catálogo falla como sin red. */
  readonly failFirstLoad?: boolean;
  /**
   * Sin Ed25519 en WebCrypto, acepta sin verificarlo el *manifest* firmado con la clave de
   * desarrollo. En el *build* del modo `e2e` va encendido salvo `false`: el WebKit de Playwright
   * en Windows no tiene Ed25519 y, sin esto, `webkit-movil` no tendría catálogo (§11.3; ver
   * ADR-005). En Chromium no cambia nada: la firma se verifica siempre.
   */
  readonly unverifiedDevSignature?: boolean;
}

/** El `status` del Worker que guardan los ganchos (`StatusMessage` de `protocol.ts`). */
export interface CatalogStatus {
  readonly state: 'none' | 'boot' | 'scan' | 'full';
  readonly version: string | null;
  readonly count: number;
  readonly error: { readonly code: string; readonly retryable: boolean } | null;
  readonly catalog: { readonly version: string } | null;
}

declare global {
  var __GA_SEARCH_TEST__: SearchTestOptions | undefined;
  var __gaSearchTest:
    | { release(): void; readonly workerMs: number[]; readonly status: CatalogStatus | null }
    | undefined;
  var __cspViolations: string[];
}

/**
 * Ganchos de la búsqueda (por defecto, ninguno: el Worker real con el mini-catálogo) y registro
 * de violaciones de CSP y errores de la página y de sus Workers.
 */
export async function setup(page: Page, search: SearchTestOptions = {}) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${message.text()} (${message.location().url})`);
  });
  page.on('worker', (worker) => {
    worker.on('console', (message) => {
      if (message.type() === 'error') errors.push(`Worker: ${message.text()}`);
    });
  });
  // Ninguna prueba llega al CDN de portadas de Valve (M2): sin una ruta más concreta (la de
  // `serveCovers`, en `details.ts`), una imagen de 1 × 1 px.
  await page.context().route(/^https?:\/\/([^/]+\.)?steamstatic\.com\//, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64',
      ),
    }),
  );
  await page.addInitScript((options) => {
    globalThis.__GA_SEARCH_TEST__ = options;
    // Desde M2, el mini-catálogo trae *shards* sintéticos: sin esto, cada prueba vería portadas y
    // el aviso de primera capa. Las de portadas y detalles lo fijan con `serveDetails` (antes o
    // después que este *script*: solo se pone si nadie lo ha puesto).
    globalThis.__GA_DETAILS_TEST__ ??= { killSwitches: { covers: true, details: true } };
    globalThis.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      globalThis.__cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  }, search);
  return {
    /** Al final de cada prueba: ni errores ni violaciones de CSP (ver §12.3). */
    async expectClean() {
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => globalThis.__cspViolations)).toEqual([]);
    },
  };
}

/** El último `status` del Worker, o `null` si aún no ha llegado ninguno. */
export async function catalogStatus(page: Page): Promise<CatalogStatus | null> {
  return page.evaluate(() => globalThis.__gaSearchTest?.status ?? null);
}

/** Suelta el Worker parado con `hold`: sigue construyendo el índice. */
export async function releaseCatalog(page: Page) {
  await page.evaluate(() => globalThis.__gaSearchTest?.release());
}

/** Espera a que la búsqueda llegue a `state` (medidas `search:ready` y `search:full`). */
export async function waitForSearch(page: Page, state: 'ready' | 'full') {
  await expect.poll(() => measures(page, `search:${state}`)).toHaveLength(1);
}

export function paletteInput(page: Page) {
  return page.getByRole('combobox', { name: 'Apunta un juego' });
}

export function toast(page: Page) {
  return page.getByRole('status', { name: 'Avisos' });
}

/**
 * `Ctrl+K` cuando la app ya está montada: React 19 confirma el primer render de forma asíncrona y
 * en WebKit puede llegar después de `load` (antes, tampoco hay nada pintado que usar).
 */
export async function openPalette(page: Page) {
  await expect(paletteInput(page)).toBeAttached();
  await page.keyboard.press('Control+k');
  await expect(paletteInput(page)).toBeFocused();
}

/** Abre la paleta con `Ctrl+K`, escribe y espera a que la primera fila sea `first`. */
export async function search(page: Page, text: string, first: string | RegExp) {
  await openPalette(page);
  await page.keyboard.type(text);
  await expect(page.getByRole('option').first()).toHaveAccessibleName(
    typeof first === 'string' ? new RegExp(`^${escapeRegExp(first)}`) : first,
  );
}

export async function capture(page: Page, text: string, title: string) {
  await search(page, text, title);
  await page.keyboard.press('Enter');
  await expect(toast(page)).toContainText(`Apuntado en Quiero jugar: ${title}`);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** axe-core sin violaciones graves ni críticas (RNF-09, CA1.10). */
export async function expectAccessible(page: Page, label: string) {
  // Con una animación a medias (p. ej., la entrada del aviso), el contraste medido sería falso.
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
  );
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${label} · ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  expect(blocking).toEqual([]);
}

export async function measures(page: Page, name: string): Promise<number[]> {
  return page.evaluate(
    (measure) => performance.getEntriesByName(measure, 'measure').map((entry) => entry.duration),
    name,
  );
}
