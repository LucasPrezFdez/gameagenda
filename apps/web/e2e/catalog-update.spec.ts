// Catálogo vivo en el cliente (M2; §5.3, §5.4, §7.6 y §11.3): firma del *manifest*, regla de los
// 7 días (CA2.4), *manifest* manipulado (CA2.3) y navegador sin Ed25519 (RNF-12). La versión
// nueva la «publica» la prueba: sirve con `context.route` un *manifest* firmado con la clave de
// desarrollo, como `npm run catalog:frozen`, sobre los ficheros del mini-catálogo.
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  type CoreRow,
  coreRowAt,
  manifestSigningBytes,
  parseCore,
  serializeCore,
  toBase64Url,
} from '@gameagenda/core/catalog-format';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { catalogStatus, paletteInput, search, setup, waitForSearch } from './helpers.ts';

const FIXTURES = new URL('../../../fixtures/', import.meta.url);
const DEV_KEY = createPrivateKey(readFileSync(new URL('signing/dev-catalog-key.pem', FIXTURES)));
const CURRENT = '20261028.1';
const NEXT = '20261029.1';

interface FileSpec {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

type Manifest = Record<string, unknown> & {
  readonly version: string;
  readonly files: Record<string, FileSpec>;
  readonly counts: Record<string, number>;
};

const fixture = (path: string) => readFileSync(new URL(`catalog/${path}`, FIXTURES), 'utf8');
const current = JSON.parse(fixture('manifest.json')) as Manifest;

function fileOf(prefix: string, text: string): FileSpec {
  const sha256 = createHash('sha256').update(text, 'utf8').digest('hex');
  return { path: `${prefix}.${sha256.slice(0, 16)}.tsv`, sha256, bytes: Buffer.byteLength(text) };
}

/** Un alta del día siguiente, que solo está en el `recent` nuevo. */
const ALTA: CoreRow = { appid: 4999999, name: 'Alta Reciente de Prueba', year: 2026, pop: 30 };

/**
 * La versión del día siguiente: núcleo nuevo (el de hoy con otra cabecera), `recent` con el alta
 * y los mismos alias e índice de *shards*. Firmada salvo que se manipule después.
 */
function nextVersion() {
  const recentNow = parseCore(fixture(current.files.recent?.path as string), 'recent');
  const recentRows = [
    ...Array.from({ length: recentNow.count }, (_, g) => coreRowAt(recentNow, g)),
    ALTA,
  ];
  const recent = serializeCore(recentRows, { version: NEXT, kind: 'recent' });
  const core = fixture(current.files.core?.path as string).replace(CURRENT, NEXT);
  const recentFile = fileOf('recent', recent);
  const coreFile = fileOf('core', core);
  const { sig: _sig, ...previous } = current;
  const unsigned = {
    ...previous,
    version: NEXT,
    generatedAt: '2026-10-29T03:00:00Z',
    counts: { ...current.counts, recent: recentRows.length },
    files: { ...current.files, core: coreFile, recent: recentFile },
  };
  const signature = sign(null, manifestSigningBytes(unsigned), DEV_KEY);
  const manifest = { ...unsigned, sig: { kid: 'dev-1', ed25519: toBase64Url(signature) } };
  return {
    manifest,
    files: new Map([
      [coreFile.path, core],
      [recentFile.path, recent],
    ]),
  };
}

/**
 * Publica `manifest` (y `files`) en `/catalog-dev/` para el contexto; el resto sale del
 * mini-catálogo. Devuelve las peticiones al catálogo y los bytes servidos.
 */
async function publishNext(
  context: BrowserContext,
  manifest: Record<string, unknown>,
  files: ReadonlyMap<string, string>,
) {
  const log = { requests: [] as string[], bytes: 0 };
  await context.route('**/catalog-dev/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/catalog-dev/', '');
    log.requests.push(path);
    const text = path === 'manifest.json' ? JSON.stringify(manifest) : files.get(path);
    if (text !== undefined) {
      log.bytes += Buffer.byteLength(text);
      const type = path.endsWith('.json') ? 'application/json' : 'text/plain; charset=utf-8';
      return route.fulfill({ body: text, headers: { 'Content-Type': type } });
    }
    const response = await route.fetch();
    log.bytes += (await response.body()).byteLength;
    return route.fulfill({ response });
  });
  return log;
}

async function waitForVersion(page: Page, version: string) {
  await expect
    .poll(async () => {
      const status = await catalogStatus(page);
      return status?.state === 'full' ? status.version : null;
    })
    .toBe(version);
}

