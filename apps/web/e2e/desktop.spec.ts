// El lado de la página del atajo de la app de escritorio (§17.3; ADR-010; CA3.7): la parte nativa
// ejecuta en la página `window.dispatchEvent(new Event('gameagenda:capture'))`, como aquí
// `page.evaluate` (los dos van por fuera de la CSP de la página, que `setup` vigila). La ventana,
// la bandeja y el atajo global se prueban a mano con el instalador (§12.5).
import { expect, type Page, test } from '@playwright/test';
import { paletteInput, setup, toast } from './helpers.ts';

declare global {
  var __gaSameDocument: boolean | undefined;
}

/** Lo que hace `CAPTURE_SCRIPT` en `apps/desktop/src-tauri/src/main.rs`. */
async function pressDesktopShortcut(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('gameagenda:capture')));
}

/** Marca el documento: si la página se recargara, la marca desaparecería. */
async function markDocument(page: Page) {
  await page.evaluate(() => {
    globalThis.__gaSameDocument = true;
  });
}

async function expectSameDocument(page: Page) {
  expect(await page.evaluate(() => globalThis.__gaSameDocument)).toBe(true);
}

test('en Mi lista, el atajo abre la paleta con el foco, sin recargar ni perder los filtros, y apunta', async ({
  page,
}) => {
  const checks = await setup(page);
  await page.goto('/?vista=todos');
  await expect(paletteInput(page)).toBeAttached();
  await markDocument(page);

  await pressDesktopShortcut(page);
  await expect(paletteInput(page)).toBeFocused();
  await expect(page).toHaveURL('/?vista=todos');

  await page.keyboard.type('hollow');
  await expect(page.getByRole('option').first()).toHaveAccessibleName(/^Hollow Knight/);
  await page.keyboard.press('Enter');
  await expect(toast(page)).toContainText('Apuntado en Quiero jugar: Hollow Knight');
  await expect(page).toHaveURL('/?vista=todos');
  await expectSameDocument(page);
  await checks.expectClean();
});

test('desde otra pantalla, el atajo lleva a /apuntar con la paleta abierta sobre Mi lista', async ({
  page,
}) => {
  const checks = await setup(page);
  await page.goto('/ajustes');
  await expect(page.getByRole('heading', { level: 1, name: 'Ajustes' })).toBeVisible();
  await markDocument(page);

  await pressDesktopShortcut(page);
  await expect(page).toHaveURL('/apuntar');
  await expect(paletteInput(page)).toBeFocused();
  await expect(page.getByRole('heading', { level: 1, name: 'Mi lista' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page).toHaveURL('/');
  await page.goBack();
  await expect(page).toHaveURL('/ajustes');
  await expectSameDocument(page);
  await checks.expectClean();
});

test('con la paleta ya abierta, el atajo la deja abierta y le devuelve el foco', async ({
  page,
}) => {
  const checks = await setup(page);
  await page.goto('/');
  await expect(paletteInput(page)).toBeAttached();
  await pressDesktopShortcut(page);
  await page.keyboard.type('cel');

  await pressDesktopShortcut(page);
  await expect(paletteInput(page)).toBeFocused();
  await expect(paletteInput(page)).toHaveValue('cel');
  await expect(paletteInput(page)).toHaveAttribute('aria-expanded', 'true');
  await checks.expectClean();
});
