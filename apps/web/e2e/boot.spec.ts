// Núcleo de arranque (M3, ADR-009; §8.8): en la primera visita, la búsqueda funciona con los más
// populares antes de que llegue el núcleo (`none` → `boot` → `scan` → `full`). El mini-catálogo de
// `fixtures/catalog` lo trae con todas sus filas (298), así que no distingue lo que está en él de
// lo que no: la última prueba lo usa tal cual (también en WebKit) y las demás «publican» con
// `context.route` el mismo catálogo con un núcleo de arranque de sus 100 primeras filas, firmado
// con la clave de desarrollo como `catalog-update.spec.ts`. Hollow Knight y Hades están en él;
// Celeste (fila 165), no. `context.route` solo ve las peticiones del Worker en Chromium.
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  type CoreCatalog,
  type CoreRow,
  coreRowAt,
  manifestSigningBytes,
  parseCore,
  serializeCore,
  toBase64Url,
} from '@gameagenda/core/catalog-format';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import {
  catalogStates,
  catalogStatus,
  expectAccessible,
  measures,
  openPalette,
  paletteInput,
  releaseCatalog,
  search,
  setup,
  toast,
  waitForSearch,
  waitForState,
} from './helpers.ts';

const FIXTURES = new URL('../../../fixtures/', import.meta.url);
const DEV_KEY = createPrivateKey(readFileSync(new URL('signing/dev-catalog-key.pem', FIXTURES)));
const BOOT_ROWS = 100;

interface FileSpec {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

type Manifest = Record<string, unknown> & {
  readonly version: string;
  readonly generatedAt: string;
  readonly files: Record<string, FileSpec>;
  readonly counts: Record<string, number>;
};

interface Published {
  readonly manifest: Manifest;
  readonly files: ReadonlyMap<string, string>;
}

const fixture = (path: string) => readFileSync(new URL(`catalog/${path}`, FIXTURES), 'utf8');
const current = JSON.parse(fixture('manifest.json')) as Manifest;
const CURRENT = current.version;
/** La versión del día siguiente (la regla de los 7 días deja el núcleo local). */
const NEXT = (() => {
  const day = new Date(
    Date.UTC(
      Number(CURRENT.slice(0, 4)),
      Number(CURRENT.slice(4, 6)) - 1,
      Number(CURRENT.slice(6, 8)) + 1,
    ),
  );
  return `${day.toISOString().slice(0, 10).replaceAll('-', '')}.1`;
})();

/** Un alta del día siguiente, que solo está en el `recent` nuevo. */
const ALTA: CoreRow = { appid: 4999999, name: 'Alta Reciente de Prueba', year: 2026, pop: 30 };

const rowsOf = (catalog: CoreCatalog) =>
  Array.from({ length: catalog.count }, (_, g) => coreRowAt(catalog, g));

function fileOf(prefix: string, text: string): FileSpec {
  const sha256 = createHash('sha256').update(text, 'utf8').digest('hex');
  return { path: `${prefix}.${sha256.slice(0, 16)}.tsv`, sha256, bytes: Buffer.byteLength(text) };
}

/**
 * El mini-catálogo en `version` (el del día siguiente: otra cabecera del núcleo y el alta en
 * `recent`), con o sin núcleo de arranque, firmado. Lo que trajera `fixtures/catalog` de núcleo de
 * arranque se sustituye.
 */
function publishVersion(version: string, withBoot: boolean): Published {
  const files = new Map<string, string>();
  const add = (prefix: string, text: string) => {
    const spec = fileOf(prefix, text);
    files.set(spec.path, text);
    return spec;
  };
  const { boot: _boot, ...currentFiles } = current.files;
  const { boot: _bootCount, ...currentCounts } = current.counts;
  const manifestFiles: Record<string, FileSpec> = { ...currentFiles };
  const counts: Record<string, number> = { ...currentCounts };
  const coreText = fixture(current.files.core?.path as string);
  if (version !== CURRENT) {
    const recentNow = parseCore(fixture(current.files.recent?.path as string), 'recent');
    const recentRows = [...rowsOf(recentNow), ALTA];
    manifestFiles.core = add('core', coreText.replace(CURRENT, version));
    manifestFiles.recent = add('recent', serializeCore(recentRows, { version, kind: 'recent' }));
    counts.recent = recentRows.length;
  }
  if (withBoot) {
    const rows = rowsOf(parseCore(coreText)).slice(0, BOOT_ROWS);
    manifestFiles.boot = add('boot', serializeCore(rows, { version, kind: 'boot' }));
    counts.boot = rows.length;
  }
  const { sig: _sig, ...previous } = current;
  const unsigned = {
    ...previous,
    version,
    generatedAt:
      version === CURRENT
        ? current.generatedAt
        : `${version.slice(0, 4)}-${version.slice(4, 6)}-${version.slice(6, 8)}T03:00:00Z`,
    counts,
    files: manifestFiles,
  };
  const signature = sign(null, manifestSigningBytes(unsigned), DEV_KEY);
  return {
    manifest: { ...unsigned, sig: { kid: 'dev-1', ed25519: toBase64Url(signature) } },
    files,
  };
}

/**
 * Sirve en `/catalog-dev/` el catálogo de `served.current` (se puede cambiar a mitad); el resto sale
 * del mini-catálogo. Devuelve las peticiones al catálogo, en orden.
 */
async function serve(context: BrowserContext, first: Published) {
  const served = { current: first, requests: [] as string[] };
  await context.route('**/catalog-dev/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/catalog-dev/', '');
    served.requests.push(path);
    const { manifest, files } = served.current;
    const text = path === 'manifest.json' ? JSON.stringify(manifest) : files.get(path);
    if (text === undefined) return route.fulfill({ response: await route.fetch() });
    const type = path.endsWith('.json') ? 'application/json' : 'text/plain; charset=utf-8';
    return route.fulfill({ body: text, headers: { 'Content-Type': type } });
  });
  return served;
}

