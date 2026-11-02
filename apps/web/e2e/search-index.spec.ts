// Índice persistido (M3, CA3.2; §8.8): la primera visita construye el índice y lo guarda en
// `meta.searchIndex`; el reinicio con el mismo catálogo lo restaura sin construirlo y busca igual.
// La cifra de CA3.2 (≤0,4 s con CPU ×4, sobre el catálogo completo) la mide `npm run perf`.
import { expect, test } from '@playwright/test';
import { capture, measures, search, setup, waitForSearch } from './helpers.ts';
import { storedMeta } from './storage.ts';

test('el reinicio con el mismo catálogo restaura el índice guardado y busca igual (CA3.2)', async ({
  page,
}) => {
  const checks = await setup(page);
  await page.goto('/');
  await waitForSearch(page, 'full');
  // Se guarda después de `full`, a trozos: la clave identifica el núcleo, los recientes y los alias.
  await expect
    .poll(() => storedMeta(page, 'searchIndexKey'), { timeout: 15_000 })
    .toMatch(/^1\|\/assets\/[^|]+\|[0-9a-f]{64}\|[0-9a-f]{64}\|[0-9a-f]{64}$/);
  expect(await measures(page, 'search:index-restored')).toEqual([]);

  await page.reload();
  await waitForSearch(page, 'full');
  await expect.poll(() => measures(page, 'search:index-restored')).toHaveLength(1);
  // Con el índice restaurado se apunta como siempre, también lo que solo da el nivel 3.
  await capture(page, 'celeste', 'Celeste');
  await search(page, 'eleste', /Celeste/);
  await checks.expectClean();
});
