import { beforeAll, describe, expect, it } from 'vitest';
import {
  type AliasPair,
  CatalogFlag,
  type CoreRow,
  coreFromRows,
} from '../src/catalog-format/index.ts';
import {
  buildSearcher,
  canSuggest,
  createIndexBuilder,
  FUZZY_BLOCK,
  type FuzzyMatcher,
  loadFuzzy,
  type Searcher,
  Tier,
  withSuggestions,
} from '../src/search/index.ts';

const { adult, retired, free, soon } = CatalogFlag;

// Mini-catálogo en orden de rango estático (reseñas descendentes; retirados al final).
const ROWS: CoreRow[] = [
  { appid: 730, name: 'Counter-Strike 2', flags: free, year: 2012, pop: 46 },
  { appid: 570, name: 'Dota 2', flags: free, year: 2013, pop: 42 },
  { appid: 1086940, name: "Baldur's Gate 3", year: 2023, pop: 40 },
  { appid: 1245620, name: 'ELDEN RING', year: 2022, pop: 40 },
  { appid: 292030, name: 'The Witcher 3: Wild Hunt', year: 2015, pop: 39 },
  { appid: 3240220, name: 'Grand Theft Auto V Enhanced', year: 2025, pop: 38 },
  { appid: 1222670, name: 'The Sims™ 4', flags: free, year: 2014, pop: 37 },
  { appid: 367520, name: 'Hollow Knight', year: 2017, pop: 36 },
  { appid: 2358720, name: 'Black Myth: Wukong', year: 2024, pop: 35 },
  { appid: 374320, name: 'DARK SOULS™ III', year: 2016, pop: 34 },
  {
    appid: 1030840,
    name: 'Mafia: Definitive Edition',
    nameEs: 'Mafia: Edición Definitiva',
    pop: 33,
  },
  { appid: 1145360, name: 'Hades', year: 2020, pop: 33 },
  { appid: 1030300, name: 'Hollow Knight: Silksong', flags: soon, pop: 32 },
  { appid: 1145350, name: 'Hades II', year: 2025, pop: 31 },
  { appid: 10, name: 'Counter-Strike', year: 2000, pop: 30 },
  { appid: 900001, name: 'Hollow Desire', flags: adult, pop: 29 },
  { appid: 357190, name: 'Mega Man X Legacy Collection', pop: 20 },
  { appid: 900002, name: '三国志14', nameEs: '三国志14 威力加強版', pop: 18 },
  { appid: 900003, name: 'Wukong', pop: 5 },
  { appid: 900004, name: 'Ratchet & Clank: Rift Apart', pop: 4 },
  { appid: 900005, name: 'Hollow Retired', flags: retired, pop: 50 },
];
const ALIASES: AliasPair[] = [
  ['cs2', 730],
  ['csgo', 730],
  ['bg3', 1086940],
  ['gta5', 3240220],
  ['gtav', 3240220],
  ['nope', 123456789],
];

const catalog = coreFromRows(ROWS, { version: '20261028.1' });

function both(): [string, Searcher][] {
  const b = createIndexBuilder(catalog, ALIASES, { now: () => 0 });
  let scan: Searcher | null = null;
  while (!b.step(0)) if (!scan && b.state === 'scan') scan = b.searcher;
  return [
    ['full', b.result as Searcher],
    ['scan', scan as Searcher],
  ];
}

const appids = (s: Searcher, q: string, showAdult = false): number[] =>
  s.query(q, { showAdult }).items.map((i) => i.appid);

