// Clasificación (§4.9) y construcción (§4.5, paso 4): retirados, `success 15`, restricción de
// país, `flags`, `year`, `pop`, lista negra exacta, SKU duplicados y orden del núcleo.

import { CatalogFlag } from '@gameagenda/core/catalog-format';
import { describe, expect, it } from 'vitest';
import {
  type AssembleInput,
  assemble,
  enrichmentOf,
  isBlacklisted,
  looksSpanish,
  needsBaseName,
  popOf,
} from '../src/derive.ts';
import { classify, classifyAppids } from '../src/get-items.ts';
import { endpointOf } from '../steam/endpoints.ts';
import type { GetItemsItem, QueryItem } from '../steam/schemas.ts';
import { fixtureClient, recordedFixtures, syntheticFixtures } from './helpers.ts';

/** `appid` del lote de GetItems grabado con ese contexto y ese tamaño. */
function recordedBatch(language: string, country: string, size: number): number[] {
  for (const r of recordedFixtures()) {
    if (endpointOf(r.url) !== 'getitems') continue;
    const j = JSON.parse(new URL(r.url).searchParams.get('input_json') as string) as {
      ids: Array<{ appid: number }>;
      context: { language: string; country_code: string };
    };
    if (
      j.context.language === language &&
      j.context.country_code === country &&
      j.ids.length === size
    ) {
      return j.ids.map((x) => x.appid);
    }
  }
  throw new Error('lote no grabado');
}

describe('clasificación con GetItems (fixtures grabados)', () => {
  it('retirado, inexistente, bloqueado en ES (visible en US) y bloqueado en ES y en US', async () => {
    const got = await classifyAppids(fixtureClient(), recordedBatch('spanish', 'ES', 37));
    expect(got.get(50300)?.cls).toBe('retired');
    expect(got.get(3158110)?.cls).toBe('retired');
    // success 15 + appid 0 + nombre vacío: Steam devuelve el appid pedido en `id`.
    expect(got.get(999999999)).toMatchObject({ cls: 'deleted', reason: 'success 15 + appid 0' });
    expect(got.get(21130)).toMatchObject({ cls: 'blocked', country: 'US' });
    expect(got.get(21130)?.item?.success).toBe(1);
    expect(got.get(35030)).toMatchObject({ cls: 'blocked', country: 'ES' });
    expect(got.get(35030)?.item?.name).toBe('Championship Manager 2010');
    expect(got.get(22380)?.cls).toBe('visible');
  });

  it('success 15 solo nunca es «eliminado» (fixture sintético)', async () => {
    const c = fixtureClient(syntheticFixtures());
    const got = await classifyAppids(c, [4000000001, 4000000002, 4000000003]);
    expect(got.get(4000000001)).toMatchObject({ cls: 'blocked', country: 'US' });
    expect(got.get(4000000002)?.cls).toBe('deleted');
    expect(got.get(4000000003)?.cls).toBe('unknown');
  });

  it('casos sueltos', () => {
    const it = (x: Partial<GetItemsItem>): GetItemsItem => ({ success: 1, ...x }) as GetItemsItem;
    expect(classify(undefined).cls).toBe('unknown');
    expect(classify(it({ success: 1, unlisted: true, appid: 5 })).cls).toBe('retired');
    expect(classify(it({ success: 1, visible: false, appid: 5 })).cls).toBe('unknown');
    expect(
      classify(
        it({ success: 15, unvailable_for_country_restriction: true, appid: 5, name: 'X' }),
        it({ success: 1, unlisted: true, appid: 5 }),
      ).cls,
    ).toBe('retired');
    expect(classify(it({ success: 2, appid: 5 })).cls).toBe('unknown');
  });
});

const item = (x: Partial<QueryItem> & { appid: number }): QueryItem => ({
  type: 0,
  success: 1,
  name: `Juego ${x.appid}`,
  ...x,
});

