// Aviso para exportar tras 30 días sin copia (RNF-08, §9.6): cuenta desde que hay algo en Mi
// lista o desde la última exportación; «Ahora no» lo aplaza 7 días y exportar lo quita. El paso
// del tiempo se simula con `page.clock.setFixedTime` (solo `Date`; los temporizadores siguen).
import { expect, type Page, test } from '@playwright/test';
import { capture, expectAccessible, setup, toast } from './helpers.ts';
import { expectStored, storedMeta } from './storage.ts';

const DAY = 86_400_000;

interface CopyReminder {
  readonly lastCopy: number | null;
  readonly since: number;
  readonly snoozedUntil: number | null;
}

async function stored(page: Page): Promise<CopyReminder> {
  await expect.poll(() => storedMeta(page, 'copyReminder')).not.toBeNull();
  return (await storedMeta(page, 'copyReminder')) as CopyReminder;
}

/** Mi lista en el momento `at`. En el iPhone se cierra antes el aviso de iOS, que va primero. */
async function openListAt(page: Page, at: number) {
  await page.clock.setFixedTime(at);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Mi lista' })).toBeVisible();
  if (test.info().project.name === 'webkit-movil') {
    await page.locator('.notice--ios').getByRole('button', { name: 'Ocultar este aviso' }).click();
  }
}

function reminder(page: Page) {
  return page.locator('.notice--copy');
}

test('sin exportar nunca: avisa a los 30 días, «Ahora no» aplaza 7 y exportar lo quita', async ({
  page,
}) => {
  const checks = await setup(page);
  await page.goto('/');
  await capture(page, 'celeste', 'Celeste');
  await expectStored(page, 'steam:504230', { title: 'Celeste' });
  const { since } = await stored(page);

  await openListAt(page, since + 29 * DAY);
  await expect(page.getByRole('heading', { name: /^Quiero jugar/ })).toBeVisible();
  await expect(reminder(page)).toHaveCount(0);

  await openListAt(page, since + 31 * DAY);
  await expect(reminder(page)).toContainText(
    'Aún no has guardado ninguna copia de tu lista. Exporta una por si este navegador borra los datos de GameAgenda.',
  );
  await expectAccessible(page, 'Mi lista con el aviso de copia');
  await reminder(page).getByRole('button', { name: 'Ahora no' }).click();
  await expect(reminder(page)).toHaveCount(0);
  await expect(page.locator('#main')).toBeFocused();
  await expect.poll(async () => (await stored(page)).snoozedUntil).toBe(since + 31 * DAY + 7 * DAY);

  await openListAt(page, since + 37 * DAY);
  await expect(page.getByRole('heading', { name: /^Quiero jugar/ })).toBeVisible();
  await expect(reminder(page)).toHaveCount(0);

  await openListAt(page, since + 38 * DAY);
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    reminder(page).getByRole('button', { name: 'Exportar' }).click(),
  ]);
  expect(file.suggestedFilename()).toMatch(/^gameagenda-\d{4}-\d{2}-\d{2}\.json$/);
  await expect(toast(page)).toContainText(`Hemos exportado ${file.suggestedFilename()}.`);
  await expect(reminder(page)).toHaveCount(0);
  await expect
    .poll(() => stored(page))
    .toEqual({ lastCopy: since + 38 * DAY, since, snoozedUntil: null });

  await openListAt(page, since + 60 * DAY);
  await expect(page.getByRole('heading', { name: /^Quiero jugar/ })).toBeVisible();
  await expect(reminder(page)).toHaveCount(0);
  await checks.expectClean();
});

test('exportar desde Ajustes vuelve a contar y el aviso dice de cuándo es la última copia', async ({
  page,
}) => {
  const checks = await setup(page);
  await page.goto('/');
  await capture(page, 'terraria', 'Terraria');
  await expectStored(page, 'steam:105600', { title: 'Terraria' });
  await page.goto('/ajustes/datos');
  await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Exportar CSV' }).click(),
  ]);
  await expect.poll(async () => (await stored(page)).lastCopy).not.toBeNull();
  const { lastCopy } = await stored(page);

  await openListAt(page, (lastCopy as number) + 31 * DAY);
  await expect(reminder(page)).toContainText(
    'Tu última copia de la lista es de hace 31 días. Exporta otra por si este navegador borra los datos de GameAgenda.',
  );
  await checks.expectClean();
});
