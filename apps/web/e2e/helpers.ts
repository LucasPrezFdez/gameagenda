import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export interface FakeSearchOptions {
  readonly latencyMs?: number;
  readonly boot?: 'progressive' | 'full' | 'scan' | 'none' | 'error';
}

declare global {
  var __GA_FAKE_SEARCH__: FakeSearchOptions | undefined;
  var __cspViolations: string[];
}

/** Cliente falso a medida y registro de violaciones de CSP y errores de la página. */
export async function setup(page: Page, fake: FakeSearchOptions = { boot: 'full' }) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${message.text()} (${message.location().url})`);
  });
  await page.addInitScript((options) => {
    globalThis.__GA_FAKE_SEARCH__ = options;
    globalThis.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      globalThis.__cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  }, fake);
  return {
    /** Al final de cada prueba: ni errores ni violaciones de CSP (ver §12.3). */
    async expectClean() {
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => globalThis.__cspViolations)).toEqual([]);
    },
  };
}

export function paletteInput(page: Page) {
  return page.getByRole('combobox', { name: 'Apunta un juego' });
}

export function toast(page: Page) {
  return page.getByRole('status', { name: 'Avisos' });
}

/**
 * `Ctrl+K` cuando la app ya está montada: React 19 confirma el primer render de forma asíncrona y
 * en WebKit puede llegar después de `load` (antes, tampoco hay nada pintado que usar).
 */
export async function openPalette(page: Page) {
  await expect(paletteInput(page)).toBeAttached();
  await page.keyboard.press('Control+k');
  await expect(paletteInput(page)).toBeFocused();
}

/** Abre la paleta con `Ctrl+K`, escribe y espera a que la primera fila sea `first`. */
export async function search(page: Page, text: string, first: string | RegExp) {
  await openPalette(page);
  await page.keyboard.type(text);
  await expect(page.getByRole('option').first()).toHaveAccessibleName(
    typeof first === 'string' ? new RegExp(`^${escapeRegExp(first)}`) : first,
  );
}

export async function capture(page: Page, text: string, title: string) {
  await search(page, text, title);
  await page.keyboard.press('Enter');
  await expect(toast(page)).toContainText(`Apuntado en Quiero jugar: ${title}`);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** axe-core sin violaciones graves ni críticas (RNF-09, CA1.10). */
export async function expectAccessible(page: Page, label: string) {
  // Con una animación a medias (p. ej., la entrada del aviso), el contraste medido sería falso.
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
  );
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${label} · ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  expect(blocking).toEqual([]);
}

export async function measures(page: Page, name: string): Promise<number[]> {
  return page.evaluate(
    (measure) => performance.getEntriesByName(measure, 'measure').map((entry) => entry.duration),
    name,
  );
}
