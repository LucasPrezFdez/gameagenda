// Mi lista en cuadrícula de portadas (21-11-2026, DECISIONES §10.53): el conmutador de la cabecera,
// que se recuerda aparte del Catálogo; las tarjetas por secciones, con la prioridad y las marcas;
// las flechas en dos ejes, los atajos y los menús de la tarjeta; y, con cientos de juegos, solo las
// filas de tarjetas cercanas a la pantalla (SectionRows.tsx), con las columnas en su sitio.
//
// Con selectores CSS donde hay muchas tarjetas: buscar por rol recorre todo el árbol de accesibilidad.
import { addEntry, type Entry } from '@gameagenda/core/entries';
import { formatHlc } from '@gameagenda/core/sync';
import { expect, type Page, test } from '@playwright/test';
import { v7 as uuidv7 } from 'uuid';
import { expectAccessible, setup, toast, waitForSearch } from './helpers.ts';
import { expectStoredSetting, putEntries, storedKeys, storedMeta } from './storage.ts';

const idOf = (index: number) => `steam:${4_100_000 + index}`;
const titleOf = (index: number) => `Juego de prueba ${String(index).padStart(3, '0')}`;

/** `playing` juegos en Jugando y `wanted` en Quiero jugar, en orden; uno de cada tres, comprado. */
function seedEntries(playing: number, wanted: number): Entry[] {
  const start = Date.now() - 3_600_000;
  const entries: Entry[] = [];
  let lastRank: string | null = null;
  for (let index = 0; index < playing + wanted; index += 1) {
    const result = addEntry(
      undefined,
      {
        id: idOf(index),
        title: titleOf(index),
        status: index < playing ? 'playing' : 'want_to_play',
        flags: { owned: index % 3 === 0 },
      },
      {
        hlc: formatHlc({ ms: start + index, counter: 0, node: 'e2e00002' }),
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
async function seedGames(page: Page, playing: number, wanted: number) {
  await page.goto('/');
  await waitForSearch(page, 'full');
  await expect.poll(() => storedMeta(page, 'searchIndexKey'), { timeout: 15_000 }).not.toBeNull();
  await putEntries(page, seedEntries(playing, wanted));
  await page.reload();
}

const section = (page: Page, id: string) => page.locator(`.list-section[data-section="${id}"]`);
const cards = (page: Page) => page.locator('.screen-slot--list .entry-card');
const cardOf = (page: Page, index: number) =>
  page.locator(`.screen-slot--list .entry-card[data-entry-id="${idOf(index)}"]`);
const titleLink = (page: Page, index: number) => cardOf(page, index).locator('[data-row-title]');

/** Cuántas columnas tiene la cuadrícula de la sección (tarjetas de su primera fila). */
function columnsOf(page: Page, id: string) {
  return section(page, id)
    .locator('.entry-card')
    .evaluateAll((items) => {
      const top = items[0]?.getBoundingClientRect().top;
      return items.filter((item) => item.getBoundingClientRect().top === top).length;
    });
}

test('Mi lista en cuadrícula: tarjetas, teclado, menús, y se recuerda (§10.53)', async ({
  page,
  isMobile,
}) => {
  const checks = await setup(page);
  await seedGames(page, 2, 10);
  await expect(page.getByRole('heading', { name: 'Quiero jugar (10)' })).toBeVisible();
  await expect(page.locator('.screen-slot--list .entry-row').first()).toBeVisible();

  // De lista a cuadrícula: las mismas secciones, en tarjetas y en varias columnas.
  await page.getByRole('button', { name: 'Cuadrícula', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cuadrícula', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(cards(page)).toHaveCount(12);
  await expect(page.locator('.screen-slot--list .entry-row')).toHaveCount(0);
  await expectStoredSetting(page, 'listLayout', 'grid');
  const columns = await columnsOf(page, 'want_to_play');
  expect(columns).toBeGreaterThanOrEqual(2);
  // Todas las tarjetas miden lo mismo, con o sin la marca de Comprado.
  const heights = await cards(page).evaluateAll((items) =>
    items.map((item) => Math.round(item.getBoundingClientRect().height)),
  );
  expect(new Set(heights).size).toBe(1);
  // La prioridad, sobre la portada; la marca, en el nombre accesible no (va aparte).
  await expect(cardOf(page, 2).locator('.entry-card__rank')).toHaveText('1');
  await expect(titleLink(page, 2)).toHaveAccessibleName(`Prioridad 1: ${titleOf(2)}`);
  await expect(cardOf(page, 3).locator('.entry-card__flag')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expectAccessible(page, 'Mi lista en cuadrícula');

  // El estado, desde el menú de la tarjeta: pasa a Jugando ahora.
  await page
    .getByRole('button', { name: `Quiero jugar: cambiar estado de ${titleOf(11)}` })
    .click();
  await page.getByRole('menuitemradio', { name: 'Jugando' }).click();
  await expect(toast(page)).toContainText(`${titleOf(11)} pasa a Jugando`);
  await expect(page.getByRole('heading', { name: 'Jugando ahora (3)' })).toBeVisible();
  await expect(section(page, 'playing').locator(`[data-entry-id="${idOf(11)}"]`)).toHaveCount(1);

  // La prioridad, desde «…».
  await page.getByRole('button', { name: `Más acciones: ${titleOf(2)}` }).click();
  await page.getByRole('menuitem', { name: 'Bajar' }).click();
  await expect(toast(page)).toContainText(`${titleOf(2)}: prioridad 2 de 9`);
  await expect(cardOf(page, 3).locator('.entry-card__rank')).toHaveText('1');

  if (!isMobile) {
    // Teclado: → a la de al lado, ↓ a la misma columna de la fila siguiente y ↑ de vuelta; desde
    // la primera fila de Quiero jugar, ↑ sube a la última de Jugando ahora.
    const order = await section(page, 'want_to_play')
      .locator('.entry-card')
      .evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset.entryId));
    const at = (position: number) =>
      section(page, 'want_to_play').locator(
        `[data-entry-id="${order[position]}"] [data-row-title]`,
      );
    await at(0).focus();
    await page.keyboard.press('ArrowRight');
    await expect(at(1)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(at(Math.min(order.length - 1, 1 + columns))).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(at(1)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    // Jugando ahora tiene 3 tarjetas en una fila: la de la columna 1.
    await expect(section(page, 'playing').locator('[data-row-title]').nth(1)).toBeFocused();

    // Los atajos, sobre la tarjeta: `2` la pasa a Jugando y el foco sigue en la lista.
    const first = Number(order[0]?.slice('steam:'.length)) - 4_100_000;
    await at(0).focus();
    await page.keyboard.press('2');
    await expect(toast(page)).toContainText(`${titleOf(first)} pasa a Jugando`);
    await expect(page.getByRole('heading', { name: 'Jugando ahora (4)' })).toBeVisible();
    await expect(page.locator('.screen-slot--list [data-row-title]:focus')).toHaveCount(1);
  }

  // Se recuerda al volver; y se vuelve a la lista con el otro botón.
  await page.reload();
  await expect(cards(page).first()).toBeVisible();
  await page.getByRole('button', { name: 'Lista', exact: true }).click();
  await expect(page.locator('.screen-slot--list .entry-row').first()).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
  // La lista es lo de por defecto: el ajuste deja de estar guardado.
  await expect.poll(() => storedKeys(page, 'settings')).not.toContain('listLayout');
  await checks.expectClean();
});

test.describe('con cientos de juegos', () => {
  test.setTimeout(120_000);

  test('la cuadrícula pinta solo las filas de tarjetas cercanas, con las columnas en su sitio', async ({
    page,
    isMobile,
  }) => {
    const COUNT = 600;
    const checks = await setup(page);
    await seedGames(page, 0, COUNT);
    await expect(page.getByRole('heading', { name: `Quiero jugar (${COUNT})` })).toBeVisible();
    await page.getByRole('button', { name: 'Cuadrícula', exact: true }).click();
    await expect(cardOf(page, 0)).toBeVisible();
    await expect(cardOf(page, 0)).toHaveAttribute('aria-setsize', String(COUNT));
    expect(await cards(page).count()).toBeLessThan(200);

    // El alto de todas las filas de tarjetas: las pintadas y los huecos suman lo mismo.
    const columns = await columnsOf(page, 'want_to_play');
    const { height, total } = await section(page, 'want_to_play')
      .locator('ol')
      .evaluate((list) => {
        const children = [...list.children] as HTMLElement[];
        const card = children.find((child) => child.classList.contains('entry-card'));
        const rows = new Map<number, number>();
        for (const child of children) {
          const rect = child.getBoundingClientRect();
          rows.set(
            Math.round(rect.top),
            Math.max(rows.get(Math.round(rect.top)) ?? 0, rect.height),
          );
        }
        const sum = [...rows.values()].reduce((a, b) => a + b, 0);
        return { height: card?.getBoundingClientRect().height ?? 0, total: sum };
      });
    const rowCount = Math.ceil(COUNT / columns);
    expect(Math.abs(total - rowCount * height)).toBeLessThan(rowCount);

    // Lejos, las tarjetas siguen en su columna: la 300 cae en la columna de 300 % columnas.
    await section(page, 'want_to_play')
      .locator('ol')
      .evaluate(
        (list, { row, size }) =>
          window.scrollTo(0, window.scrollY + list.getBoundingClientRect().top + row * size),
        { row: Math.floor(300 / columns), size: height },
      );
    await expect(cardOf(page, 300)).toBeInViewport();
    const firstLeft = await cardOf(page, 0).evaluate((card) => card.getBoundingClientRect().left);
    const left = await cardOf(page, 300).evaluate((card) => card.getBoundingClientRect().left);
    const step = await cardOf(page, 1).evaluate(
      (card, first) => card.getBoundingClientRect().left - first,
      firstLeft,
    );
    expect(Math.round((left - firstLeft) / step)).toBe(300 % columns);
    expect(await cards(page).count()).toBeLessThan(200);

    if (!isMobile) {
      // Fin llega a la última, que no estaba pintada, con el foco y a la vista.
      await titleLink(page, 300).focus();
      await page.keyboard.press('End');
      await expect(titleLink(page, COUNT - 1)).toBeFocused();
      await expect(cardOf(page, COUNT - 1)).toBeInViewport();
      await page.keyboard.press('Home');
      await expect(titleLink(page, 0)).toBeFocused();
      await expect(cardOf(page, 0)).toBeInViewport();
    }
    await checks.expectClean();
  });
});
