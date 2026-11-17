// Mi lista con cientos de juegos (Fase 2, parte 1; DECISIONES §10.48): desde `VIRTUAL_FROM` (300)
// filas a la vista, cada sección pinta solo las cercanas a la pantalla (`SectionRows.tsx`). Con 600
// juegos: pocas filas en el DOM y el alto de todas, desplazarse, cambiar un estado,
// filtrar por debajo de 300, axe y, con teclado y ratón, Inicio y Fin, J y K en la ficha y el asa.
//
// Con selectores CSS donde hay muchas filas: buscar por rol recorre todo el árbol de accesibilidad.
import { addEntry, type Entry } from '@gameagenda/core/entries';
import { formatHlc } from '@gameagenda/core/sync';
import { expect, type Page, test } from '@playwright/test';
import { v7 as uuidv7 } from 'uuid';
import { expectAccessible, setup, toast, waitForSearch } from './helpers.ts';
import { putEntries, storedMeta } from './storage.ts';

const COUNT = 600;
/** Por encima de esto se pintan todas (no puede haber más en el DOM con la lista virtual). */
const FEW_ROWS = 60;

const idOf = (index: number) => `steam:${4_000_000 + index}`;
const titleOf = (index: number) => `Juego de prueba ${String(index).padStart(3, '0')}`;

