import { describe, expect, it } from 'vitest';
import {
  CatalogFlag,
  CatalogFormatError,
  type CatalogManifest,
  catalogManifestSchema,
  coreFromRows,
  coreRowAt,
  createCoreReader,
  parseAliases,
  parseCore,
  runToEnd,
  serializeAliases,
  serializeCore,
} from '../src/catalog-format/index.ts';

const HEAD = '#gacat-core v1\t20261028.1\tappid\tname\tnameEs\tflags\tyear\tpop';
// El ejemplo de la §7.6.
const SAMPLE = `${HEAD}\n730\tCounter-Strike 2\t\t8\t2012\t46\n105600\tTerraria\t\t\t2011\t40\n247710\tBattledroid\t\t41\t\t\n`;

describe('núcleo TSV', () => {
  it('lee el ejemplo de la §7.6 en columnas', () => {
    const c = parseCore(SAMPLE);
    expect(c.version).toBe('20261028.1');
    expect(c.count).toBe(3);
    expect([...c.appid]).toEqual([730, 105600, 247710]);
    expect(c.name).toEqual(['Counter-Strike 2', 'Terraria', 'Battledroid']);
    expect([...c.flags]).toEqual([8, 0, 41]);
    expect([...c.year]).toEqual([2012, 2011, 0]);
    expect([...c.pop]).toEqual([46, 40, 0]);
    expect(c.nameEs.size).toBe(0);
    expect(coreRowAt(c, 2)).toEqual({
      appid: 247710,
      name: 'Battledroid',
      nameEs: null,
      flags: CatalogFlag.soon | CatalogFlag.free | CatalogFlag.tba,
      year: null,
      pop: 0,
    });
  });

  it('ida y vuelta: escribir lo leído da los mismos bytes', () => {
    expect(serializeCore(parseCore(SAMPLE), { version: '20261028.1' })).toBe(SAMPLE);
  });

  it('escribe filas: nameEs igual al nombre y ceros vacíos; tabuladores y saltos → espacio', () => {
    const text = serializeCore(
      [
        {
          appid: 1030840,
          name: 'Mafia: Definitive Edition',
          nameEs: 'Mafia: Edición Definitiva',
          pop: 30,
        },
        { appid: 10, name: 'Counter\tStrike\r\n', nameEs: 'Counter\tStrike\r\n', year: 2000 },
      ],
      { version: '20261029.2', kind: 'recent' },
    );
    expect(text).toBe(
      '#gacat-recent v1\t20261029.2\tappid\tname\tnameEs\tflags\tyear\tpop\n' +
        '1030840\tMafia: Definitive Edition\tMafia: Edición Definitiva\t\t\t30\n' +
        '10\tCounter Strike  \t\t\t2000\t\n',
    );
    const back = parseCore(text, 'recent');
    expect(back.kind).toBe('recent');
    expect(back.nameEs.get(0)).toBe('Mafia: Edición Definitiva');
  });

  it('acepta un fichero sin salto de línea final', () => {
    expect(parseCore(SAMPLE.slice(0, -1)).count).toBe(3);
  });

  it.each([
    ['cabecera ajena', SAMPLE.replace('#gacat-core', '#gacat-boot')],
    ['versión mal formada', SAMPLE.replace('20261028.1', '2026-10-28')],
    ['columnas distintas', SAMPLE.replace('\tpop', '\tpopularity')],
    ['faltan columnas', `${HEAD}\n730\tCounter-Strike 2\t\t8\t2012\n`],
    ['sobran columnas', `${HEAD}\n730\tCounter-Strike 2\t\t8\t2012\t46\tx\n`],
    ['appid 0', `${HEAD}\n0\tX\t\t\t\t\n`],
    ['appid con ceros a la izquierda', `${HEAD}\n0730\tX\t\t\t\t\n`],
    ['appid no numérico', `${HEAD}\n73a\tX\t\t\t\t\n`],
    ['flags fuera de rango', `${HEAD}\n730\tX\t\t64\t\t\n`],
    ['pop fuera de rango', `${HEAD}\n730\tX\t\t\t\t64\n`],
    ['nombre vacío', `${HEAD}\n730\t\t\t\t\t\n`],
    ['CRLF', `${HEAD}\n730\tX\t\t\t\t1\r\n`],
    ['línea vacía', `${HEAD}\n730\tX\t\t\t\t\n\n731\tY\t\t\t\t\n`],
  ])('rechaza %s', (_, text) => {
    expect(() => parseCore(text)).toThrow(CatalogFormatError);
  });

  it('indica la línea del error', () => {
    try {
      parseCore(`${HEAD}\n730\tX\t\t\t\t\n731\tY\t\t99\t\t\n`);
      expect.unreachable();
    } catch (e) {
      expect((e as CatalogFormatError).line).toBe(3);
    }
  });

  it('el lector cooperativo da lo mismo, a trozos y con avance', () => {
    const rows = Array.from({ length: 10_000 }, (_, i) => ({
      appid: i + 1,
      name: `Game ${i}`,
      pop: 5,
    }));
    const text = serializeCore(rows, { version: '20261028.1' });
    let clock = 0;
    const reader = createCoreReader(text, { now: () => clock++ });
    const seen: number[] = [];
    let steps = 0;
    // Plazo ya vencido: un trozo por llamada.
    while (!reader.step(clock)) {
      seen.push(reader.progress);
      steps++;
    }
    expect(steps).toBeGreaterThan(3);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(reader.progress).toBe(1);
    const c = reader.result;
    expect(c?.count).toBe(10_000);
    expect(c?.name[9999]).toBe('Game 9999');
    expect(runToEnd(createCoreReader(text, { now: () => 0 })).count).toBe(10_000);
  });

  it('coreFromRows valida las filas', () => {
    expect(() => coreFromRows([{ appid: 1.5, name: 'X' }], { version: '20261028.1' })).toThrow(
      CatalogFormatError,
    );
    expect(() => coreFromRows([{ appid: 1, name: '' }], { version: '20261028.1' })).toThrow(
      CatalogFormatError,
    );
    expect(() => coreFromRows([], { version: 'v1' })).toThrow(CatalogFormatError);
  });
});

