// Atajos de teclado de M3 (§9.4; CA3.4): un recorrido solo con teclado por el mapa de atajos, y
// el ajuste «Atajos de una tecla» (WCAG 2.1.4). Que ninguno use Ctrl+Alt ni teclas con AltGr lo
// comprueba `src/shortcuts/keymap.test.ts` sobre el mismo mapa que pinta la ayuda.
import { expect, type Page, test } from '@playwright/test';
import { capture, expectAccessible, setup, toast } from './helpers.ts';
import { expectStored, expectStoredSetting } from './storage.ts';

const CELESTE = 504230;

/** Tab hasta que el foco llega a `name` (solo teclado: sin clics). */
async function tabTo(page: Page, name: RegExp, max = 40) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const label = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el ? (el.getAttribute('aria-label') ?? el.textContent ?? '') : '';
    });
    if (name.test(label.trim())) return;
  }
  throw new Error(`Tab no llega a ${name}`);
}

const rowLink = (page: Page, name: string) =>
  page.getByRole('main').getByRole('link', { name, exact: true });

test('solo con teclado: el mapa de atajos de la §9.4 (CA3.4)', async ({
  page,
  context,
  isMobile,
}) => {
  // Con teclado físico. En el iPhone de Playwright, Tab no pasa por los enlaces (como Safari por
  // defecto); en el móvil, CA3.4 se cumple con los gestos y sus botones.
  test.skip(isMobile, 'recorrido con teclado físico, en escritorio');
  const checks = await setup(page);
  // «Ver en Steam» abre otra pestaña: que no llegue a la tienda de verdad.
  await context.route('https://store.steampowered.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Steam</title>' }),
  );
  await page.goto('/');
  await capture(page, 'hades ii', 'Hades II');
  await capture(page, 'celeste', 'Celeste');
  await capture(page, 'terraria', 'Terraria');
  await page.keyboard.press('Escape');

  // `G` y luego `C`, `A` y `L`: Catálogo, Ajustes y Mi lista.
  await page.keyboard.press('g');
  await page.keyboard.press('c');
  await expect(page).toHaveURL('/catalogo');
  await expect(page.getByRole('heading', { level: 1, name: 'Catálogo' })).toBeFocused();
  // `F`: el filtro de la pantalla.
  await page.keyboard.press('f');
  await expect(page.getByRole('textbox', { name: 'Filtrar el catálogo' })).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('g');
  await page.keyboard.press('a');
  await expect(page).toHaveURL('/ajustes');
  await page.keyboard.press('g');
  await page.keyboard.press('l');
  await expect(page).toHaveURL('/');

  // `J` y `K` entre filas.
  await tabTo(page, /^Prioridad 1: Hades II$/);
  await page.keyboard.press('j');
  await expect(rowLink(page, 'Prioridad 2: Celeste')).toBeFocused();
  await page.keyboard.press('k');
  await expect(rowLink(page, 'Prioridad 1: Hades II')).toBeFocused();

  // `Alt+↓` y `Alt+↑`: la prioridad, con el foco en la misma fila.
  await page.keyboard.press('Alt+ArrowDown');
  await expect(toast(page)).toContainText('Hades II: prioridad 2 de 3');
  await expect(rowLink(page, 'Prioridad 2: Hades II')).toBeFocused();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(toast(page)).toContainText('Hades II: prioridad 1 de 3');
  await expect(rowLink(page, 'Prioridad 1: Hades II')).toBeFocused();

  // `2`: Jugando. La fila cambia de sección y el foco pasa a la siguiente (§9.5).
  await page.keyboard.press('2');
  await expect(toast(page)).toContainText('Hades II pasa a Jugando');
  await expect(page.getByRole('heading', { name: 'Jugando ahora (1)' })).toBeVisible();
  await expect(rowLink(page, 'Prioridad 1: Celeste')).toBeFocused();

  // `C` alterna Comprado.
  await page.keyboard.press('c');
  await expect(toast(page)).toContainText('Marcado como Comprado: Celeste');
  await page.keyboard.press('Shift+C');
  await expect(toast(page)).toContainText('Ya no está marcado como Comprado: Celeste');

  // `V`: Ver en Steam, en otra pestaña.
  const steam = context.waitForEvent('page');
  await page.keyboard.press('v');
  await expect(await steam).toHaveURL(`https://store.steampowered.com/app/${CELESTE}/`);
  await page.bringToFront();
  await expect(rowLink(page, 'Prioridad 1: Celeste')).toBeFocused();

  // `Supr` quita (con Deshacer): el foco pasa a la siguiente, y `Ctrl+Z` la devuelve.
  await page.keyboard.press('Delete');
  await expect(toast(page)).toContainText('Quitado de tu lista: Celeste');
  await expect(rowLink(page, 'Prioridad 1: Terraria')).toBeFocused();
  await page.keyboard.press('Control+z');
  await expect(rowLink(page, 'Prioridad 1: Celeste')).toBeVisible();
  await expect(rowLink(page, 'Prioridad 2: Terraria')).toBeFocused();
  await page.keyboard.press('k');
  await expect(rowLink(page, 'Prioridad 1: Celeste')).toBeFocused();

  // `N`: la ficha, con el foco en la nota.
  await page.keyboard.press('n');
  await expect(page).toHaveURL(`/juego/steam:${CELESTE}`);
  const note = page.getByRole('textbox', { name: 'Nota' });
  await expect(note).toBeFocused();
  // Las teclas sueltas no actúan al escribir.
  await page.keyboard.type('jugar con mando 1');
  await expect(note).toHaveValue('jugar con mando 1');
  await page.keyboard.press('Escape');
  await expect(toast(page)).toContainText('Celeste');

  // `K` y `J` en la ficha: el juego de antes o de después en Mi lista, tal como se ve
  // (Pendientes: Jugando ahora va primero).
  await page.keyboard.press('k');
  await expect(page).toHaveURL('/juego/steam:1145350');
  await expect(page.getByRole('heading', { level: 1, name: 'Hades II' })).toBeVisible();
  await page.keyboard.press('j');
  await expect(page).toHaveURL(`/juego/steam:${CELESTE}`);
  await page.keyboard.press('j');
  await expect(page).toHaveURL('/juego/steam:105600');

  // `4` (Completado) y `?`: la ayuda, que Esc cierra sin cerrar la ficha.
  await page.keyboard.press('4');
  await expect(toast(page)).toContainText('Terraria pasa a Completado');
  await expect(page.getByRole('button', { name: 'Completado', pressed: true })).toBeVisible();
  await page.keyboard.press('Shift+?');
  const help = page.getByRole('dialog', { name: 'Atajos de teclado' });
  await expect(help).toBeVisible();
  await expect(help.getByRole('table', { name: 'En las filas y en la ficha' })).toBeVisible();
  await expect(help.getByRole('button', { name: /^Cerrar/ })).toBeFocused();
  await expectAccessible(page, 'Ayuda de atajos');
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();
  await expect(page).toHaveURL('/juego/steam:105600');
  await checks.expectClean();
});