/** `count` juegos en Quiero jugar, en orden; uno de cada tres, comprado. */
function manyEntries(count: number): Entry[] {
  const start = Date.now() - 3_600_000;
  const entries: Entry[] = [];
  let lastRank: string | null = null;
  for (let index = 0; index < count; index += 1) {
    const result = addEntry(
      undefined,
      {
        id: idOf(index),
        title: titleOf(index),
        status: 'want_to_play',
        flags: { owned: index % 3 === 0 },
      },
      {
        hlc: formatHlc({ ms: start + index, counter: 0, node: 'e2e00001' }),
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

/** Abre la app, guarda los juegos directamente en IndexedDB (ver `putEntries`) y recarga. */
async function seedGames(page: Page, count: number) {
  await page.goto('/');
  // Antes de recargar, el catálogo entero y su índice guardado (ver `catalogSettled` en data.spec).
  await waitForSearch(page, 'full');
  await expect.poll(() => storedMeta(page, 'searchIndexKey'), { timeout: 15_000 }).not.toBeNull();
  await putEntries(page, manyEntries(count));
  await page.reload();
}

const section = (page: Page, id: string) => page.locator(`.list-section[data-section="${id}"]`);
const rows = (page: Page) => page.locator('.screen-slot--list .entry-row');
const rowOf = (page: Page, index: number) =>
  page.locator(`.screen-slot--list .entry-row[data-entry-id="${idOf(index)}"]`);
const titleLink = (page: Page, index: number) => rowOf(page, index).locator('[data-row-title]');

/** El alto de cada fila pintada y la suma de filas y huecos de la sección, frente a `setSize`. */
async function geometry(page: Page, sectionId: string) {
  return section(page, sectionId)
    .locator('ol')
    .evaluate((list) => {
      const children = [...list.children] as HTMLElement[];
      const heights = children
        .filter((child) => child.classList.contains('entry-row'))
        .map((row) => row.getBoundingClientRect().height);
      const total = children.reduce((sum, child) => sum + child.getBoundingClientRect().height, 0);
      return { heights, total };
    });
}

/** Lleva la ventana hasta la fila `index` de la sección (por su posición, sin que esté pintada). */
async function scrollToIndex(page: Page, sectionId: string, index: number) {
  await section(page, sectionId)
    .locator('ol')
    .evaluate((list, target) => {
      const row = list.querySelector<HTMLElement>(':scope > .entry-row');
      const height = row?.getBoundingClientRect().height ?? 76;
      window.scrollTo(0, window.scrollY + list.getBoundingClientRect().top + target * height);
    }, index);
}

test.setTimeout(120_000);

test('con 600 juegos, Mi lista pinta solo las filas cercanas y todo funciona igual', async ({
  page,
  isMobile,
}) => {
  const checks = await setup(page);
  await seedGames(page, COUNT);
  await expect(page.getByRole('heading', { name: `Quiero jugar (${COUNT})` })).toBeVisible();

  // Pocas filas en el DOM, con su posición para el lector, y el alto de las 600: todas las filas
  // miden lo mismo (en el móvil, con «Estado debajo», y con o sin la marca de Comprado).
  await expect(rowOf(page, 0)).toBeVisible();
  expect(await rows(page).count()).toBeLessThan(FEW_ROWS);
  await expect(rowOf(page, 0)).toHaveAttribute('aria-setsize', String(COUNT));
  await expect(rowOf(page, 0)).toHaveAttribute('aria-posinset', '1');
  const { heights, total } = await geometry(page, 'want_to_play');
  const height = heights[0] ?? 0;
  expect(height).toBeGreaterThanOrEqual(76);
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1);
  expect(Math.abs(total - COUNT * height)).toBeLessThan(COUNT);
  await expectAccessible(page, `Mi lista con ${COUNT} juegos`);

  // Desplazarse pinta las filas nuevas, y no más que antes.
  await scrollToIndex(page, 'want_to_play', 300);
  await expect(rowOf(page, 300)).toBeInViewport();
  await expect(rowOf(page, 300)).toHaveAttribute('aria-posinset', '301');
  // La primera sigue: es la del *tabindex* itinerante, que nunca se desmonta.
  await expect(rowOf(page, 0)).toHaveCount(1);
  await expect(rowOf(page, 1)).toHaveCount(0);
  expect(await rows(page).count()).toBeLessThan(FEW_ROWS);

  // Cambiar un estado desde ahí: pasa a Jugando ahora, arriba, y el foco va a la siguiente.
  await page
    .getByRole('button', { name: `Quiero jugar: cambiar estado de ${titleOf(300)}` })
    .click();
  await page.getByRole('menuitemradio', { name: 'Jugando' }).click();
  await expect(toast(page)).toContainText(`${titleOf(300)} pasa a Jugando`);
  await expect(page.getByRole('heading', { name: 'Jugando ahora (1)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: `Quiero jugar (${COUNT - 1})` })).toBeVisible();
  await expect(titleLink(page, 301)).toBeFocused();
  await expect(rowOf(page, 301)).toHaveAttribute('aria-posinset', '301');
  await expect(rowOf(page, 301)).toBeInViewport();

  // Filtrar por debajo de 300: se pintan todas, sin posición (ya la da la lista).
  const filter = page.locator('[data-filter-field]');
  await filter.fill('1');
  await expect(page.getByRole('heading', { name: 'Quiero jugar (100)' })).toBeVisible();
  await expect(rows(page)).toHaveCount(100);
  await expect(rowOf(page, 150)).not.toHaveAttribute('aria-setsize');
  await filter.fill('');
  await expect(page.getByRole('heading', { name: `Quiero jugar (${COUNT - 1})` })).toBeVisible();
  await expect.poll(() => rows(page).count()).toBeLessThan(FEW_ROWS);

  if (isMobile) {
    await checks.expectClean();
    return;
  }

  // Con teclado: Fin y Inicio llegan a filas que no estaban pintadas, con el foco y a la vista.
  await page.evaluate(() => window.scrollTo(0, 0));
  await titleLink(page, 300).focus();
  await page.keyboard.press('End');
  await expect(titleLink(page, COUNT - 1)).toBeFocused();
  await expect(rowOf(page, COUNT - 1)).toBeInViewport();
  await page.keyboard.press('ArrowUp');
  await expect(titleLink(page, COUNT - 2)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(titleLink(page, 300)).toBeFocused();
  await expect(rowOf(page, 300)).toBeInViewport();
  await page.keyboard.press('ArrowDown');
  await expect(titleLink(page, 0)).toBeFocused();

  // J y K en la ficha recorren toda la lista, también lo que no está pintado detrás.
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`/juego/${idOf(0)}`);
  for (let index = 1; index <= 40; index += 1) {
    await page.keyboard.press('j');
    await expect(page).toHaveURL(`/juego/${idOf(index)}`);
  }
  await page.keyboard.press('k');
  await expect(page).toHaveURL(`/juego/${idOf(39)}`);

  // El asa `::` con muchas filas: la segunda, arrastrada hasta la cuarta.
  await page.goto('/');
  await expect(rowOf(page, 1)).toBeInViewport();
  const handle = await rowOf(page, 1).locator('[data-drag-handle]').boundingBox();
  const target = await rowOf(page, 3).boundingBox();
  if (!handle || !target) throw new Error('Sin el asa o sin la fila de destino');
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, target.y + target.height - 4, { steps: 10 });
  await page.mouse.up();
  await expect(toast(page)).toContainText(`${titleOf(1)}: prioridad 4 de ${COUNT - 1}`);
  await expect(page.locator('.entry-row[style*="transform"]')).toHaveCount(0);
  const order = await section(page, 'want_to_play')
    .locator('.entry-row')
    .evaluateAll((list) => list.slice(0, 5).map((row) => (row as HTMLElement).dataset.entryId));
  expect(order).toEqual([idOf(0), idOf(2), idOf(3), idOf(1), idOf(4)]);
  await checks.expectClean();
});
