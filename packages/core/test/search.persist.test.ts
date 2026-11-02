// Índice persistido (M3, CA3.2): lo restaurado responde igual que lo construido, sobre la copia
// congelada del catálogo real. `v8.serialize` y `v8.deserialize` son el mismo clon estructurado
// que usa IndexedDB, así que la prueba pasa por lo que pasará el Worker.

import v8 from 'node:v8';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type AliasPair,
  CatalogFlag,
  type CoreRow,
  coreFromRows,
  parseAliases,
  parseCore,
} from '../src/catalog-format/index.ts';
import {
  createIndexBuilder,
  type FuzzyMatcher,
  loadFuzzy,
  type Searcher,
  searcherFromParts,
} from '../src/search/index.ts';
import {
  createIndexPacker,
  IndexFormatError,
  type IndexParts,
  type PackedIndex,
  packIndex,
  restoreHaystack,
  restoreParts,
} from '../src/search/persist.ts';

/** Lo que hace el Worker: lo principal, el pajar después, y el buscador del *chunk* de entrada. */
function restoreSearcher(value: unknown): Searcher {
  const { main, haystack } = (value ?? {}) as Partial<PackedIndex>;
  return searcherFromParts(restoreHaystack(haystack, restoreParts(main)));
}

import { readFrozen, readGolden, realisticFinals, typedSequences } from './helpers/frozen.ts';

const SLOW = { timeout: 240_000 };

/** Construye el índice entero y devuelve el buscador y sus partes. */
function build(
  rows: ReturnType<typeof parseCore>,
  aliases: readonly AliasPair[],
): { searcher: Searcher; parts: IndexParts } {
  const builder = createIndexBuilder(rows, aliases, { now: () => 0 });
  while (!builder.step(Number.POSITIVE_INFINITY)) {
    // sin plazo
  }
  expect(builder.parts).not.toBeNull();
  return { searcher: builder.result as Searcher, parts: builder.parts as IndexParts };
}

/** Lo que guardaría y leería IndexedDB. */
function throughIndexedDb(data: unknown): unknown {
  return v8.deserialize(v8.serialize(data));
}

function sameAnswers(a: Searcher, b: Searcher, queries: readonly string[]): void {
  for (const q of queries) {
    for (const showAdult of [false, true]) {
      expect(b.query(q, { limit: 8, showAdult }), q).toEqual(a.query(q, { limit: 8, showAdult }));
      a.reset();
      b.reset();
    }
  }
}

describe('índice persistido sobre el catálogo congelado', () => {
  let built: Searcher;
  let parts: IndexParts;
  let restored: Searcher;
  let fuzzy: FuzzyMatcher;
  let names: readonly string[];
  const times: Record<string, number> = {};

  beforeAll(async () => {
    const { core, aliases } = readFrozen();
    const cat = parseCore(core);
    names = cat.name;
    ({ searcher: built, parts } = build(cat, parseAliases(aliases).pairs));

    // Como en el Worker: a trozos de ≤8 ms después de `full`.
    let t = performance.now();
    const packer = createIndexPacker(parts, { now: () => performance.now() });
    let maxBlock = 0;
    for (;;) {
      const a = performance.now();
      const done = packer.step(a + 8);
      maxBlock = Math.max(maxBlock, performance.now() - a);
      if (done) break;
    }
    times.packMs = performance.now() - t;
    times.maxPackBlockMs = maxBlock;
    const packed = packer.result as PackedIndex;
    const bytes = v8.serialize(packed);
    times.megabytes = bytes.length / 1e6;
    times.mainMegabytes = v8.serialize(packed.main).length / 1e6;

    t = performance.now();
    const stored = v8.deserialize(bytes);
    times.cloneMs = performance.now() - t;
    t = performance.now();
    restored = restoreSearcher(stored);
    times.restoreMs = performance.now() - t;
    fuzzy = await loadFuzzy();
    console.log(
      'índice persistido (Node):',
      JSON.stringify(times, (_, v) => (typeof v === 'number' ? +v.toFixed(1) : v)),
    );
  }, 240_000);

  it('vuelve en `full`, con la misma versión y el mismo recuento', () => {
    expect(restored.state).toBe('full');
    expect(restored.version).toBe(built.version);
    expect(restored.count).toBe(built.count);
    expect(restored.count).toBeGreaterThan(190_000);
  });

  it('empaqueta a trozos que no bloquean más que un bloque de construcción', () => {
    expect(times.maxPackBlockMs).toBeLessThan(50);
  });

  it('sin el pajar, lo principal ya responde a los niveles 0–2; el 3 llega con él', () => {
    expect(times.mainMegabytes).toBeLessThan((times.megabytes ?? 0) - 4);
    const stored = throughIndexedDb(packIndex(parts)) as PackedIndex;
    const first = searcherFromParts(restoreParts(stored.main));
    // «hollow knight»: niveles 0–2, igual que lo construido.
    expect(first.query('hollow knight')).toEqual(built.query('hollow knight'));
    // «ollow knigh» solo sale por subcadena (nivel 3).
    expect(built.query('ollow knigh').items.some((i) => i.tier === 3)).toBe(true);
    expect(first.query('ollow knigh').items.some((i) => i.tier === 3)).toBe(false);
    const full = searcherFromParts(restoreHaystack(stored.haystack, restoreParts(stored.main)));
    expect(full.query('ollow knigh')).toEqual(built.query('ollow knigh'));
  });

  it('da las mismas listas en el dorado y en 600 pulsaciones del conjunto realista', SLOW, () => {
    const golden = readGolden().map((g) => g.q);
    const keystrokes = typedSequences(realisticFinals(names)).flat().slice(0, 600);
    sameAnswers(built, restored, [...golden, ...keystrokes, 'zelda', 'mario kart']);
  });

  it('el nivel 4, el Catálogo, Vincular y los provisionales, igual', () => {
    for (const q of ['eldn rign', 'hollw knigt', 'baldurs gat']) {
      const a = built.suggest(q, fuzzy, { limit: 3 });
      const b = restored.suggest(q, fuzzy, { limit: 3 });
      while (!a.step()) {
        // todos los bloques
      }
      while (!b.step()) {
        // todos los bloques
      }
      expect(b.items, q).toEqual(a.items);
    }
    for (const [q, filter] of [
      ['', {}],
      ['', { showAdult: true }],
      ['dark souls', {}],
      ['', { flagsAll: CatalogFlag.free }],
    ] as const) {
      const a = built.browse(q, filter);
      const b = restored.browse(q, filter);
      expect(b.count, q).toBe(a.count);
      expect(b.slice(0, 50)).toEqual(a.slice(0, 50));
      expect(b.slice(a.count - 20, a.count)).toEqual(a.slice(a.count - 20, a.count));
    }
    expect(restored.matchExact('Hades II')).toEqual(built.matchExact('Hades II'));
    expect(restored.game(1145350)).toEqual(built.game(1145350));
    expect(restored.lookup([730, 1, 1245620])).toEqual(built.lookup([730, 1, 1245620]));
  });
});