describe.each(both())('búsqueda (%s)', (_, s) => {
  it('nivel 0 primero: el exacto antes que el popular que empieza igual', () => {
    const r = s.query('counter strike');
    expect(r.items.map((i) => [i.appid, i.tier])).toEqual([
      [10, Tier.exact],
      [730, Tier.title],
    ]);
    expect(r.strong).toBe(2);
  });

  it('alias y siglas, con colisiones ordenadas por fila', () => {
    expect(s.query('cs2').items[0]).toMatchObject({ appid: 730, tier: Tier.exact });
    expect(appids(s, 'CS:GO')).toEqual([730]);
    expect(s.query('gta 5').items[0]).toMatchObject({ appid: 3240220, tier: Tier.exact });
    expect(s.query('bg3').items[0]?.appid).toBe(1086940);
  });

  it('apóstrofos, artículos y nombres en español', () => {
    expect(s.query('baldurs gate').items[0]).toMatchObject({ appid: 1086940, tier: Tier.title });
    expect(s.query('witcher 3').items[0]).toMatchObject({ appid: 292030, tier: Tier.title });
    expect(s.query('los sims 4').items[0]).toMatchObject({ appid: 1222670, tier: Tier.exact });
    expect(s.query('the sims 4').items[0]).toMatchObject({ appid: 1222670, tier: Tier.exact });
    expect(s.query('mafia edicion definitiva').items[0]).toMatchObject({
      appid: 1030840,
      nameEs: 'Mafia: Edición Definitiva',
      tier: Tier.exact,
    });
  });

  it('romanos ↔ arábigos y números', () => {
    expect(s.query('dark souls 3').items[0]).toMatchObject({ appid: 374320, tier: Tier.words });
    expect(s.query('mega man 10').items[0]).toMatchObject({ appid: 357190, tier: Tier.words });
    expect(s.query('hades 2').items[0]).toMatchObject({ appid: 1145350, tier: Tier.words });
    expect(appids(s, 'grand theft auto 5')).toEqual([3240220]);
  });

  it('niveles 1 y 2 juntos por pop + 6 / pop + 0', () => {
    // Wukong exacto (nivel 0) y Black Myth: Wukong (nivel 2, pop 35) antes que nada más.
    expect(s.query('wukong').items.map((i) => [i.appid, i.tier])).toEqual([
      [900003, Tier.exact],
      [2358720, Tier.words],
    ]);
    // «hades»: Hades exacto y después Hades II (nivel 1).
    expect(appids(s, 'hades')).toEqual([1145360, 1145350]);
  });

  it('subcadena (nivel 3) solo si faltan resultados', () => {
    expect(s.query('eldenring').items[0]).toMatchObject({ appid: 1245620, tier: Tier.substring });
    expect(s.query('halflife').items).toEqual([]);
    expect(s.query('ld').items).toEqual([]);
  });

  it('+18 se filtra antes de contar y se muestra si se pide', () => {
    expect(appids(s, 'hollow')).not.toContain(900001);
    expect(appids(s, 'hollow', true)).toContain(900001);
    expect(s.query('hollow desire').items).toEqual([]);
  });

  it('los retirados van detrás de los vivos de su grupo aunque tengan más pop', () => {
    expect(appids(s, 'hollow')).toEqual([367520, 1030300, 900005]);
  });

  it('appid explícito, CJK y &', () => {
    expect(s.query('appid:730').items[0]).toMatchObject({ appid: 730, tier: Tier.link });
    expect(s.query('appid: 999').items).toEqual([]);
    expect(appids(s, '三国')).toEqual([900002]);
    expect(appids(s, '威力')).toEqual([900002]);
    expect(s.query('ratchet and clank').items[0]?.tier).toBe(Tier.title);
    expect(s.query('ratchet & clank').items[0]?.tier).toBe(Tier.title);
  });

  it('respeta limit y no repite filas', () => {
    expect(s.query('h', { limit: 2 }).items).toHaveLength(2);
    const r = s.query('hollow knight', { limit: 8 });
    expect(new Set(r.items.map((i) => i.appid)).size).toBe(r.items.length);
    expect(s.query('   ').items).toEqual([]);
  });

  it('matchExact: misma clave exacta, sin alias ni filtro de +18', () => {
    expect(s.matchExact('Hades')).toEqual([1145360]);
    expect(s.matchExact('HADES II')).toEqual([1145350]);
    expect(s.matchExact('Witcher 3: Wild Hunt')).toEqual([292030]);
    expect(s.matchExact('cs2')).toEqual([]);
    expect(s.matchExact('Hollow Desire')).toEqual([900001]);
  });

  it('game y lookup por appid', () => {
    expect(s.game(1245620)).toEqual({
      appid: 1245620,
      name: 'ELDEN RING',
      nameEs: null,
      year: 2022,
      flags: 0,
    });
    expect(s.game(1)).toBeNull();
    expect(s.lookup([730, 1, 10])).toEqual({
      found: [s.game(730), s.game(10)],
      missing: [1],
    });
  });

  it('browse: recuento y ventanas en el orden del núcleo', () => {
    const all = s.browse('');
    expect(all.count).toBe(ROWS.length - 1);
    expect(s.browse('', { showAdult: true }).count).toBe(ROWS.length);
    expect(all.slice(0, 3).map((i) => i.appid)).toEqual([730, 570, 1086940]);
    expect(all.slice(18, 99).map((i) => i.appid)).toEqual([900004, 900005]);
    expect(s.browse('', { flagsAll: free }).count).toBe(3);
    expect(s.browse('', { flagsNone: free | retired }).count).toBe(ROWS.length - 1 - 4);
    expect(
      s
        .browse('hollow')
        .slice(0, 200)
        .map((i) => i.appid),
    ).toEqual([367520, 1030300, 900005]);
    expect(
      s
        .browse('csgo')
        .slice(0, 9)
        .map((i) => i.appid),
    ).toEqual([730]);
    expect(s.browse('hollow', { flagsAll: soon }).count).toBe(1);
  });

  it('browse limita las ventanas a 200 filas', () => {
    const big = coreFromRows(
      Array.from({ length: 500 }, (_, i) => ({ appid: i + 1, name: `Game ${i}` })),
      { version: '20261028.1' },
    );
    const v = buildSearcher(big, []).browse('game');
    expect(v.count).toBe(500);
    expect(v.slice(100, 450)).toHaveLength(200);
  });
});

