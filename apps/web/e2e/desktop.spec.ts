// El lado de la página del atajo de la app de escritorio (§17.3; ADR-010; DECISIONES §10.32). Desde
// el 06-11-2026, `Ctrl+Mayús+Espacio` solo pone la ventana delante (eso lo hace la parte nativa) y
// la página no abre la paleta. La parte nativa sigue ejecutando
// `window.dispatchEvent(new Event('gameagenda:capture'))`, como aquí `page.evaluate`, y la página no
// lo atiende. La ventana, la bandeja y el atajo global se prueban a mano con el instalador (§12.5).
import { expect, type Page, test } from '@playwright/test';
import { paletteInput, setup } from './helpers.ts';

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

test('en Mi lista, el atajo no abre la paleta ni toca la URL ni recarga', async ({ page }) => {
  const checks = await setup(page);
  await page.goto('/?vista=todos');
  await expect(paletteInput(page)).toBeAttached();
  await markDocument(page);

  await pressDesktopShortcut(page);
  await expect(paletteInput(page)).not.toBeFocused();
  await expect(paletteInput(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(page).toHaveURL('/?vista=todos');
  await expectSameDocument(page);
  await checks.expectClean();
});

test('desde otra pantalla, el atajo se queda en ella', async ({ page }) => {
  const checks = await setup(page);
  await page.goto('/ajustes');
  await expect(page.getByRole('heading', { level: 1, name: 'Ajustes' })).toBeVisible();
  await markDocument(page);

  await pressDesktopShortcut(page);
  await expect(page).toHaveURL('/ajustes');
  await expect(page.getByRole('heading', { level: 1, name: 'Ajustes' })).toBeVisible();
  await expectSameDocument(page);
  await checks.expectClean();
});

test('con la paleta abierta, el atajo no la cierra ni le borra el texto', async ({ page }) => {
  const checks = await setup(page);
  await page.goto('/');
  await expect(paletteInput(page)).toBeAttached();
  await paletteInput(page).click();
  await page.keyboard.type('cel');
  await expect(paletteInput(page)).toHaveAttribute('aria-expanded', 'true');

  await pressDesktopShortcut(page);
  await expect(paletteInput(page)).toHaveValue('cel');
  await expect(paletteInput(page)).toHaveAttribute('aria-expanded', 'true');
  await checks.expectClean();
});
