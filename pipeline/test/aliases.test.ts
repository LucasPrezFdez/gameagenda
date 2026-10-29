// Alias (§8.5): el generador portado reproduce byte a byte los alias de la copia congelada a
// partir de su núcleo (los mismos que se midieron el 28-10-2026).

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseCore, serializeAliases } from '@gameagenda/core/catalog-format';
import { describe, expect, it } from 'vitest';
import { buildAliases } from '../src/aliases.ts';

const FROZEN = new URL('../../fixtures/catalog-frozen/', import.meta.url);

describe('alias', () => {
  it('reproduce aliases.20261028.1.tsv desde core.20261028.1.tsv.gz', { timeout: 60_000 }, () => {
    const core = parseCore(
      gunzipSync(readFileSync(new URL('core.20261028.1.tsv.gz', FROZEN))).toString('utf8'),
    );
    // En el núcleo, `pop` > 0 ⇔ reseñas > 0, y el orden de filas es el rango estático.
    const games = Array.from({ length: core.count }, (_, g) => ({
      appid: core.appid[g] as number,
      name: core.name[g] as string,
      reviews: core.pop[g] as number,
    }));
    const built = buildAliases(games);
    expect(serializeAliases(built.pairs, { version: '20261028.1' })).toBe(
      readFileSync(new URL('aliases.20261028.1.tsv', FROZEN), 'utf8'),
    );
    expect(built.missing).toEqual([
      ['ff7', 39140],
      ['ffvii', 39140],
      ['tes5', 72850],
    ]);
  });
});
