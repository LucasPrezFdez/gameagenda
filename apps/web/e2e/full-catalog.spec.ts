// Comprobación a mano con el catálogo completo (§12.4; CA1.2, CA1.3 y CA1.11): mide
// `search:ready`, `search:full` y la pulsación (`search:keystroke-to-results`) en `scan` y en
// `full` con los 196 665 juegos, y comprueba el contador y la última fila del Catálogo. Se salta
// salvo con `GA_FULL_CATALOG=1`. Desde `apps/web`, en PowerShell (otro puerto: no reutiliza una
// vista previa con el mini-catálogo):
//   npm run catalog:frozen
//   $env:CATALOG_DIR='pipeline/out'; $env:GA_FULL_CATALOG='1'; $env:E2E_PORT='4184'
//   npx playwright test full-catalog --project=chromium
import { type Browser, expect, type Page, test } from '@playwright/test';
import { measures, openPalette, paletteInput, releaseCatalog, setup } from './helpers.ts';

test.skip(!process.env.GA_FULL_CATALOG, 'Solo a mano, con CATALOG_DIR=pipeline/out');

const SLOW = { timeout: 120_000 };

/** Generador con semilla (mulberry32), el del banco de pruebas de la §8.11. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Manifest {
  readonly counts: { readonly core: number };
  readonly files: { readonly core: { readonly path: string } };
}

/** Conjunto realista reducido (§8.11): 20 populares, 20 intermedios y 20 de la cola. */
async function realisticNames(page: Page): Promise<{ names: string[]; manifest: Manifest }> {
  const manifest = (await (
    await page.request.get('/catalog-dev/manifest.json')
  ).json()) as Manifest;
  const core = await (await page.request.get(`/catalog-dev/${manifest.files.core.path}`)).text();
  const rows = core.split('\n').slice(1, -1);
  const rnd = mulberry32(20261028);
  const pick = (lo: number, hi: number, k: number) => {
    const s = new Set<number>();
    while (s.size < k) s.add(lo + Math.floor(rnd() * (hi - lo)));
    return [...s];
  };
  const ids = [...pick(0, 5000, 20), ...pick(5000, 50000, 20), ...pick(50000, rows.length, 20)];
  const names = ids.map((g) =>
    Array.from((rows[g] as string).split('\t')[1] as string)
      .slice(0, 25)
      .join(''),
  );
  return { names, manifest };
}

function stats(samples: readonly number[]) {
  const s = [...samples].sort((a, b) => a - b);
  const q = (f: number) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(f * s.length) - 1))] ?? 0;
  return { n: s.length, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +q(1).toFixed(1) };
}

async function waitMeasure(page: Page, name: string) {
  await expect.poll(() => measures(page, name), SLOW).toHaveLength(1);
  return Math.round((await measures(page, name))[0] as number);
}

/**
 * Teclea cada nombre carácter a carácter: pulsación → resultados pintados (ida y vuelta) y
 * tiempo de la consulta dentro del Worker.
 */
async function typeNames(page: Page, names: readonly string[]) {
  await page.evaluate(() => {
    performance.clearMeasures('search:keystroke-to-results');
    globalThis.__gaSearchTest?.workerMs.splice(0);
  });
  await openPalette(page);
  for (const name of names) {
    await paletteInput(page).pressSequentially(name, { delay: 25 });
    await page.waitForTimeout(150);
    await paletteInput(page).fill('');
  }
  await page.keyboard.press('Escape');
  const inWorker = await page.evaluate(() => [...(globalThis.__gaSearchTest?.workerMs ?? [])]);
  return {
    roundTrip: stats(await measures(page, 'search:keystroke-to-results')),
    inWorker: stats(inWorker),
  };
}

async function freshPage(browser: Browser, hold?: 'scan') {
  const context = await browser.newContext();
  const page = await context.newPage();
  await setup(page, hold ? { hold } : {});
  return { context, page };
}

test('catálogo completo: arranque, pulsación en `scan` y en `full` y última fila', async ({
  browser,
}, testInfo) => {
  test.setTimeout(600_000);
  const log = (line: string) => {
    console.log(line);
    testInfo.annotations.push({ type: 'medidas', description: line });
  };

  // 1. Primera visita (descarga y verificación del núcleo) y reinicio con caché.
  const { context, page } = await freshPage(browser);
  const { names, manifest } = await realisticNames(page);
  await page.goto('/');
  log(
    `primera visita: search:ready ${await waitMeasure(page, 'search:ready')} ms, search:full ${await waitMeasure(page, 'search:full')} ms`,
  );
  for (let i = 1; i <= 3; i++) {
    await page.reload();
    log(
      `reinicio con caché ${i}: search:ready ${await waitMeasure(page, 'search:ready')} ms, search:full ${await waitMeasure(page, 'search:full')} ms`,
    );
  }

  // 2. Pulsación → resultados con el índice completo.
  const full = await typeNames(page, names);
  log(`pulsación en full: ${JSON.stringify(full)} ms`);

  // 3. Catálogo con +18 visible: contador = manifest y última fila con Fin y con la barra.
  // Ajustes vive en memoria hasta que llegue Dexie: se navega sin recargar.
  await page.goto('/ajustes/contenido');
  await waitMeasure(page, 'search:full');
  await page.getByRole('checkbox', { name: /Mostrar juegos para adultos/ }).check();
  await page
    .getByRole('navigation', { name: 'Principal' })
    .getByRole('link', { name: 'Catálogo' })
    .click();
  const list = page.getByRole('list', { name: 'Juegos del catálogo' });
  await expect(page.getByText(/^196\s665 juegos$/)).toBeVisible(SLOW);
  expect(manifest.counts.core).toBe(196_665);
  await list.getByRole('link').first().focus();
  await page.keyboard.press('End');
  const lastRow = list.getByRole('listitem').filter({ has: page.locator(':focus') });
  await expect(lastRow).toHaveAttribute('aria-posinset', String(manifest.counts.core), SLOW);
  await expect(page.locator(':focus')).toBeInViewport();
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  log(`Catálogo: ${manifest.counts.core} filas, ${height} px de alto; Fin llega a la última`);
  await page.keyboard.press('Home');
  // La barra, a saltos por todo el catálogo (más ventanas de las que se guardan) y al final.
  for (let k = 1; k <= 20; k++) {
    await page.evaluate(
      (f) => window.scrollTo(0, f * document.documentElement.scrollHeight),
      k / 21,
    );
    await expect(list.getByRole('link').nth(2)).toBeVisible(SLOW);
  }
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(list.locator(`[aria-posinset="${manifest.counts.core}"]`)).toBeInViewport(SLOW);
  await expect(list.locator(`[aria-posinset="${manifest.counts.core}"] a`)).toBeVisible();
  log('Catálogo: la barra llega a la última fila');
  // La fila activa (la primera) sigue montada: ↓ baja a la segunda.
  await page.keyboard.press('ArrowDown');
  await expect(list.locator('[aria-posinset="2"] a')).toBeFocused(SLOW);
  await context.close();

  // 4. Pulsación en `scan` (puente de escaneo), con el Worker parado antes del índice.
  const scan = await freshPage(browser, 'scan');
  await scan.page.goto('/');
  log(`scan (primera visita): search:ready ${await waitMeasure(scan.page, 'search:ready')} ms`);
  const inScan = await typeNames(scan.page, names);
  log(`pulsación en scan: ${JSON.stringify(inScan)} ms`);
  await releaseCatalog(scan.page);
  await waitMeasure(scan.page, 'search:full');
  await scan.context.close();
});