describe('flags, year y pop (§7.6)', () => {
  it('pop = min(63, floor(2·log2(reseñas + 1)))', () => {
    expect(popOf(0)).toBe(0);
    expect(popOf(1)).toBe(2);
    expect(popOf(9_953_549)).toBe(46);
    expect(popOf(2 ** 40)).toBe(63);
  });

  it('bits y año', () => {
    const e = enrichmentOf(
      item({
        appid: 1,
        is_free: true,
        is_early_access: true,
        content_descriptorids: [1, 4, 5],
        release: { steam_release_date: Date.UTC(2021, 5, 1) / 1000 },
        reviews: { summary_filtered: { review_count: 3 } },
      }),
    );
    expect(e.flags).toBe(CatalogFlag.free | CatalogFlag.earlyAccess | CatalogFlag.adult);
    expect(e.year).toBe(2021);
    expect(e.reviews).toBe(3);
  });

  it('fecha por confirmar: text_tba, text_comingsoon, sin coming_soon_display o sin fecha', () => {
    const soon = (release: QueryItem['release']) =>
      enrichmentOf(item({ appid: 1, is_coming_soon: true, release }));
    const ts = Date.UTC(2027, 0, 1) / 1000;
    expect(soon({ steam_release_date: ts, coming_soon_display: 'date_full' })).toMatchObject({
      flags: CatalogFlag.soon,
      year: 2027,
    });
    expect(soon({ steam_release_date: ts, coming_soon_display: 'date_year' }).year).toBe(2027);
    for (const r of [
      { steam_release_date: ts, coming_soon_display: 'text_tba' },
      { steam_release_date: ts, coming_soon_display: 'text_comingsoon' },
      { steam_release_date: ts },
      { coming_soon_display: 'date_full' },
    ]) {
      expect(soon(r)).toMatchObject({ flags: CatalogFlag.soon | CatalogFlag.tba, year: 0 });
    }
  });
});

describe('nombre base en el plan B', () => {
  it('se pide en inglés si parece español o viene vacío', () => {
    expect(looksSpanish('Command & Conquer 3: La Ira de Kane')).toBe(true);
    expect(looksSpanish('Mafia III: Edición Definitiva')).toBe(true);
    expect(looksSpanish('Hollow Knight')).toBe(false);
    expect(looksSpanish('Counter-Strike 2')).toBe(false);
    expect(needsBaseName(item({ appid: 1, name: '  ' }))).toBe(true);
    expect(needsBaseName(item({ appid: 1, name: 'ELDEN RING' }))).toBe(false);
  });
});

function input(over: Partial<AssembleInput>): AssembleInput {
  return {
    list: null,
    query: new Map(),
    gaps: new Map(),
    baseNames: new Map(),
    state: new Map(),
    today: '2026-10-29',
    ...over,
  };
}

const rv = (n: number) => ({ summary_filtered: { review_count: n } });

