// Panel de rendimiento (Ajustes › Rendimiento, M3; §12.7): las medidas de la §12.4 de este
// dispositivo, guardadas entre sesiones en `meta.perfSamples`, y «Copiar informe», sin enviar
// nada. Es para el iPhone de CA3.1, donde no hay `chrome://inspect`.
import { expect, type Page, test } from '@playwright/test';
import { capture, expectAccessible, setup } from './helpers.ts';
import { storedMeta } from './storage.ts';

/** Ajustes › Rendimiento sin recargar: lo de esta sesión aún puede no estar guardado. */
async function openPanel(page: Page) {
  await page
    .getByRole('navigation', { name: 'Principal' })
    .getByRole('link', { name: 'Ajustes' })
    .click();
  await page
    .getByRole('navigation', { name: 'Secciones de Ajustes' })
    .getByRole('link', { name: 'Rendimiento' })
    .click();
  await expect(page).toHaveURL('/ajustes/rendimiento');
}

/** El número de muestras de una medida en la tabla del panel. */
async function samplesOf(page: Page, metric: string): Promise<number> {
  const cell = page.locator(`tr[data-metric="${metric}"] td`).first();
  return Number(await cell.textContent());
}

test('recoge las medidas de la app, las guarda entre sesiones y las borra (CA3.1)', async ({
  page,
}) => {
  const checks = await setup(page);
  await page.goto('/');
  await capture(page, 'hades ii', 'Hades II');
  await capture(page, 'celeste', 'Celeste');
  await page.keyboard.press('Escape');
  // Se guardan en segundo plano, 2 s después del último cambio.
  await expect
    .poll(() => storedMeta(page, 'perfSamples'), { timeout: 15_000 })
    .toMatchObject({
      values: { 'capture:palette-to-confirm': [expect.any(Number), expect.any(Number)] },
    });

  // Un reinicio da otra muestra de arranque, que se suma a las guardadas.
  await page.reload();
  await expect
    .poll(
      async () => {
        const stored = (await storedMeta(page, 'perfSamples')) as {
          values?: Record<string, unknown[]>;
        } | null;
        return stored?.values?.['app:list-visible']?.length ?? 0;
      },
      { timeout: 15_000 },
    )
    .toBe(2);
  await openPanel(page);
  const table = page.getByRole('table', { name: 'Medidas de rendimiento' });
  await expect(table).toBeVisible();
  await expect.poll(() => samplesOf(page, 'capture:palette-to-confirm')).toBe(2);
  expect(await samplesOf(page, 'search:keystroke-to-results')).toBeGreaterThan(0);
  expect(await samplesOf(page, 'app:list-visible')).toBe(2);
  await expect(
    table.getByRole('row', { name: /Apuntar: abrir la paleta → confirmación/ }),
  ).toContainText('p50 ≤ 3 s');
  await expect(page.getByText('Datos persistentes')).toBeVisible();
  await expectAccessible(page, 'panel de rendimiento');

  await page.getByRole('button', { name: 'Borrar las medidas' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Hemos borrado las medidas.' }),
  ).toBeVisible();
  expect(await samplesOf(page, 'capture:palette-to-confirm')).toBe(0);
  // Lo guardado también (el clic en «Borrar» puede dejar ya su INP).
  await expect
    .poll(async () => {
      const stored = (await storedMeta(page, 'perfSamples')) as {
        values?: Record<string, unknown[]>;
      } | null;
      return stored?.values?.['capture:palette-to-confirm'] ?? null;
    })
    .toBeNull();
  await checks.expectClean();
});

test('«Copiar informe» copia la tabla y los datos del dispositivo', async ({
  page,
  context,
  browserName,
  isMobile,
}) => {
  test.skip(browserName !== 'chromium' || isMobile, 'permisos de portapapeles: Chromium');
  const checks = await setup(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await capture(page, 'hades ii', 'Hades II');
  await page.keyboard.press('Escape');
  await openPanel(page);
  await page.getByRole('button', { name: 'Copiar informe' }).click();
  await expect(page.getByText('Hemos copiado el informe.')).toBeVisible();
  const report = await page.evaluate(() => navigator.clipboard.readText());
  expect(report).toContain('GameAgenda · Rendimiento');
  expect(report).toMatch(/Apuntar: abrir la paleta → confirmación \| 1 \|/);
  expect(report).toContain('Navegador: ');
  expect(report).toMatch(/Catálogo: \d{8}\.\d+/);
  await checks.expectClean();
});

test('a 320 px el panel no desplaza la página en horizontal', async ({ page }) => {
  const checks = await setup(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/ajustes/rendimiento');
  await expect(page.getByRole('table', { name: 'Medidas de rendimiento' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await checks.expectClean();
});