async function waitForVersion(page: Page, version: string) {
  await expect
    .poll(async () => {
      const status = await catalogStatus(page);
      return status?.state === 'full' ? status.version : null;
    })
    .toBe(version);
}

const BOOT_HINT = /De momento buscamos en los 20\s000 juegos más populares/;

test('primera visita: `boot` antes que `scan` y el núcleo de arranque antes que el núcleo; al actualizar, nunca', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Publicar con `context.route`: en Chromium');
  // `scan` se ve con el gancho: con el mini-catálogo, un bloque del Worker llega a `full`.
  const checks = await setup(page, { hold: 'scan', checkEveryStart: true });
  const published = publishVersion(CURRENT, true);
  const served = await serve(context, published);
  await page.goto('/');
  await waitForState(page, 'scan');
  await releaseCatalog(page);
  await waitForSearch(page, 'full');
  expect(await catalogStates(page)).toEqual(['none', 'boot', 'scan', 'full']);

  // El *manifest*, el núcleo de arranque y los alias (a la vez) y después el núcleo; cada uno, una vez.
  const { boot, aliases, core } = published.manifest.files as Record<string, FileSpec>;
  const at = (spec: FileSpec | undefined) => served.requests.indexOf(spec?.path ?? '');
  const times = (spec: FileSpec | undefined) =>
    served.requests.filter((path) => path === spec?.path).length;
  expect(served.requests[0]).toBe('manifest.json');
  expect([times(boot), times(aliases), times(core)]).toEqual([1, 1, 1]);
  expect(at(boot)).toBeLessThan(at(core));
  expect(at(aliases)).toBeLessThan(at(core));

  // `search:ready` llega con `boot`, y con él `search:boot` (RNF-05).
  const [ready] = await measures(page, 'search:ready');
  const [bootAt] = await measures(page, 'search:boot');
  expect(bootAt).toBeDefined();
  expect(Math.abs((bootAt as number) - (ready as number))).toBeLessThan(50);
  test.info().annotations.push({
    type: 'medidas',
    description: `primera visita con núcleo de arranque (sin estrangular): search:boot ${Math.round(bootAt as number)} ms, search:full ${Math.round((await measures(page, 'search:full'))[0] as number)} ms`,
  });

  // Al día siguiente, otro núcleo de arranque: la actualización no lo baja (CA2.4).
  const next = publishVersion(NEXT, true);
  served.current = next;
  served.requests.length = 0;
  await page.reload();
  // El gancho sigue puesto: el núcleo de la caché se para en `scan` hasta soltarlo.
  await waitForState(page, 'scan');
  await releaseCatalog(page);
  await waitForVersion(page, NEXT);
  expect(served.requests).toEqual(['manifest.json', next.manifest.files.recent?.path]);
  expect(await catalogStates(page)).toEqual(['none', 'scan', 'full']);
  await checks.expectClean();
});