describe('construir', () => {
  it('solo type 0; fuera vacíos y la lista negra exacta (nunca por prefijo)', () => {
    const q = new Map<number, QueryItem>(
      [
        item({ appid: 473930, name: 'Steam Gift Cards', type: 14 }),
        item({ appid: 2, name: ' \t ' }),
        item({ appid: 866490, name: 'TestApp' }),
        item({ appid: 3, name: 'TestApp' }),
        item({ appid: 837470, name: 'Untitled Goose Game' }),
        item({ appid: 639770, name: 'UNTITLED' }),
      ].map((i) => [i.appid, i]),
    );
    const { games, excluded } = assemble(input({ query: q }));
    expect(games.map((g) => g.appid).sort((a, b) => a - b)).toEqual([3, 837470]);
    expect(excluded.map((e) => [e.appid, e.reason])).toEqual([
      [2, 'empty-name'],
      [473930, 'not-game'],
      [639770, 'blacklist'],
      [866490, 'blacklist'],
    ]);
    expect(isBlacklisted(866490, 'TestApp')).toBe(true);
    expect(isBlacklisted(866490, 'TestApp 2')).toBe(false);
  });

  it('nombre base de L o de GetItems en inglés y nameEs si difiere', () => {
    const q = new Map([
      [24810, item({ appid: 24810, name: 'Command & Conquer 3: La Ira de Kane' })],
    ]);
    const keyless = assemble(
      input({ query: q, baseNames: new Map([[24810, 'Command & Conquer™ 3: Kane’s Wrath']]) }),
    );
    expect(keyless.games[0]).toMatchObject({
      name: 'Command & Conquer™ 3: Kane’s Wrath',
      nameEs: 'Command & Conquer 3: La Ira de Kane',
    });
    const sinBase = assemble(input({ query: q }));
    expect(sinBase.games[0]).toMatchObject({
      name: 'Command & Conquer 3: La Ira de Kane',
      nameEs: '',
    });
    const keyed = assemble(
      input({ list: new Map([[24810, { name: 'C&C 3: Kane’s Wrath' }]]), query: q }),
    );
    expect(keyed.games[0]?.name).toBe('C&C 3: Kane’s Wrath');
  });

  it('SKU regional duplicado: se queda el visible en ES', () => {
    const q = new Map([
      [22380, item({ appid: 22380, name: 'Fallout: New Vegas', reviews: rv(100) })],
    ]);
    const blocked = (appid: number, name: string) => ({
      cls: 'blocked' as const,
      item: { success: 1, appid, name, type: 0 } as GetItemsItem,
      country: 'US' as const,
      reason: 'bloqueado en ES, visible en US',
    });
    const { games, excluded } = assemble(
      input({
        list: new Map([
          [22380, { name: 'Fallout: New Vegas' }],
          [22490, { name: 'Fallout: New Vegas' }],
          [21130, { name: 'LEGO® Harry Potter: Years 1-4' }],
        ]),
        query: q,
        gaps: new Map([
          [22490, blocked(22490, 'Fallout: New Vegas')],
          [21130, blocked(21130, 'LEGO® Harry Potter: Years 1-4')],
        ]),
      }),
    );
    expect(games.map((g) => [g.appid, g.cls])).toEqual([
      [22380, 'visible'],
      [21130, 'blocked'],
    ]);
    expect(excluded).toEqual([
      expect.objectContaining({
        appid: 22490,
        reason: 'duplicate-sku',
        detail: expect.stringContaining('22380'),
      }),
    ]);
  });

  it('orden: reseñas descendentes, appid descendente y los retirados al final con su bit', () => {
    const q = new Map(
      [
        item({ appid: 10, reviews: rv(5) }),
        item({ appid: 20, reviews: rv(5) }),
        item({ appid: 30, reviews: rv(50) }),
        item({ appid: 40 }),
      ].map((i) => [i.appid, i]),
    );
    const retired = {
      cls: 'retired' as const,
      item: {
        success: 1,
        appid: 50,
        name: 'Retirado',
        type: 0,
        unlisted: true,
        reviews: rv(1000),
      } as GetItemsItem,
      country: 'ES' as const,
      reason: 'unlisted',
    };
    const state = new Map([
      [
        50,
        {
          appid: 50,
          name: 'Retirado',
          cls: 'visible' as const,
          flags: 0,
          year: 0,
          reviews: 900,
          enrichedOn: '2026-10-01',
        },
      ],
    ]);
    const { games } = assemble(input({ query: q, gaps: new Map([[50, retired]]), state }));
    expect(games.map((g) => g.appid)).toEqual([30, 20, 10, 40, 50]);
    expect(games[4]).toMatchObject({
      flags: CatalogFlag.retired,
      cls: 'retired',
      reviews: 1000,
      enrichedOn: '2026-10-29',
    });
  });

  it('un hueco sin respuesta clara conserva lo que había en el estado; un inexistente se elimina', () => {
    const state = new Map([
      [
        60,
        {
          appid: 60,
          name: 'Del estado',
          nameEs: 'Del estado ES',
          cls: 'blocked' as const,
          flags: 8,
          year: 2020,
          reviews: 7,
          enrichedOn: '2026-10-20',
        },
      ],
      [
        70,
        {
          appid: 70,
          name: 'Borrado',
          cls: 'visible' as const,
          flags: 0,
          year: 0,
          reviews: 0,
          enrichedOn: '2026-10-20',
        },
      ],
    ]);
    const gaps = new Map([
      [
        60,
        { cls: 'unknown' as const, item: null, country: null, reason: 'GetItems no lo devuelve' },
      ],
      [70, { cls: 'deleted' as const, item: null, country: null, reason: 'success 15 + appid 0' }],
    ]);
    const { games, excluded } = assemble(input({ gaps, state }));
    expect(games).toEqual([
      expect.objectContaining({
        appid: 60,
        name: 'Del estado',
        nameEs: 'Del estado ES',
        cls: 'blocked',
        flags: 8,
        year: 2020,
        pop: 6,
        enrichedOn: '2026-10-20',
      }),
    ]);
    expect(excluded).toEqual([expect.objectContaining({ appid: 70, reason: 'deleted' })]);
  });
});
