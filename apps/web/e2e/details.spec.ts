// Ficha completa, Próximos y orden por lanzamiento (M2; CA2.8), con los *shards* de detalles
// servidos en local. Hoy, para las pruebas: lunes, 2 de noviembre de 2026, en Madrid.
import { expect, type Page, test } from '@playwright/test';
import { day, serveCovers, serveDetails, shardOf } from './details.ts';
import { capture, expectAccessible, search, setup } from './helpers.ts';

test.use({ timezoneId: 'Europe/Madrid' });

const NOW = new Date('2026-11-02T12:00:00+01:00');

const HADES_II = 1145350;
const RE_REQUIEM = 3764200;
const WHO_FRAMED = 5507790;
const CAT_GUARDIANS = 4711080;
const FF7_REVELATION = 4354570;
const POTIONS = 4018990;
const MINA = 1875580;

const GAMES = {
  [HADES_II]: {
    release: [day(2025, 9, 25), 'day'],
    reviews: [9, 123456, 97],
    platforms: 3,
    deck: 3,
  },
  [RE_REQUIEM]: { release: [day(2026, 10, 28), 'day'], reviews: [0, 4, 75], platforms: 1 },
  [WHO_FRAMED]: { release: [day(2026, 11, 5), 'day'], reviews: [0, 0, 0], deck: 2 },
  [CAT_GUARDIANS]: { release: [day(2026, 12, 10), 'day'], platforms: 7, deck: 1 },
  [FF7_REVELATION]: { release: [day(2027, 8, 1), 'quarter'] },
  [POTIONS]: { release: [null, 'tba'] },
  [MINA]: { release: [day(2026, 3, 10), 'day'] },
} as const;

const SCRIPT: ReadonlyArray<readonly [string, string]> = [
  ['hades ii', 'Hades II'],
  ['resident evil requiem', 'Resident Evil Requiem'],
  ['who framed', 'Who Framed The Cat?'],
  ['cat guardians', 'Cat Guardians(캣 가디언즈)'],
  ['revelation', 'FINAL FANTASY VII REVELATION'],
  ['potions of veldenkeep', 'Potions of Veldenkeep'],
  ['mina the hollower', 'Mina the Hollower'],
];

async function captureAll(page: Page) {
  for (const [text, title] of SCRIPT) await capture(page, text, title);
}

/**
 * Abre la ficha con `Mayús+Intro` desde la paleta, sin recargar: en WebKit, una navegación con
 * descargas o Cache Storage a medias deja errores en la consola que no son de la app.
 */
async function openSheet(page: Page, text: string, title: string) {
  await search(page, text, title);
  await page.keyboard.press('Shift+Enter');
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
}

function section(page: Page, name: string | RegExp) {
  return page.getByRole('main').getByRole('region', { name });
}

async function titlesIn(page: Page, name: string | RegExp): Promise<string[]> {
  const links = section(page, name).getByRole('link');
  return (await links.allTextContents()).map((text) => text.replace(/^Prioridad \d+: /, ''));
}

test('la ficha completa: portada, lanzamiento o «Por confirmar», reseñas, plataformas y Steam Deck', async ({
  page,
  context,
}) => {
  const checks = await setup(page);
  await page.clock.setFixedTime(NOW);
  await serveDetails(context, GAMES);
  await serveCovers(context);

  await page.goto(`/juego/steam:${HADES_II}`);
  const sheet = page.locator('.sheet');
  await expect(page.getByRole('heading', { level: 1, name: 'Hades II' })).toBeVisible();
  await expect(sheet.getByText('25 sept 2025', { exact: true })).toBeVisible();
  const facts = sheet.getByRole('list', { name: 'Datos de Steam' });
  await expect(facts).toContainText('Steam Deck: Verificado');
  await expect(facts).toContainText('Windows · macOS');
  await expect(facts).toContainText(
    /Reseñas: Extremadamente positivas \(97\s%\sde 123\s456 reseñas\)/,
  );
  // La portada, tras el aviso de primera capa.
  await expect(page.getByRole('region', { name: 'Aviso sobre las portadas' })).toBeVisible();
  await expect(sheet.locator('.cover--sheet')).toHaveClass(/has-image/);
  await expect(sheet.getByRole('link', { name: 'Ver en Steam' })).toHaveAttribute(
    'href',
    `https://store.steampowered.com/app/${HADES_II}/`,
  );
  await expectAccessible(page, 'Ficha completa');

  // Con cuenta atrás, «Por confirmar» y sin reseñas (cada ficha, desde la paleta).
  await openSheet(page, 'cat guardians', 'Cat Guardians(캣 가디언즈)');
  await expect(sheet.getByText('Sale el jue, 10 dic 2026 · dentro de 38 días')).toBeVisible();
  await expect(facts).toContainText('Steam Deck: No compatible');
  await expect(facts).toContainText('Windows · macOS · Linux');
  await openSheet(page, 'potions of veldenkeep', 'Potions of Veldenkeep');
  await expect(sheet.getByText('Por confirmar', { exact: true })).toBeVisible();
  await openSheet(page, 'who framed', 'Who Framed The Cat?');
  await expect(facts).toContainText('Reseñas: Sin reseñas');
  await expect(facts).toContainText('Steam Deck: Jugable');
  await openSheet(page, 'resident evil requiem', 'Resident Evil Requiem');
  await expect(sheet.getByText('Salió el 28 oct 2026 · hace 5 días')).toBeVisible();
  await expect(facts).toContainText('Reseñas: 4 reseñas');

  // Sin detalles en su *shard*: la ficha básica, con el año del núcleo.
  await openSheet(page, 'celeste', 'Celeste');
  await expect(sheet.getByText('2018', { exact: true })).toBeVisible();
  await expect(facts).toHaveCount(0);
  await checks.expectClean();
});

