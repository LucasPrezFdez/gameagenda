import { expect, type Page, test } from '@playwright/test';
import { setup, toast, waitForSearch } from './helpers.ts';

interface Manifest {
  readonly counts: { readonly core: number };
  readonly files: { readonly core: { readonly path: string } };
}

/** Recuentos del catálogo servido, leídos del *manifest* y del núcleo (CA1.2). */
async function catalogFacts(page: Page) {
  const manifest = (await (
    await page.request.get('/catalog-dev/manifest.json')
  ).json()) as Manifest;
  const core = await (await page.request.get(`/catalog-dev/${manifest.files.core.path}`)).text();
  const rows = core
    .split('\n')
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const [appid, name, nameEs, flags] = line.split('\t');
      return { appid: Number(appid), name: nameEs || name || '', flags: Number(flags || 0) };
    });
  const has = (bit: number) => rows.filter((r) => (r.flags & bit) !== 0);
  return {
    total: manifest.counts.core,
    adults: has(4).length,
    soon: rows.filter((r) => (r.flags & 1) !== 0 && (r.flags & 16) === 0).length,
    last: rows.at(-1)?.name ?? '',
  };
}

/** «294 juegos», «196 665 juegos» (espacio fino desde cinco cifras) o «1 juego» (ver §9.9). */
function count(n: number): RegExp {
  if (n === 1) return /^1 juego$/;
  const digits = String(n);
  const grouped = digits.length < 5 ? digits : digits.replace(/\B(?=(\d{3})+$)/g, '\\s');
  return new RegExp(`^${grouped} juegos$`);
}
const titles = (page: Page) => page.getByRole('list', { name: /^Juegos del catálogo/ });

test('el contador coincide con el manifest: +18 oculto por defecto y visible en Ajustes', async ({
  page,
}) => {
  const checks = await setup(page);
  const facts = await catalogFacts(page);
  await page.goto('/catalogo');
  await expect(page.getByText(count(facts.total - facts.adults))).toBeVisible();
  await expect(page.getByText('Sin DLC · +18 oculto')).toBeVisible();

  await page.getByRole('textbox', { name: 'Filtrar el catálogo' }).fill('celeste');
  await expect(titles(page).getByRole('link')).toHaveText(['Celeste', 'Celeste Blue Wizard Luna']);

  await page.goto('/ajustes/contenido');
  await page.getByRole('checkbox', { name: /Mostrar juegos para adultos/ }).check();
  await page
    .getByRole('navigation', { name: 'Principal' })
    .getByRole('link', { name: 'Catálogo' })
    .click();
  await expect(page.getByText(count(facts.total))).toBeVisible();
  await expect(page.getByText('Sin DLC · +18 visible')).toBeVisible();
  await page.getByRole('textbox', { name: 'Filtrar el catálogo' }).fill('celeste');
  await expect(titles(page).getByText('+18')).toHaveCount(1);
  await checks.expectClean();
});

test('se llega a la última fila con Fin y con la barra de desplazamiento (CA1.2)', async ({
  page,
}) => {
  const checks = await setup(page);
  const facts = await catalogFacts(page);
  await page.goto('/catalogo');
  await waitForSearch(page, 'full');
  const first = titles(page).getByRole('link').first();
  await expect(first).toHaveText('Counter-Strike 2');

  await first.focus();
  await page.keyboard.press('End');
  const last = titles(page).getByRole('link', { name: facts.last, exact: true });
  await expect(last).toBeFocused();
  await expect(last).toBeInViewport();
  const lastRow = titles(page)
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: facts.last, exact: true }) });
  await expect(lastRow).toHaveAttribute('aria-posinset', String(facts.total - facts.adults));
  await expect(lastRow).toHaveAttribute('aria-setsize', String(facts.total - facts.adults));
  // Los retirados van al final, con su insignia.
  await expect(lastRow).toContainText('Retirado');
  await page.keyboard.press('Home');
  await expect(first).toBeFocused();

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(last).toBeInViewport();
  await page.keyboard.press('ArrowDown');
  await expect(titles(page).getByRole('link').nth(1)).toBeFocused();
  await checks.expectClean();
});

test('los filtros sencillos van en la URL y `+` apunta desde la fila', async ({ page }) => {
  const checks = await setup(page);
  const facts = await catalogFacts(page);
  await page.goto('/catalogo');
  await page.getByRole('button', { name: 'Próximamente' }).click();
  await expect(page).toHaveURL('/catalogo?filtro=proximamente');
  await expect(page.getByText(count(facts.soon))).toBeVisible();
  await expect(page.getByRole('button', { name: 'Próximamente' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.getByRole('button', { name: 'Gratis' }).click();
  await page.getByRole('textbox', { name: 'Filtrar el catálogo' }).fill('dota');
  await expect(page).toHaveURL('/catalogo?q=dota&filtro=gratis');
  await page.getByRole('textbox', { name: 'Filtrar el catálogo' }).press('ArrowDown');
  await expect(titles(page).getByRole('link', { name: 'Dota 2' })).toBeFocused();
  await page.keyboard.press('+');
  await expect(toast(page)).toContainText('Apuntado en Quiero jugar: Dota 2');

  await page.goto('/catalogo?filtro=gratis&q=dota');
  await expect(page.getByRole('button', { name: 'Gratis' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText(count(1))).toBeVisible();
  await page.getByRole('button', { name: 'Populares' }).click();
  await expect(page).toHaveURL('/catalogo?q=dota');
  await checks.expectClean();
});
