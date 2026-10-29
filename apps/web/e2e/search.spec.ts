import { expect, type Page, test } from '@playwright/test';
import {
  measures,
  openPalette,
  paletteInput,
  releaseCatalog,
  setup,
  toast,
  waitForSearch,
} from './helpers.ts';

/** Guion de la §12.3: cinco juegos distintos del mini-catálogo. */
const SCRIPT: readonly (readonly [string, string])[] = [
  ['hollow', 'Hollow Knight'],
  ['elden', 'ELDEN RING'],
  ['baldurs', "Baldur's Gate 3"],
  ['celeste', 'Celeste'],
  ['stardew', 'Stardew Valley'],
];

/** Abre la paleta, teclea como una persona y apunta la primera fila (Intro o toque). */
async function captureLikeAPerson(page: Page, text: string, title: string, mobile: boolean) {
  if (mobile) await paletteInput(page).tap();
  else await openPalette(page);
  await paletteInput(page).pressSequentially(text, { delay: 100 });
  const first = page.getByRole('option').first();
  await expect(first).toHaveAccessibleName(new RegExp(`^${title}`));
  if (mobile) await first.tap();
  else await page.keyboard.press('Enter');
  await expect(toast(page)).toContainText(`Apuntado en Quiero jugar: ${title}`);
}

/**
 * Nombres de las filas de juegos de la paleta para `text`, cuando ya están pintados los
 * resultados de esa consulta (cada `seq` pintado deja una medida `search:keystroke-to-results`).
 */
async function optionNames(page: Page, text: string): Promise<string[]> {
  const painted = (await measures(page, 'search:keystroke-to-results')).length;
  await paletteInput(page).fill(text);
  await expect
    .poll(async () => (await measures(page, 'search:keystroke-to-results')).length)
    .toBeGreaterThan(painted);
  return page
    .locator('[role="option"][data-kind="game"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.querySelector('.palette__name')?.textContent ?? ''),
    );
}

test('sin red tras la primera visita: busca en todo el catálogo y apunta 5 juegos (CA1.8)', async ({
  page,
  context,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Service Worker y modo sin red: en Chromium');
  const checks = await setup(page);
  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await waitForSearch(page, 'full');

  // Modo avión: ni red ni catálogo (el Worker lo pide para ver si hay versión nueva).
  let blocked = 0;
  await context.route('**/catalog-dev/**', (route) => {
    blocked += 1;
    return route.abort('internetdisconnected');
  });
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByText('Sin conexión. Puedes seguir apuntando', { exact: false }),
  ).toBeVisible();
  await waitForSearch(page, 'full');
  await expect.poll(() => blocked).toBeGreaterThan(0);

  const mobile = testInfo.project.name.includes('movil');
  for (const [text, title] of SCRIPT) await captureLikeAPerson(page, text, title, mobile);
  await expect.poll(() => measures(page, 'capture:palette-to-confirm')).toHaveLength(5);
  const times = (await measures(page, 'capture:palette-to-confirm')).sort((a, b) => a - b);
  testInfo.annotations.push({
    type: 'medidas',
    description: `sin red: apuntar ${times.map(Math.round).join(', ')} ms`,
  });
  expect(times[2]).toBeLessThanOrEqual(3000);
  for (const duration of await measures(page, 'ui:feedback')) {
    expect(duration).toBeLessThanOrEqual(100);
  }
  await context.setOffline(false);
  await checks.expectClean();
});

test('puente de escaneo: en `scan` busca con los mismos niveles y al pasar a `full` no se pierde la consulta (CA1.11)', async ({
  page,
}) => {
  const checks = await setup(page, { hold: 'scan', latencyMs: 150 });
  await page.goto('/');
  await waitForSearch(page, 'ready');
  expect(await measures(page, 'search:full')).toHaveLength(0);
  await expect(page.getByText(/Preparando el catálogo/)).toHaveCount(0);

  // Exacto con artículo, alias, romanos, subcadena y un juego de la cola del catálogo.
  const queries = [
    'los sims 4',
    'bg3',
    'final fantasy 7',
    'eldenring',
    'hades',
    'mortal kombat 11',
  ];
  await openPalette(page);
  const inScan: string[][] = [];
  for (const q of queries) inScan.push(await optionNames(page, q));
  expect(inScan[0]?.[0]).toBe('The Sims™ 4');
  expect(inScan[1]?.[0]).toBe("Baldur's Gate 3");
  expect(inScan[2]?.[0]).toMatch(/^FINAL FANTASY VII/);
  expect(inScan[3]?.[0]).toBe('ELDEN RING');

  // Una consulta en curso (las respuestas tardan 150 ms) mientras el índice pasa a `full`.
  await paletteInput(page).fill('hades');
  await expect(page.getByRole('option').first()).toHaveAccessibleName(/^Hades 2020/);
  await paletteInput(page).pressSequentially(' ii', { delay: 0 });
  await releaseCatalog(page);
  await page.keyboard.press('Enter');
  await expect(toast(page)).toContainText('Apuntado en Quiero jugar: Hades II');
  await waitForSearch(page, 'full');

  await openPalette(page);
  const inFull: string[][] = [];
  for (const q of queries) inFull.push(await optionNames(page, q));
  expect(inFull).toEqual(inScan);
  await page.keyboard.press('Escape');
  await checks.expectClean();
});