describe('alias TSV', () => {
  const TEXT =
    '#gacat-aliases v1\t20261028.1\talias\tappid\nbg3\t1086940\ncs2\t730\ncs2\t1599340\n';

  it('lee pares alias → appid (un alias admite varios)', () => {
    const a = parseAliases(TEXT);
    expect(a.version).toBe('20261028.1');
    expect(a.pairs).toEqual([
      ['bg3', 1086940],
      ['cs2', 730],
      ['cs2', 1599340],
    ]);
  });

  it('escribe ordenado y sin repetidos', () => {
    const text = serializeAliases(
      [
        ['cs2', 1599340],
        ['bg3', 1086940],
        ['cs2', 730],
        ['bg3', 1086940],
      ],
      { version: '20261028.1' },
    );
    expect(text).toBe(TEXT);
  });

  it.each([
    ['sin appid', '#gacat-aliases v1\t20261028.1\talias\tappid\nbg3\n'],
    ['alias vacío', '#gacat-aliases v1\t20261028.1\talias\tappid\n\t730\n'],
    ['cabecera de núcleo', `${HEAD}\n`],
  ])('rechaza %s', (_, text) => {
    expect(() => parseAliases(text)).toThrow(CatalogFormatError);
  });

  it('no escribe alias con tabuladores', () => {
    expect(() => serializeAliases([['a\tb', 1]], { version: '20261028.1' })).toThrow(
      CatalogFormatError,
    );
  });
});

describe('manifest', () => {
  const sha = 'a'.repeat(64);
  const M1 = {
    format: 'gacat',
    v: 1,
    version: '20261028.1',
    generatedAt: '2026-10-28T03:17:00Z',
    counts: { core: 196665, aliases: 3563 },
    files: {
      core: { path: 'core.aaaaaaaaaaaaaaaa.tsv', sha256: sha, bytes: 7_000_000 },
      aliases: { path: 'aliases.aaaaaaaaaaaaaaaa.tsv', sha256: sha, bytes: 45_152 },
    },
    enrichmentAgeDays: 0,
    minClientVersion: '0.1.0',
  };

  it('admite el manifest de M1 (sin firma, kill switches, recientes ni detalles)', () => {
    const m: CatalogManifest = catalogManifestSchema.parse(M1);
    expect(m.files.recent).toBeUndefined();
    expect(m.sig).toBeUndefined();
  });

  it('admite los campos de M2 y descarta los desconocidos', () => {
    const m = catalogManifestSchema.parse({
      ...M1,
      futureField: true,
      counts: { ...M1.counts, recent: 4000 },
      files: {
        ...M1.files,
        recent: { path: 'recent.bbbbbbbbbbbbbbbb.tsv', sha256: sha, bytes: 140_000 },
        details: { path: 'details/index.cccccccccccccccc.json', sha256: sha, bytes: 30_000 },
      },
      killSwitches: { covers: false, details: false },
      sig: { kid: 'k1', ed25519: 'AbC-_d==' },
    });
    expect(m.killSwitches?.covers).toBe(false);
    expect('futureField' in m).toBe(false);
  });

  it.each([
    ['otra versión del formato', { ...M1, v: 2 }],
    ['versión mal formada', { ...M1, version: '2026.10.28' }],
    ['fecha no ISO', { ...M1, generatedAt: '28-10-2026' }],
    ['sha256 corto', { ...M1, files: { ...M1.files, core: { ...M1.files.core, sha256: 'abc' } } }],
    [
      'ruta absoluta',
      { ...M1, files: { ...M1.files, core: { ...M1.files.core, path: '/core.tsv' } } },
    ],
    [
      'ruta con ..',
      { ...M1, files: { ...M1.files, core: { ...M1.files.core, path: '../x.tsv' } } },
    ],
    ['sin núcleo', { ...M1, files: { aliases: M1.files.aliases } }],
    ['recuento negativo', { ...M1, counts: { core: -1, aliases: 0 } }],
    ['minClientVersion no SemVer', { ...M1, minClientVersion: 'v0.1' }],
  ])('rechaza: %s', (_, value) => {
    expect(catalogManifestSchema.safeParse(value).success).toBe(false);
  });
});
