// Las filas de Mi lista con la lista muy ancha (21-11-2026, DECISIONES §10.54): desde 1 280 px, las
// tres fechas en columnas (Apuntado, Empezado y Completado) en vez de la que toca; desde 1 600 px,
// también la nota, que empieza en la misma columna en todas las filas, con asa y número o sin ellos.
import { addEntry, type Entry } from '@gameagenda/core/entries';
import { formatHlc } from '@gameagenda/core/sync';
import { expect, type Page, test } from '@playwright/test';
import { v7 as uuidv7 } from 'uuid';
import { setup, waitForSearch } from './helpers.ts';
import { putEntries, storedMeta } from './storage.ts';

const idOf = (index: number) => `steam:${4_200_000 + index}`;
const titleOf = (index: number) => `Juego ancho ${index}`;

/** Dos en Jugando (con la fecha de empezarlos) y tres en Quiero jugar, con su prioridad. */
function seedEntries(): Entry[] {
  const start = Date.now() - 3_600_000;
  const entries: Entry[] = [];
  let lastRank: string | null = null;
  for (let index = 0; index < 5; index += 1) {
    const result = addEntry(
      undefined,
      { id: idOf(index), title: titleOf(index), status: index < 2 ? 'playing' : 'want_to_play' },
      {
        hlc: formatHlc({ ms: start + index, counter: 0, node: 'e2e00003' }),
        today: new Date().toISOString().slice(0, 10),
        newOpId: uuidv7,
        lastRank,
      },
    );
    if (!result) throw new Error(`No se pudo apuntar el juego ${index}`);
    lastRank = result.entry.rank;
    entries.push(result.entry);
  }
  return entries;
}

const row = (page: Page, index: number) =>
  page.locator(`.screen-slot--list .entry-row[data-entry-id="${idOf(index)}"]`);

/** Escribe la nota desde la ficha y vuelve a Mi lista. */
async function writeNote(page: Page, index: number, text: string) {
  await page.goto(`/juego/${idOf(index)}`);
  const field = page.getByRole('textbox', { name: 'Nota' });
  await field.fill(text);
  await field.blur();
  await page.goto('/');
}

test('con la lista muy ancha, las filas enseñan las tres fechas y la nota en columna (§10.54)', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Solo en pantallas anchas');
  const checks = await setup(page);
  await page.goto('/');
  await waitForSearch(page, 'full');
  await expect.poll(() => storedMeta(page, 'searchIndexKey'), { timeout: 15_000 }).not.toBeNull();
  await putEntries(page, seedEntries());
  await page.reload();
  await writeNote(page, 0, 'Probar el modo difícil');
  await writeNote(page, 3, 'Esperar a la edición completa');

  // 2 560 px: las tres fechas, la nota, y la de en medio ya no.
  await page.setViewportSize({ width: 2560, height: 1300 });
  const playing = row(page, 0);
  await expect(playing.locator('.entry-row__note')).toContainText('Probar el modo difícil');
  await expect(playing.locator('.entry-row__fact--column')).toHaveCount(3);
  await expect(playing.locator('.entry-row__fact--column').nth(0)).toContainText('Apuntado');
  await expect(playing.locator('.entry-row__fact--column').nth(1)).toContainText('Empezado');
  await expect(playing.locator('.entry-row__fact--column').nth(2)).toBeEmpty();
  await expect(playing.locator('.entry-row__fact--date')).toBeHidden();
  // La nota y las fechas, en la misma columna en Jugando (sin asa) y en Quiero jugar (con asa y
  // número).
  const left = (index: number, selector: string) =>
    row(page, index)
      .locator(selector)
      .first()
      .evaluate((element) => Math.round(element.getBoundingClientRect().left));
  expect(await left(3, '.entry-row__note')).toBe(await left(0, '.entry-row__note'));
  expect(await left(3, '.entry-row__fact--column')).toBe(await left(0, '.entry-row__fact--column'));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  // 1 600 px de ventana (unos 1 300 de lista): las tres fechas, sin la nota.
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect(playing.locator('.entry-row__fact--column').nth(1)).toBeVisible();
  await expect(playing.locator('.entry-row__note')).toBeHidden();

  // 1 280 px (unos 1 000 de lista): como antes, «Juego en» y la fecha que toca.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(playing.locator('.entry-row__fact--date')).toContainText('Empezado');
  await expect(playing.locator('.entry-row__fact--column').first()).toBeHidden();
  await checks.expectClean();
});
