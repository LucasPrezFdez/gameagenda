// WCAG 2.2 AA (M3; §9.7 y CA3.5), lo que `a11y.spec.ts` no recorre: axe en los estados que se abren
// encima (la ayuda de atajos, «Apuntar como…», el alta a mano, Próximos y Ajustes › Rendimiento),
// el *reflow* a 320 px en todas las pantallas (1.4.10, el zoom al 400 %), el foco que no tapan las
// barras fijas (2.4.11), el anillo de foco (2.4.7), el movimiento reducido y, con la regla
// experimental de axe, que el nombre accesible empiece por el texto visible (2.5.3). El contraste
// de los colores, en los dos temas, lo comprueba `scripts/tokens-contrast.test.ts` sobre los tokens.
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { capture, expectAccessible, openPalette, paletteInput, setup } from './helpers.ts';

/** Píxeles que la página se sale por la derecha (0 si no hay desplazamiento horizontal). */
function overflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

async function games(page: Page) {
  await capture(page, 'hades ii', 'Hades II');
  await capture(page, 'celeste', 'Celeste');
  await capture(page, 'terraria', 'Terraria');
  await capture(page, 'hollow knight', 'Hollow Knight');
  await capture(page, 'elden ring', 'ELDEN RING');
  await capture(page, 'stardew', 'Stardew Valley');
}