test('regla de los 7 días: al día siguiente solo baja el manifest y los recientes (CA2.4)', async ({
  page,
  context,
  browserName,
}) => {
  // Comprobado el 31-10-2026: en WebKit, `context.route` no ve las peticiones del Worker.
  test.skip(browserName !== 'chromium', 'Publicar con `context.route`: en Chromium');
  const checks = await setup(page);
  await page.goto('/');
  await waitForSearch(page, 'full');
  expect((await catalogStatus(page))?.version).toBe(CURRENT);

  const next = nextVersion();
  const log = await publishNext(context, next.manifest, next.files);
  await page.reload();
  await expect.poll(() => log.requests).toContain('manifest.json');
  await waitForVersion(page, NEXT);
  // Ni el núcleo nuevo ni los alias o el índice de *shards*, que no han cambiado.
  expect(log.requests).toEqual(['manifest.json', next.manifest.files.recent.path]);
  expect(log.bytes).toBeLessThanOrEqual(200_000);
  test.info().annotations.push({
    type: 'medidas',
    description: `actualización con el núcleo local: ${log.bytes} bytes (${log.requests.join(', ')})`,
  });
  const status = await catalogStatus(page);
  expect(status?.error).toBeNull();
  expect(status?.catalog?.version).toBe(NEXT);

  // El alta del `recent` nuevo ya se encuentra, sobre el núcleo de ayer.
  await search(page, 'alta reciente', 'Alta Reciente de Prueba');
  await page.keyboard.press('Escape');
  await checks.expectClean();
});

test('un manifest manipulado no sustituye al catálogo vigente (CA2.3)', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Verificar la firma necesita Ed25519: en Chromium');
  const checks = await setup(page);
  await page.goto('/');
  await waitForSearch(page, 'full');

  // Firmado y después tocado: otra edad del enriquecimiento.
  const next = nextVersion();
  const tampered = { ...next.manifest, enrichmentAgeDays: 9 };
  const log = await publishNext(context, tampered, next.files);
  await page.reload();
  await waitForSearch(page, 'full');
  await expect
    .poll(async () => (await catalogStatus(page))?.error)
    .toEqual({ code: 'signature', retryable: true });
  const status = await catalogStatus(page);
  expect(status).toMatchObject({ state: 'full', version: CURRENT });
  // Del *manifest* rechazado no se ha bajado nada.
  expect(log.requests).toEqual(['manifest.json']);
  await search(page, 'hollow', 'Hollow Knight');
  await page.keyboard.press('Escape');
  await checks.expectClean();
});

/** ¿Tiene esta página Ed25519 en WebCrypto? El WebKit de Playwright en Windows, no. */
function hasEd25519(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']).then(
      () => true,
      () => false,
    ),
  );
}

const NO_ED25519 = 'Este navegador trae Ed25519: el camino de RNF-12 no se puede probar aquí';

test('sin Ed25519 (WebKit de Playwright en Windows): sigue el catálogo de la caché y pide otro navegador (RNF-12)', async ({
  page,
}) => {
  const checks = await setup(page);
  await page.goto('/');
  test.skip(await hasEd25519(page), NO_ED25519);
  // Primera visita con el gancho de los E2E: el catálogo queda en la caché.
  await waitForSearch(page, 'full');

  // Al volver, sin el gancho: la firma del *manifest* no se puede verificar.
  await page.addInitScript(() => {
    globalThis.__GA_SEARCH_TEST__ = {
      ...globalThis.__GA_SEARCH_TEST__,
      unverifiedDevSignature: false,
    };
  });
  await page.reload();
  await waitForSearch(page, 'full');
  await expect
    .poll(async () => (await catalogStatus(page))?.error)
    .toEqual({ code: 'browser-too-old', retryable: false });
  expect(await catalogStatus(page)).toMatchObject({ state: 'full', version: CURRENT });
  await paletteInput(page).tap();
  await paletteInput(page).fill('hollow');
  await expect(page.getByRole('option').first()).toHaveAccessibleName(/^Hollow Knight/);
  await checks.expectClean();
});

test('sin Ed25519 y sin caché no hay catálogo: se avisa sin «Reintentar» y se apunta a mano (RNF-12)', async ({
  page,
}) => {
  const checks = await setup(page, { unverifiedDevSignature: false });
  await page.goto('/');
  test.skip(await hasEd25519(page), NO_ED25519);
  await expect
    .poll(async () => (await catalogStatus(page))?.error)
    .toEqual({ code: 'browser-too-old', retryable: false });
  expect(await catalogStatus(page)).toMatchObject({ state: 'none', catalog: null });
  await page.goto('/catalogo');
  await expect(page.getByText('No hemos podido descargar el catálogo de Steam.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reintentar' })).toHaveCount(0);
  await checks.expectClean();
});