test('con «Atajos de una tecla» apagado, las teclas sueltas no hacen nada y Alt+↑/↓ sí', async ({
  page,
}) => {
  const checks = await setup(page);
  await page.goto('/');
  await capture(page, 'hades ii', 'Hades II');
  await capture(page, 'celeste', 'Celeste');
  await page.keyboard.press('Escape');
  // Las dos guardadas antes de recargar (en WebKit, IndexedDB tarda ≈260 ms por alta).
  await expectStored(page, 'steam:504230', { status: 'want_to_play' });
  await page.goto('/ajustes/teclado');
  const toggle = page.getByRole('checkbox', { name: 'Atajos de una tecla' });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expectStoredSetting(page, 'singleKeyShortcuts', false);

  await page.goto('/');
  const hades = rowLink(page, 'Prioridad 1: Hades II');
  await hades.focus();
  for (const key of ['j', '2', 'c', 'Delete', 'Shift+?', 'g']) await page.keyboard.press(key);
  await page.keyboard.press('c');
  await expect(page).toHaveURL('/');
  await expect(hades).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(toast(page)).not.toContainText('Hades II pasa');
  await expect(toast(page)).not.toContainText('Quitado');
  // `Alt+↓` lleva modificador: sigue funcionando.
  await page.keyboard.press('Alt+ArrowDown');
  await expect(toast(page)).toContainText('Hades II: prioridad 2 de 2');

  // La ayuda sigue a mano (menú «Más opciones») y dice que están apagados.
  await page.getByRole('button', { name: 'Más opciones' }).click();
  await page.getByRole('menuitem', { name: 'Atajos de teclado' }).click();
  const help = page.getByRole('dialog', { name: 'Atajos de teclado' });
  await expect(help).toContainText('Los atajos de una tecla están desactivados');
  await help.getByRole('button', { name: /^Cerrar/ }).click();
  await expect(help).toBeHidden();
  await expect(page.getByRole('button', { name: 'Más opciones' })).toBeFocused();
  await checks.expectClean();
});