describe('construcción cooperativa', () => {
  it('pasa por none → scan → full con un reloj recibido', () => {
    let clock = 0;
    const b = createIndexBuilder(catalog, ALIASES, { now: () => clock++ });
    expect(b.state).toBe('none');
    expect(b.searcher).toBeNull();
    const states: string[] = [];
    let prev = 0;
    while (!b.step(clock)) {
      if (states[states.length - 1] !== b.state) states.push(b.state);
      expect(b.progress).toBeGreaterThanOrEqual(prev);
      prev = b.progress;
    }
    expect(states).toEqual(['none', 'scan']);
    expect(b.state).toBe('full');
    expect(b.progress).toBe(1);
    expect(b.searcher).toBe(b.result);
    expect(b.result?.state).toBe('full');
    expect(b.result?.version).toBe('20261028.1');
    expect(b.result?.count).toBe(ROWS.length);
  });

  it('el escaneo da los mismos resultados que el índice', () => {
    const [[, full], [, scan]] = both() as [[string, Searcher], [string, Searcher]];
    expect(scan.state).toBe('scan');
    const qs = [
      'h',
      'ho',
      'hol',
      'hollow k',
      'the',
      'a',
      'w',
      'wu',
      'x',
      '1',
      '2',
      'v',
      'iii',
      'c',
      'cs',
      'g',
      '三',
      'man',
    ];
    for (const q of qs) {
      for (const showAdult of [false, true]) {
        expect(scan.query(q, { showAdult }), q).toEqual(full.query(q, { showAdult }));
        expect(scan.browse(q, { showAdult }).count, q).toBe(full.browse(q, { showAdult }).count);
      }
    }
  });
});

describe('nivel 4', () => {
  let fuzzy: FuzzyMatcher;
  beforeAll(async () => {
    fuzzy = await loadFuzzy();
  });

  it('se ofrece con <5 fuertes y ≥4 caracteres latinos', () => {
    expect(canSuggest('witchr', 1)).toBe(true);
    expect(canSuggest('witchr', 5)).toBe(false);
    expect(canSuggest('wit', 0)).toBe(false);
    expect(canSuggest('三国志演义', 0)).toBe(false);
  });

  it('sugiere con erratas y excluye lo que ya está en la lista', () => {
    const s = buildSearcher(catalog, ALIASES);
    const r = s.query('hollow knigth');
    const task = s.suggest('hollow knigth', fuzzy, { exclude: r.items.map((i) => i.appid) });
    expect(task.step()).toBe(true);
    expect(task.items[0]).toMatchObject({ appid: 367520, tier: Tier.fuzzy });
    const excluded = s.suggest('hollow knigth', fuzzy, { exclude: [367520] });
    excluded.step();
    expect(excluded.items.map((i) => i.appid)).not.toContain(367520);
    const short = s.suggest('hol', fuzzy);
    expect(short.step()).toBe(true);
    expect(short.items).toEqual([]);
  });

  it('recorre bloques de 20 000 nombres, para al reunir el límite y se puede abandonar', () => {
    const n = FUZZY_BLOCK * 3 + 5;
    const big = coreFromRows(
      Array.from({ length: n }, (_, i) => ({ appid: i + 1, name: `Game ${i}` })),
      { version: '20261028.1' },
    );
    const s = buildSearcher(big, []);
    const calls: number[] = [];
    // Simula uFuzzy: coincide con las filas múltiplo de 25 000.
    const fake: FuzzyMatcher = {
      filter(hay, _needle) {
        calls.push(hay.length);
        const base = Number((hay[0] as string).split(' ')[1]);
        return hay.map((_, i) => i).filter((i) => (base + i) % 25_000 === 0);
      },
    };
    const t = s.suggest('game', fake, { limit: 3 });
    expect(t.step()).toBe(false);
    expect(t.items.map((i) => i.appid)).toEqual([1]);
    expect(t.step()).toBe(false);
    expect(t.items.map((i) => i.appid)).toEqual([1, 25_001]);
    expect(t.step()).toBe(true);
    expect(t.items.map((i) => i.appid)).toEqual([1, 25_001, 50_001]);
    expect(calls).toEqual([FUZZY_BLOCK, FUZZY_BLOCK, FUZZY_BLOCK]);
    // Abandonar es no seguir llamando a step(): no hay estado compartido que limpiar.
    const abandoned = s.suggest('game', fake);
    abandoned.step();
    expect(abandoned.items).toHaveLength(1);
  });

  it('las sugerencias van al final de la lista visible', () => {
    const s = buildSearcher(catalog, ALIASES);
    const main = s.query('h').items;
    const sugg = s.query('eldenring').items.map((i) => ({ ...i, tier: Tier.fuzzy }));
    const v = withSuggestions(main, sugg, 8);
    expect(v).toHaveLength(Math.min(8, main.length + sugg.length));
    expect(v[v.length - 1]?.tier).toBe(Tier.fuzzy);
  });
});
