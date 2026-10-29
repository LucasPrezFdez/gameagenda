import { expect, test } from '@playwright/test';
import {
  capture,
  measures,
  openPalette,
  paletteInput,
  search,
  setup,
  toast,
  waitForSearch,
} from './helpers.ts';

const listRow = (page: import('@playwright/test').Page, title: string) =>
  page.getByRole('main').getByRole('link', { name: new RegExp(`${title}$`) });

test('Ctrl+K, teclear e Intro apunta en Quiero jugar, con aviso, Deshacer y medidas', async ({
  page,
}) => {
  const checks = await setup(page);
  await page.goto('/');
  await search(page, 'hollow', 'Hollow Knight');
  await expect(paletteInput(page)).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Enter');

  await expect(toast(page)).toContainText('Apuntado en Quiero jugar: Hollow Knight');
  await expect(paletteInput(page)).not.toBeFocused();
  await expect(listRow(page, 'Hollow Knight')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Quiero jugar (1)' })).toBeVisible();

  await toast(page).getByRole('button', { name: 'Deshacer' }).click();
  await expect(toast(page)).toContainText('Hemos deshecho el último cambio.');
  await expect(listRow(page, 'Hollow Knight')).toHaveCount(0);

  expect(await measures(page, 'capture:palette-to-confirm')).toHaveLength(1);
  expect((await measures(page, 'search:keystroke-to-results')).length).toBeGreaterThan(0);
  expect((await measures(page, 'ui:feedback')).length).toBeGreaterThanOrEqual(2);
  await checks.expectClean();
});

test('Ctrl+Intro apunta y sigue; Esc cierra y devuelve el foco a su origen', async ({ page }) => {
  const checks = await setup(page);
  await page.goto('/');
  const origin = page.getByRole('link', { name: 'Explorar el catálogo' });
  await origin.focus();

  await search(page, 'celeste', 'Celeste');
  await page.keyboard.press('Control+Enter');
  await expect(toast(page)).toContainText('Apuntado en Quiero jugar: Celeste');
  await expect(paletteInput(page)).toBeFocused();
  await expect(paletteInput(page)).toHaveValue('');

  await page.keyboard.type('stardew');
  await expect(page.getByRole('option').first()).toHaveAccessibleName(/^Stardew Valley/);
  await page.keyboard.press('Control+Enter');
  await expect(toast(page)).toContainText('Apuntado en Quiero jugar: Stardew Valley');

  await page.keyboard.press('Escape');
  await expect(paletteInput(page)).not.toBeFocused();
  await expect(paletteInput(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(listRow(page, 'Celeste')).toBeVisible();
  await expect(listRow(page, 'Stardew Valley')).toBeVisible();
  expect(await measures(page, 'capture:palette-to-confirm')).toHaveLength(2);
  await checks.expectClean();
});

test('Ctrl+Z deshace varios niveles fuera de los campos de texto', async ({ page }) => {
  const checks = await setup(page);
  await page.goto('/');
  await capture(page, 'hades ii', 'Hades II');
  await capture(page, 'terraria', 'Terraria');

  await page.keyboard.press('Control+z');
  await expect(listRow(page, 'Terraria')).toHaveCount(0);
  await expect(listRow(page, 'Hades II')).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(listRow(page, 'Hades II')).toHaveCount(0);
  await expect(toast(page)).toContainText('Hemos deshecho el último cambio.');
  await checks.expectClean();
});

test('un juego ya apuntado muestra su estado, no se duplica y abre su ficha', async ({ page }) => {
  const checks = await setup(page);
  await page.goto('/');
  await capture(page, 'elden', 'ELDEN RING');

  await search(page, 'elden', /^ELDEN RING 2022 En tu lista: Quiero jugar/);
  await page.keyboard.press('Control+Enter');
  await expect(page.getByText('ELDEN RING ya está en tu lista: Quiero jugar.')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/juego/steam:1245620');
  await expect(page.getByRole('heading', { level: 1, name: 'ELDEN RING' })).toBeVisible();
  await checks.expectClean();
});

test('Mayús+Intro abre la ficha y Alt+Intro apunta con otro estado', async ({ page }) => {
  const checks = await setup(page);
  await page.goto('/');
  await search(page, 'baldurs', "Baldur's Gate 3");
  await page.keyboard.press('Shift+Enter');
  await expect(page).toHaveURL('/juego/steam:1086940');
  await expect(page.getByRole('heading', { level: 1, name: "Baldur's Gate 3" })).toBeVisible();

  await search(page, 'celeste', 'Celeste');
  await page.keyboard.press('Alt+Enter');
  await expect(page.getByRole('menu', { name: 'Apuntar «Celeste» como…' })).toBeVisible();
  await expect(page.getByRole('menuitemradio', { name: 'Quiero jugar' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemcheckbox', { name: 'Platinado' })).toBeFocused();
  await page.keyboard.press('Space');
  await page.keyboard.press('Enter');
  await expect(toast(page)).toContainText('Apuntado en Completado: Celeste');

  await search(page, 'terraria', 'Terraria');
  await page.keyboard.press('Alt+Enter');
  await page.keyboard.press('2');
  await expect(toast(page)).toContainText('Apuntado en Jugando: Terraria');
  await checks.expectClean();
});

test('sin resultados, la fila manual apunta lo escrito (Intro, Intro)', async ({ page }) => {
  const checks = await setup(page);
  await page.goto('/');
  await openPalette(page);
  await page.keyboard.type('mario kart');
  await expect(page.getByText('No hemos encontrado «mario kart» en Steam.')).toBeVisible();
  await expect(page.getByRole('option', { name: 'Apuntar «mario kart» a mano' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Título' })).toHaveValue('mario kart');
  await page.keyboard.press('Enter');
  await expect(toast(page)).toContainText('Apuntado en Quiero jugar: mario kart');
  await expect(listRow(page, 'mario kart')).toBeVisible();
  await checks.expectClean();
});

test('↑ desde la primera fila llega a «Apuntar … a mano»', async ({ page }) => {
  const checks = await setup(page);
  await page.goto('/');
  await search(page, 'hades', 'Hades');
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('option', { name: 'Apuntar «hades» a mano' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await checks.expectClean();
});

test('`/` (Mayús+7 en el teclado español) abre la paleta y se puede desactivar', async ({
  page,
}) => {
  const checks = await setup(page);
  await page.goto('/');
  const slash = () =>
    page.evaluate(() =>
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: '/',
          code: 'Digit7',
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );

  await expect(paletteInput(page)).toBeAttached();
  await slash();
  await expect(paletteInput(page)).toBeFocused();
  await page.keyboard.press('Escape');

  const nav = page.getByRole('navigation', { name: 'Principal' });
  await nav.getByRole('link', { name: 'Ajustes' }).click();
  await page.getByRole('link', { name: 'Teclado y gestos' }).click();
  await page.getByRole('checkbox', { name: 'Abrir la paleta con /' }).uncheck();
  await nav.getByRole('link', { name: 'Mi lista' }).click();
  await page.getByRole('heading', { level: 1, name: 'Mi lista' }).focus();
  await slash();
  await expect(paletteInput(page)).not.toBeFocused();
  await openPalette(page);
  await expect(paletteInput(page)).toBeFocused();
  await checks.expectClean();
});

test.describe('carrera de Intro', () => {
  test('con `delay: 0`, Intro apunta el resultado de la consulta completa', async ({ page }) => {
    const checks = await setup(page, { latencyMs: 150 });
    await page.goto('/');
    await waitForSearch(page, 'full');
    await openPalette(page);
    await paletteInput(page).pressSequentially('celeste', { delay: 0 });
    await page.keyboard.press('Enter');
    await expect(toast(page)).toContainText('Apuntado en Quiero jugar: Celeste');
    await expect(listRow(page, 'Counter-Strike 2')).toHaveCount(0);
    await checks.expectClean();
  });

  test('si los resultados no llegan en 500 ms, no apunta nada', async ({ page }) => {
    const checks = await setup(page, { latencyMs: 900 });
    await page.goto('/');
    await waitForSearch(page, 'full');
    await openPalette(page);
    await paletteInput(page).pressSequentially('celeste', { delay: 0 });
    await page.keyboard.press('Enter');
    await expect(page.getByText('Elige un resultado')).toBeVisible();
    await expect(toast(page)).toBeEmpty();
    await checks.expectClean();
  });
});

test('«¿Quizás buscabas…?»: Intro no apunta una sugerencia que no se ha elegido', async ({
  page,
}) => {
  const checks = await setup(page);
  await page.goto('/');
  await openPalette(page);
  await page.keyboard.type('hollow knigth');
  const group = page.getByRole('group', { name: '¿Quizás buscabas…?' });
  await expect(group.getByRole('option').first()).toHaveAccessibleName(/^Hollow Knight 2017/);
  await page.keyboard.press('Enter');
  await expect(page.getByText('¿Quizás buscabas…? Elige con ↓')).toBeVisible();
  await expect(toast(page)).toBeEmpty();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(toast(page)).toContainText('Apuntado en Quiero jugar: Hollow Knight');
  await checks.expectClean();
});

test('sin catálogo (`none`) busca en Mi lista y avisa del progreso; con error, Reintentar', async ({
  page,
}) => {
  const checks = await setup(page, { failFirstLoad: true });
  await page.goto('/');
  await openPalette(page);
  await page.keyboard.type('hades');
  await expect(page.getByText('No hemos podido descargar el catálogo de Steam.')).toBeVisible();
  await expect(page.getByRole('option', { name: 'Apuntar «hades» a mano' })).toHaveAttribute(
    'aria-selected',
    'false',
  );
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(page.getByText('No hemos podido descargar el catálogo de Steam.')).toHaveCount(0);
  await expect(page.getByText('Preparando el catálogo', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('option').first()).toHaveAccessibleName(/^Hades 2020/);
  await checks.expectClean();
});

test('en `none` busca en Mi lista: lo apuntado a mano se encuentra y abre su ficha', async ({
  page,
}) => {
  const checks = await setup(page, { hold: 'none' });
  await page.goto('/');
  await openPalette(page);
  await page.keyboard.type('Hades');
  await expect(page.getByText(/Preparando el catálogo de Steam… \d+\s%/)).toBeVisible();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(toast(page)).toContainText('Apuntado en Quiero jugar: Hades');

  await search(page, 'had', /^Hades En tu lista: Quiero jugar/);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/juego\/manual:/);
  await expect(page.getByText('Juego manual')).toBeVisible();
  await checks.expectClean();
});

test('apuntar 5 juegos: mediana <3 s y respuesta ≤100 ms (ver §12.3)', async ({
  page,
}, testInfo) => {
  const checks = await setup(page);
  await page.goto('/');
  await waitForSearch(page, 'full');
  const mobile = testInfo.project.name.includes('movil');
  const games: [string, string][] = [
    ['hollow', 'Hollow Knight'],
    ['elden', 'ELDEN RING'],
    ['baldurs', "Baldur's Gate 3"],
    ['celeste', 'Celeste'],
    ['stardew', 'Stardew Valley'],
  ];
  for (const [text, title] of games) {
    if (mobile) await paletteInput(page).tap();
    else await openPalette(page);
    await paletteInput(page).pressSequentially(text, { delay: 100 });
    const first = page.getByRole('option').first();
    await expect(first).toHaveAccessibleName(new RegExp(`^${title}`));
    if (mobile) await first.tap();
    else await page.keyboard.press('Enter');
    await expect(toast(page)).toContainText(`Apuntado en Quiero jugar: ${title}`);
  }
  await expect.poll(() => measures(page, 'capture:palette-to-confirm')).toHaveLength(5);
  const captureTimes = (await measures(page, 'capture:palette-to-confirm')).sort((a, b) => a - b);
  const feedback = await measures(page, 'ui:feedback');
  testInfo.annotations.push({
    type: 'medidas',
    description: `apuntar ${captureTimes.map(Math.round).join(', ')} ms; respuesta ${feedback.map(Math.round).join(', ')} ms`,
  });
  expect(captureTimes[2]).toBeLessThanOrEqual(3000);
  for (const duration of feedback) expect(duration).toBeLessThanOrEqual(100);
  await checks.expectClean();
});

test('en móvil, la barra abre la hoja, tocar la fila apunta y `(i)` abre la ficha', async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.includes('movil'), 'Solo con pantalla táctil');
  const checks = await setup(page);
  await page.goto('/');
  const input = paletteInput(page);
  await expect(input).toHaveAttribute('enterkeyhint', 'go');
  await expect(input).toHaveAttribute('autocapitalize', 'off');
  await expect(input).toHaveCSS('font-size', '16px');

  await input.tap();
  await expect(input).toBeFocused();
  await page.getByRole('checkbox', { name: 'Seguir apuntando' }).tap();
  await input.focus();
  await page.keyboard.type('hades');
  await page.getByRole('option', { name: /^Hades II/ }).tap();
  await expect(toast(page)).toContainText('Apuntado en Quiero jugar: Hades II');
  await expect(input).toBeFocused();

  await page.keyboard.type('elden');
  await page.getByRole('button', { name: 'Ficha de ELDEN RING', exact: true }).tap();
  await expect(page).toHaveURL('/juego/steam:1245620');
  await checks.expectClean();
});