describe('índice persistido: casos pequeños', () => {
  const ROWS: CoreRow[] = [
    { appid: 1030840, name: 'Mafia: Definitive Edition', nameEs: 'Mafia: Edición Definitiva' },
    { appid: 2, name: 'The Witcher 3: Wild Hunt', pop: 39 },
    { appid: 3, name: '黑神话：悟空', nameEs: 'Black Myth: Wukong' },
    { appid: 4, name: 'Hentai Quest', flags: CatalogFlag.adult },
    { appid: 5, name: 'Pokémon Típico', flags: CatalogFlag.retired },
  ];
  const ALIASES: AliasPair[] = [
    ['tw3', 2],
    ['bmw', 3],
    ['mafia', 1030840],
    ['mafia', 2],
  ];

  function round(): { built: Searcher; restored: Searcher; data: PackedIndex } {
    const { searcher, parts } = build(coreFromRows(ROWS, { version: '20261102.1' }), ALIASES);
    const data = packIndex(parts);
    return { built: searcher, restored: restoreSearcher(throughIndexedDb(data)), data };
  }

  it('nombres en español, CJK, alias repetidos y +18, igual que lo construido', () => {
    const { built, restored } = round();
    sameAnswers(built, restored, ['mafia', 'edicion', 'tw3', 'bmw', '悟空', 'hentai', 'pokemon']);
    expect(restored.version).toBe('20261102.1');
  });

  it('rechaza lo que no es un índice de este formato', () => {
    const { data } = round();
    const { main, haystack } = data;
    const brokenMain: unknown[] = [
      null,
      'texto',
      { ...main, format: 1 },
      { ...main, count: main.count + 1 },
      { ...main, appid: main.appid.subarray(1) },
      { ...main, names: { ...main.names, count: 2 } },
      { ...main, tokens: { count: 1, bytes: 'tokens' } },
      { ...main, fwdStart: main.fwdStart.subarray(0, 2) },
      { ...main, bsAll: new Uint32Array(3) },
      { ...main, kind: 'otro' },
    ];
    for (const value of brokenMain) {
      expect(() => restoreParts(throughIndexedDb(value))).toThrow(IndexFormatError);
    }
    const parts = restoreParts(throughIndexedDb(main));
    const brokenHaystack: unknown[] = [
      null,
      { ...haystack, format: 1 },
      // El de otro núcleo.
      { ...haystack, count: haystack.count + 1 },
      { ...haystack, chunks: [{ narrow: null }] },
    ];
    for (const value of brokenHaystack) {
      expect(() => restoreHaystack(throughIndexedDb(value), parts)).toThrow(IndexFormatError);
    }
  });

  it('no guarda una cadena con un surrogado suelto: UTF-8 la cambiaría', () => {
    const rows: CoreRow[] = [...ROWS, { appid: 6, name: 'Roto \uD800 a medias' }];
    const { parts } = build(coreFromRows(rows, { version: '20261102.1' }), ALIASES);
    expect(() => packIndex(parts)).toThrow(IndexFormatError);
  });

  it('un catálogo vacío también se guarda y se restaura', () => {
    const { searcher, parts } = build(coreFromRows([], { version: '20261102.1' }), []);
    const restored = restoreSearcher(throughIndexedDb(packIndex(parts)));
    expect(restored.count).toBe(0);
    expect(restored.query('hades').items).toEqual(searcher.query('hades').items);
  });
});