test('axe en lo que se abre encima: ayuda, «Apuntar como…», alta a mano, Próximos y Rendimiento', async ({
  page,
  isMobile,
}) => {
  test.setTimeout(60_000);
  const checks = await setup(page);
  await page.goto('/');
  await capture(page, 'hades ii', 'Hades II');

  await openPalette(page);
  await page.keyboard.type('celeste');
  await expect(page.getByRole('option').first()).toHaveAccessibleName(/^Celeste/);
  await page.keyboard.press('Alt+Enter');
  await expect(page.getByText('Apuntar «Celeste» como…')).toBeVisible();
  await expectAccessible(page, 'Apuntar como…');
  await page.keyboard.press('Escape');

  await paletteInput(page).fill('mario kart');
  await expect(page.getByRole('option', { name: 'Apuntar «mario kart» a mano' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Título' })).toBeVisible();
  await expectAccessible(page, 'Alta a mano');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  if (!isMobile) {
    await page.locator('body').click({ position: { x: 5, y: 300 } });
    await page.keyboard.press('Shift+Slash');
    const help = page.getByRole('dialog', { name: 'Atajos de teclado' });
    await expect(help).toBeVisible();
    await expectAccessible(page, 'Ayuda de atajos');
    await page.keyboard.press('Escape');
  }

  await page.goto('/?vista=proximos');
  await expect(page.getByRole('button', { name: /^Próximos/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expectAccessible(page, 'Próximos');

  await page.goto('/ajustes/rendimiento');
  await expect(page.getByRole('table', { name: 'Medidas de rendimiento' })).toBeVisible();
  await expectAccessible(page, 'Ajustes › Rendimiento');
  await checks.expectClean();
});

test('a 320 px (el zoom al 400 %), ninguna pantalla se desplaza en horizontal (1.4.10)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const checks = await setup(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  await games(page);
  // Un título largo, apuntado a mano.
  await openPalette(page);
  await page.keyboard.insertText('Un juego con un título larguísimo que no cabe en ninguna fila');
  await expect(page.getByRole('option', { name: /a mano$/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Título' })).not.toHaveValue('');
  await page.keyboard.press('Enter');
  const screens: [string, string][] = [
    ['Mi lista', '/'],
    ['Próximos', '/?vista=proximos'],
    ['Todos, por nombre', '/?vista=todos&orden=nombre'],
    ['Catálogo', '/catalogo'],
    ['Ficha', '/juego/steam:1145350'],
    ['Ficha no apuntada', '/juego/steam:367520'],
    ['Ajustes', '/ajustes'],
    ['Teclado y gestos', '/ajustes/teclado'],
    ['Datos', '/ajustes/datos'],
    ['Privacidad', '/ajustes/privacidad'],
    ['Rendimiento', '/ajustes/rendimiento'],
    ['Acerca de', '/ajustes/acerca-de'],
    ['404', '/no-existe'],
  ];
  for (const [name, path] of screens) {
    await page.goto(path);
    await expect(page.getByRole('main')).toBeVisible();
    await page.waitForTimeout(150);
    expect(await overflow(page), name).toBeLessThanOrEqual(0);
  }
  // La paleta abierta (en el móvil, la hoja a pantalla completa).
  await page.goto('/');
  await paletteInput(page).focus();
  await page.keyboard.type('final fantasy');
  await expect(page.getByRole('option').first()).toBeVisible();
  expect(await overflow(page), 'paleta abierta').toBeLessThanOrEqual(0);
  await checks.expectClean();
});

test('el foco no queda tapado por la cabecera ni por las barras de abajo (2.4.11)', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'con teclado: en el iPhone de Playwright, Tab no pasa por los enlaces');
  test.setTimeout(60_000);
  const checks = await setup(page);
  // Estrecha (barras de abajo en el móvil) y baja, para que la lista no quepa.
  await page.setViewportSize({ width: 390, height: 480 });
  await page.goto('/');
  await games(page);
  await page.keyboard.press('Escape');
  const titles = page.getByRole('main').locator('[data-row-title]');
  await titles.first().focus();
  const count = await titles.count();
  expect(count).toBeGreaterThanOrEqual(6);
  for (let i = 0; i < count; i++) {
    if (i > 0) await page.keyboard.press('ArrowDown');
    const hidden = await page.evaluate(() => {
      const focused = document.activeElement as HTMLElement | null;
      if (!focused) return 'sin foco';
      const box = focused.getBoundingClientRect();
      const header = document.querySelector('.app-header')?.getBoundingClientRect();
      const top = header && header.top <= 0 ? header.bottom : 0;
      let bottom = window.innerHeight;
      for (const bar of document.querySelectorAll<HTMLElement>(
        '.app-nav, .app-header > .palette',
      )) {
        const rect = bar.getBoundingClientRect();
        if (rect.top > window.innerHeight / 2) bottom = Math.min(bottom, rect.top);
      }
      return box.top < top || box.bottom > bottom
        ? `${focused.textContent}: ${box.top}–${box.bottom} fuera de ${top}–${bottom}`
        : null;
    });
    expect(hidden, `fila ${i + 1}`).toBeNull();
  }
  await checks.expectClean();
});

test('anillo de foco de 2 px separado 2 px (2.4.7) y sin animaciones con movimiento reducido', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'con teclado');
  const checks = await setup(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/ajustes');
  await expect(page.getByRole('heading', { level: 1, name: 'Ajustes' })).toBeVisible();
  // El primero es «Saltar al contenido»; el segundo, la marca: los dos con el anillo.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const ring = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const style = getComputedStyle(el);
    return {
      style: style.outlineStyle,
      width: style.outlineWidth,
      offset: style.outlineOffset,
      motion: getComputedStyle(document.documentElement).getPropertyValue('--motion').trim(),
    };
  });
  expect(ring).toMatchObject({ style: 'solid', width: '2px', offset: '2px' });
  expect(['0ms', '0s']).toContain(ring.motion);
  await checks.expectClean();
});

test('el nombre accesible empieza por el texto visible (2.5.3, regla experimental de axe)', async ({
  page,
}) => {
  const checks = await setup(page);
  await page.goto('/');
  await capture(page, 'hades ii', 'Hades II');
  await capture(page, 'celeste', 'Celeste');
  const results = await new AxeBuilder({ page })
    .options({ rules: { 'label-content-name-mismatch': { enabled: true } } })
    .withRules(['label-content-name-mismatch'])
    .analyze();
  expect(
    results.violations.flatMap((v) =>
      v.nodes.map((n) => `${n.target.join(' ')}: ${n.failureSummary}`),
    ),
  ).toEqual([]);
  await checks.expectClean();
});