test('en `boot` busca en los más populares: lo de fuera avisa, Intro no lo apunta a mano y llega después', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Publicar con `context.route`: en Chromium');
  const checks = await setup(page, { hold: 'boot' });
  await serve(context, publishVersion(CURRENT, true));
  await page.goto('/catalogo');
  await waitForState(page, 'boot');
  // El Catálogo recorre todas las filas: espera al núcleo, como en `none`.
  await expect(page.getByText(/Preparando el catálogo de Steam… \d+\s%/)).toBeVisible();
  await expectAccessible(page, 'Catálogo en boot');

  // Un juego del núcleo de arranque se encuentra, con el aviso junto a los resultados.
  await search(page, 'hollow', /^Hollow Knight 2017/);
  await expect(page.getByText(BOOT_HINT)).toBeVisible();
  await expectAccessible(page, 'paleta en boot');

  // Uno de fuera: ni «no está en Steam» ni la fila manual resaltada; Intro no abre el formulario.
  await paletteInput(page).fill('celeste');
  const manual = page.getByRole('option', { name: 'Apuntar «celeste» a mano' });
  await expect(manual).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByRole('option', { name: /^Celeste \d{4}/ })).toHaveCount(0);
  await expect(page.getByText('No hemos encontrado «celeste» en Steam.')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Título' })).toHaveCount(0);
  await expect(toast(page)).toBeEmpty();

  // Llega el núcleo: la misma consulta encuentra Celeste, sin el aviso, e Intro la apunta.
  await releaseCatalog(page);
  await expect(page.getByRole('option').first()).toHaveAccessibleName(/^Celeste 2018/);
  await expect(page.getByText(BOOT_HINT)).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(toast(page)).toContainText('Apuntado en Quiero jugar: Celeste');
  // Y el Catálogo ya cuenta todas las filas.
  await expect(page.getByText(/Preparando el catálogo/)).toHaveCount(0);
  await expect(page.getByText('Sin DLC · +18 oculto')).toBeVisible();
  await checks.expectClean();
});

test('sin `files.boot` (el catálogo de hoy en producción), la primera visita es la de M2', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Publicar con `context.route`: en Chromium');
  const checks = await setup(page, { hold: 'scan' });
  const served = await serve(context, publishVersion(CURRENT, false));
  await page.goto('/');
  await waitForState(page, 'scan');
  await openPalette(page);
  await page.keyboard.type('celeste');
  await expect(page.getByRole('option').first()).toHaveAccessibleName(/^Celeste 2018/);
  await expect(page.getByText(BOOT_HINT)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await releaseCatalog(page);
  await waitForSearch(page, 'full');
  expect(await catalogStates(page)).toEqual(['none', 'scan', 'full']);
  expect(await measures(page, 'search:boot')).toHaveLength(0);
  expect(served.requests.some((path) => path.startsWith('boot.'))).toBe(false);
  await checks.expectClean();
});

test('con el núcleo de arranque del mini-catálogo, sin `context.route` (también en WebKit): de `boot` a `full`', async ({
  page,
}) => {
  test.skip(current.files.boot === undefined, 'El mini-catálogo no trae núcleo de arranque');
  const checks = await setup(page, { hold: 'boot' });
  await page.goto('/catalogo');
  await waitForState(page, 'boot');
  // El de `fixtures/catalog`: todas sus filas, con los +18 ocultos como en el núcleo.
  const inBoot = await catalogStatus(page);
  expect(inBoot?.version).toBe(CURRENT);
  expect(inBoot?.count).toBeLessThan(current.counts.boot as number);
  await expect(page.getByText(/Preparando el catálogo de Steam… \d+\s%/)).toBeVisible();
  await search(page, 'hollow', /^Hollow Knight 2017/);
  await expect(page.getByText(BOOT_HINT)).toBeVisible();
  await page.keyboard.press('Escape');

  await releaseCatalog(page);
  await waitForSearch(page, 'full');
  expect(await catalogStates(page)).toEqual(['none', 'boot', 'scan', 'full']);
  expect(await measures(page, 'search:boot')).toHaveLength(1);
  expect((await catalogStatus(page))?.count).toBe(inBoot?.count);
  await expect(page.getByText(/Preparando el catálogo/)).toHaveCount(0);
  await expect(page.getByText('Sin DLC · +18 oculto')).toBeVisible();
  await checks.expectClean();
});