test('sin detalles (*kill switch* `details`): la ficha básica y ningún *shard*', async ({
  page,
  context,
}) => {
  const checks = await setup(page);
  const served = await serveDetails(context, GAMES, { covers: false, details: true });
  await page.goto(`/juego/steam:${HADES_II}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Hades II' })).toBeVisible();
  await expect(page.locator('.sheet').getByText('2025', { exact: true })).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.getByRole('list', { name: 'Datos de Steam' })).toHaveCount(0);
  expect(served.requests).toEqual([]);
  await checks.expectClean();
});

test('Próximos agrupa por lanzamiento y pide solo los *shards* que hacen falta (CA2.8)', async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  const checks = await setup(page);
  await page.clock.setFixedTime(NOW);
  // Sin portadas: las filas no piden detalles, así que solo se ve lo que pide Próximos.
  const served = await serveDetails(context, GAMES, { covers: true, details: false });
  await page.goto('/');
  await captureAll(page);

  const views = page.getByRole('group', { name: 'Vistas' });
  // El contador sale cuando se saben las fechas.
  await expect(views.getByRole('button', { name: 'Próximos 5' })).toBeVisible();
  await views.getByRole('button', { name: /^Próximos/ }).click();
  await expect(page).toHaveURL('/?vista=proximos');

  await expect(section(page, 'Ya disponibles (1)')).toBeVisible();
  expect(await titlesIn(page, 'Ya disponibles (1)')).toEqual(['Resident Evil Requiem']);
  await expect(section(page, 'Ya disponibles (1)')).toContainText(
    'Salió el 28 oct 2026 · hace 5 días',
  );
  expect(await titlesIn(page, 'Esta semana (1)')).toEqual(['Who Framed The Cat?']);
  await expect(section(page, 'Esta semana (1)')).toContainText(
    'Sale el jue, 5 nov 2026 · dentro de 3 días',
  );
  expect(await titlesIn(page, 'Diciembre de 2026 (1)')).toEqual(['Cat Guardians(캣 가디언즈)']);
  expect(await titlesIn(page, 'Más adelante (1)')).toEqual(['FINAL FANTASY VII REVELATION']);
  await expect(section(page, 'Más adelante (1)')).toContainText('Tercer trimestre de 2027');
  expect(await titlesIn(page, 'Por confirmar (1)')).toEqual(['Potions of Veldenkeep']);
  // Hades II salió hace un año y Mina the Hollower, en marzo: no van en Próximos.
  await expect(page.getByRole('main').getByRole('link', { name: /Hades II$/ })).toHaveCount(0);
  await expect(
    page.getByRole('main').getByRole('link', { name: /Mina the Hollower$/ }),
  ).toHaveCount(0);
  // Hades II es de 2025 según el núcleo: su *shard* ni se pide.
  expect(served.requests).not.toContain(served.shardPath(HADES_II));
  expect(new Set(served.requests).size).toBe(served.requests.length);
  expect(shardOf(HADES_II)).not.toBe(shardOf(RE_REQUIEM));
  await expectAccessible(page, 'Próximos');

  // Orden por lanzamiento en Todos: de lo más antiguo a lo más nuevo; por confirmar, al final.
  await views.getByRole('button', { name: /^Todos/ }).click();
  await page.getByRole('button', { name: 'Orden: Prioridad' }).click();
  await page.getByRole('menuitemradio', { name: 'Lanzamiento' }).click();
  await expect(page).toHaveURL('/?vista=todos&orden=lanzamiento');
  await expect(section(page, 'Juegos (7)')).toBeVisible();
  expect(await titlesIn(page, 'Juegos (7)')).toEqual([
    'Hades II',
    'Mina the Hollower',
    'Resident Evil Requiem',
    'Who Framed The Cat?',
    'Cat Guardians(캣 가디언즈)',
    'FINAL FANTASY VII REVELATION',
    'Potions of Veldenkeep',
  ]);
  await checks.expectClean();
});

test('Ajustes: edad del catálogo en Datos y «Datos de Steam que guardamos» en Privacidad', async ({
  page,
}) => {
  const checks = await setup(page);
  await page.clock.setFixedTime(NOW);
  await page.goto('/ajustes/datos');
  await expect(page.getByRole('heading', { level: 3, name: 'Catálogo de Steam' })).toBeVisible();
  await expect(page.getByText('Versión 20261028.1, del 28 oct 2026 (hace 5 días).')).toBeVisible();
  await page.getByRole('button', { name: 'Actualizar catálogo' }).click();
  await expect(page.getByText('Ya tienes la última versión del catálogo.')).toBeVisible();

  await page.goto('/ajustes/privacidad');
  await expect(
    page.getByRole('heading', { level: 3, name: 'Datos de Steam que guardamos' }),
  ).toBeVisible();
  await expect(page.getByText(/reciben tu dirección IP/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Borrar los datos de Steam de este dispositivo' }).click();
  await expect(
    page.getByText(/Hemos borrado los datos de Steam de este dispositivo/),
  ).toBeVisible();
  expect(
    await page.evaluate(async () => (await caches.keys()).filter((n) => n.startsWith('gacat-'))),
  ).toEqual([]);
  await expectAccessible(page, 'Ajustes › Privacidad');
  await checks.expectClean();
});
