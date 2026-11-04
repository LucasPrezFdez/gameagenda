// Lógica de cada puerta de publicación (§4.6) con entradas pequeñas.

import { parseCore, serializeCore } from '@gameagenda/core/catalog-format';
import { describe, expect, it } from 'vitest';
import {
  BOOT_ROWS,
  buildCatalogFiles,
  type CatalogFiles,
  hashedName,
  sha256,
} from '../src/catalog-files.ts';
import type { Game } from '../src/derive.ts';
import {
  countGate,
  deployProblems,
  type GateConfig,
  gatesPassed,
  integrityGate,
  PUBLISH_GATES,
  renamesGate,
  runGates,
  SENTINELS,
  searchGates,
  sentinelsGate,
  sizeGate,
} from '../src/gates.ts';

const cfg: GateConfig = PUBLISH_GATES;

function game(appid: number, name: string, reviews = 0): Game {
  return {
    appid,
    name,
    nameEs: '',
    flags: 0,
    year: 2020,
    reviews,
    pop: Math.min(63, Math.floor(2 * Math.log2(reviews + 1))),
    cls: 'visible',
    enrichedOn: '2026-10-29',
    details: [
      `steam/apps/${appid}/\${FILENAME}?t=1700000000`,
      'library_600x900.jpg',
      'header.jpg',
      [1577836800, 'day'],
      [8, reviews, 90],
      1,
      0,
    ],
  };
}

const GAMES: Game[] = [
  game(730, 'Counter-Strike 2', 9_000_000),
  game(570, 'Dota 2', 2_000_000),
  game(1245620, 'ELDEN RING', 800_000),
  game(1086940, "Baldur's Gate 3", 700_000),
  game(367520, 'Hollow Knight', 400_000),
  game(10, 'Counter-Strike', 200_000),
  game(1145360, 'Hades', 300_000),
];

function files(games: readonly Game[] = GAMES, bootRows?: number): CatalogFiles {
  return buildCatalogFiles(games, [['cs2', 730]], {
    version: '20261029.1',
    generatedAt: '2026-10-29T10:00:00Z',
    ...(bootRows === undefined ? {} : { bootRows }),
  });
}

/** Los mismos ficheros con otro núcleo de arranque, citado bien en el *manifest* (solo cambia él). */
function withBoot(f: CatalogFiles, bootText: string): CatalogFiles {
  const path = hashedName('boot', bootText);
  const json = JSON.parse(f.manifestText) as { files: Record<string, unknown> };
  json.files.boot = { path, sha256: sha256(bootText), bytes: Buffer.byteLength(bootText) };
  const map = new Map(f.files);
  map.delete(f.manifest.files.boot?.path as string);
  map.set(path, bootText);
  return { ...f, bootText, manifestText: `${JSON.stringify(json, null, 2)}\n`, files: map };
}

const bootRowsOf = (f: CatalogFiles): string[] => f.bootText.split('\n').slice(1, -1);
const coreRowsOf = (f: CatalogFiles): string[] => f.coreText.split('\n').slice(1, -1);

describe('recuento', () => {
  it('mínimo de 190 000 y, con versión anterior, entre −2 % y +5 %', () => {
    expect(countGate(189_999, null, cfg, false).status).toBe('fail');
    expect(countGate(197_031, null, cfg, false).status).toBe('pass');
    const prev = { count: 190_000, names: new Map() };
    expect(countGate(199_500, prev, cfg, false).status).toBe('pass');
    expect(countGate(199_501, prev, cfg, false).status).toBe('fail');
    expect(
      countGate(186_200, { ...prev, count: 190_000 }, { ...cfg, minGames: 1 }, false).status,
    ).toBe('pass');
    expect(countGate(186_199, prev, { ...cfg, minGames: 1 }, false).status).toBe('fail');
    // --skip-delta-gates mantiene el mínimo.
    expect(countGate(199_501, prev, cfg, true).status).toBe('pass');
    expect(countGate(189_999, prev, cfg, true).status).toBe('fail');
  });
});

describe('renombrados', () => {
  const prev = { count: 3, names: new Map(GAMES.map((g) => [g.appid, g.name])) };
  it('≤1 %; sin versión anterior o con --skip-delta-gates, se salta', () => {
    const names = new Map(GAMES.map((g) => [g.appid, g.name]));
    expect(renamesGate(names, null, cfg, false).status).toBe('skip');
    expect(renamesGate(names, prev, cfg, true).status).toBe('skip');
    expect(renamesGate(names, prev, cfg, false).status).toBe('pass');
    names.set(10, 'Counter-Strike 1.6');
    const r = renamesGate(names, prev, cfg, false);
    expect(r.status).toBe('fail');
    expect(r.data).toMatchObject({ renamed: 1, common: 7 });
    expect(renamesGate(names, prev, { ...cfg, maxRenamedPct: 20 }, false).status).toBe('pass');
  });
});

describe('centinelas, integridad y tamaño', () => {
  it('centinelas', () => {
    expect(SENTINELS).toEqual([730, 570, 1245620, 1086940, 367520]);
    expect(sentinelsGate(new Set(GAMES.map((g) => g.appid)), cfg).status).toBe('pass');
    const r = sentinelsGate(new Set([730, 570]), cfg);
    expect(r).toMatchObject({ status: 'fail', data: { missing: [1245620, 1086940, 367520] } });
  });

  it('integridad: hashes, rutas y recuentos del manifest; appid repetidos y alias huérfanos', () => {
    expect(integrityGate(files()).status).toBe('pass');
    const f = files();
    const tampered = {
      ...f,
      manifestText: f.manifestText.replace(f.manifest.files.core.sha256, '0'.repeat(64)),
    };
    expect(integrityGate(tampered).detail).toContain('sha256 de core');
    const dup = files([...GAMES, game(730, 'Otra vez CS2')]);
    expect(integrityGate(dup).detail).toContain('1 appid repetidos');
    const orphan = buildCatalogFiles(GAMES, [['zz', 999]], {
      version: '20261029.1',
      generatedAt: '2026-10-29T10:00:00Z',
    });
    expect(integrityGate(orphan).detail).toContain('1 alias sin juego');
    const broken = { ...f, coreText: `${f.coreText}xx\n` };
    expect(integrityGate(broken).status).toBe('fail');
  });

  it('tamaño: núcleo con brotli 11 y, por despliegue, ficheros de ≤25 MiB y ≤20 000', () => {
    const f = files();
    const r = sizeGate(f, cfg);
    expect(r.status).toBe('pass');
    // manifest, núcleo, boot, recent, alias, índice y los shards, dos veces, y `_headers`.
    const deployFiles = (6 + f.details.shards.size) * 2 + 1;
    expect(r.data).toMatchObject({ deployFiles, shards: { games: 7 } });
    expect(sizeGate(f, { ...cfg, maxCoreBrotliBytes: 10 }).detail).toContain('núcleo con');
    expect(sizeGate(f, { ...cfg, maxFileBytes: 100 }).status).toBe('fail');
    expect(sizeGate(f, { ...cfg, maxDeployFiles: deployFiles - 1 }).detail).toContain(
      `${deployFiles} ficheros`,
    );
    expect(deployProblems([{ path: 'core.x.tsv', bytes: 26 * 1024 * 1024 }], cfg)[0]).toContain(
      'core.x.tsv',
    );
  });

  it('tamaño: mide el núcleo de arranque y falla por encima de su máximo con brotli 11', () => {
    expect(cfg.maxBootBrotliBytes).toBe(512 * 1024);
    const f = files(GAMES, 3);
    const r = sizeGate(f, cfg);
    expect(r.status).toBe('pass');
    expect(r.data).toMatchObject({
      boot: { rows: 3, raw: Buffer.byteLength(f.bootText) },
    });
    const boot = (r.data as { boot: { brotli11: number; gzip6: number } }).boot;
    expect(boot.brotli11).toBeGreaterThan(0);
    expect(boot.gzip6).toBeGreaterThan(0);
    expect(r.detail).toContain('boot 3 filas');
    const small = sizeGate(f, { ...cfg, maxBootBrotliBytes: 10 });
    expect(small.status).toBe('fail');
    expect(small.detail).toMatch(/^boot con brotli 11 .* > 0\.0 KB/);
  });
});

describe('núcleo de arranque (boot) en la integridad', () => {
  it('por defecto, las BOOT_ROWS primeras filas; con un núcleo más corto, todas', () => {
    expect(BOOT_ROWS).toBe(20_000);
    const f = files();
    expect(f.bootRows).toBe(BOOT_ROWS);
    expect(f.manifest.counts.boot).toBe(GAMES.length);
    expect(bootRowsOf(f)).toEqual(coreRowsOf(f));
    expect(f.bootText.startsWith('#gacat-boot v1\t20261029.1\t')).toBe(true);
    expect(f.manifest.files.boot?.path).toMatch(/^boot\.[0-9a-f]{16}\.tsv$/);
    expect(f.files.get(f.manifest.files.boot?.path as string)).toBe(f.bootText);
    // Solo cambia la cabecera: mismo tamaño que el núcleo, otro hash.
    expect(f.manifest.files.boot?.bytes).toBe(f.manifest.files.core.bytes);
    expect(f.manifest.files.boot?.sha256).not.toBe(f.manifest.files.core.sha256);
    expect(integrityGate(f)).toMatchObject({ status: 'pass' });
    expect(integrityGate(f).detail).toContain('boot (7 filas, prefijo del núcleo)');
    expect(integrityGate(files(GAMES, 100)).status).toBe('pass');
    expect(files(GAMES, 100).manifest.counts.boot).toBe(7);
  });

  it('con un corte menor, exactamente las primeras filas del núcleo, en su orden', () => {
    const f = files(GAMES, 3);
    expect(f.manifest.counts.boot).toBe(3);
    expect(bootRowsOf(f)).toEqual(coreRowsOf(f).slice(0, 3));
    const boot = parseCore(f.bootText, 'boot');
    expect([...boot.appid]).toEqual([730, 570, 1245620]);
    expect(integrityGate(f).status).toBe('pass');
    expect(() => files(GAMES, 0)).toThrow(/bootRows/);
  });

  it('un boot alterado, que no es el prefijo del núcleo o de otra versión, no pasa', () => {
    const f = files(GAMES, 3);
    const tampered = {
      ...f,
      manifestText: f.manifestText.replace(f.manifest.files.boot?.sha256 as string, '0'.repeat(64)),
    };
    expect(integrityGate(tampered).detail).toContain('sha256 de boot');
    // Una fila cambiada (bien citada en el manifest): no es el prefijo.
    const [head, a, b, c] = f.bootText.split('\n') as [string, string, string, string];
    const changed = withBoot(f, [head, a.replace('Counter-Strike 2', 'CS2'), b, c, ''].join('\n'));
    expect(integrityGate(changed).detail).toContain('la fila 1 de boot no es la del núcleo');
    const swapped = withBoot(f, [head, b, a, c, ''].join('\n'));
    expect(integrityGate(swapped).detail).toContain('la fila 1 de boot no es la del núcleo');
    // Otra versión en la cabecera.
    const other = withBoot(f, f.bootText.replace('20261029.1', '20261028.1'));
    expect(integrityGate(other).detail).toContain('versión de boot ≠ núcleo');
    // Una fila de menos (y counts.boot sin tocar).
    const short = withBoot(f, [head, a, b, ''].join('\n'));
    expect(integrityGate(short).detail).toContain('boot con 2 filas, no 3');
    // Con la cabecera del núcleo no se lee como boot.
    const asCore = withBoot(f, f.bootText.replace('#gacat-boot', '#gacat-core'));
    expect(integrityGate(asCore).detail).toContain('boot: ');
    // El fichero citado no está entre los publicados.
    const missingFile = new Map(f.files);
    missingFile.delete(f.manifest.files.boot?.path as string);
    expect(integrityGate({ ...f, files: missingFile }).detail).toContain('fichero de boot');
  });

  it('counts.boot distinto de las filas y un manifest sin files.boot o sin counts.boot no pasan', () => {
    const f = files(GAMES, 3);
    const wrongCount = { ...f, manifestText: f.manifestText.replace('"boot": 3,', '"boot": 4,') };
    expect(wrongCount.manifestText).not.toBe(f.manifestText);
    expect(integrityGate(wrongCount).detail).toContain('counts.boot ≠ filas de boot');
    const json = JSON.parse(f.manifestText) as {
      counts: Record<string, unknown>;
      files: Record<string, unknown>;
    };
    const { boot: _file, ...filesNoBoot } = json.files;
    const noFile = { ...f, manifestText: JSON.stringify({ ...json, files: filesNoBoot }) };
    expect(integrityGate(noFile).detail).toContain('falta files.boot');
    const { boot: _count, ...countsNoBoot } = json.counts;
    const noCount = { ...f, manifestText: JSON.stringify({ ...json, counts: countsNoBoot }) };
    expect(integrityGate(noCount).detail).toContain('falta counts.boot');
  });
});

describe('recent y shards en la integridad', () => {
  it('recent con un juego que no está en el núcleo, o que cambia el núcleo, no pasa', () => {
    const f = files();
    const extra = serializeCore([{ appid: 999, name: 'Nadie' }], {
      version: '20261029.1',
      kind: 'recent',
    });
    expect(integrityGate({ ...f, recentText: extra }).detail).toContain('sin juego en el núcleo');
    const changed = serializeCore([{ appid: 570, name: 'Dota 3' }], {
      version: '20261029.1',
      kind: 'recent',
    });
    expect(integrityGate({ ...f, recentText: changed }).detail).toContain('lo cambia');
  });

  it('un shard alterado, que falta o con un juego en el shard equivocado, no pasa', () => {
    const f = files();
    const [path, text] = [...f.details.shards][0] as [string, string];
    const files2 = new Map(f.files);
    files2.set(path, text.replace('"day"', '"year"'));
    expect(integrityGate({ ...f, files: files2 }).detail).toContain(`hash de ${path}`);
    expect(integrityGate({ ...f, files: files2 }).status).toBe('fail');
    const files3 = new Map(f.files);
    files3.delete(path);
    expect(integrityGate({ ...f, files: files3 }).detail).toContain(`falta ${path}`);
    const files4 = new Map(f.files);
    const wrong = JSON.parse(text) as Record<string, unknown>;
    wrong['1'] = Object.values(wrong)[0];
    files4.set(path, JSON.stringify(wrong));
    expect(integrityGate({ ...f, files: files4 }).status).toBe('fail');
  });
});

describe('búsqueda', () => {
  it('consultas de humo en el índice construido con core', async () => {
    const { loadFuzzy } = await import('@gameagenda/core/search');
    const fuzzy = await loadFuzzy();
    const smoke = searchGates(files(), fuzzy, [], { ...cfg, quality: 'smoke' });
    expect(smoke[0]).toMatchObject({ id: 'smoke', status: 'pass' });
    expect(smoke.slice(1).every((g) => g.status === 'skip')).toBe(true);
    expect(smoke[0]?.detail).toContain('en boot (7 filas): las 4 también ✓');
    expect(smoke[0]?.data).toMatchObject({ core: { length: 4 }, boot: { length: 4 } });
    const sinHollow = files(GAMES.filter((g) => g.appid !== 367520));
    expect(searchGates(sinHollow, fuzzy, [], { ...cfg, quality: 'smoke' })[0]?.status).toBe('fail');
    // En el núcleo están los cuatro, pero el boot de 3 filas no tiene Hollow Knight ni BG3.
    const shortBoot = searchGates(files(GAMES, 3), fuzzy, [], { ...cfg, quality: 'smoke' })[0];
    expect(shortBoot?.status).toBe('fail');
    expect(shortBoot?.detail).toMatch(/^«hollow knight» → 367520 ✓/);
    expect(shortBoot?.detail).toMatch(/en boot \(3 filas\): «hollow knight» → 367520 ✗/);
    // Con todas las puertas, un catálogo de 7 juegos no pasa el dorado (60 consultas como mínimo).
    const full = searchGates(
      files(),
      fuzzy,
      [{ q: 'hades', appids: [1145360], category: 'x' }],
      cfg,
    );
    expect(full.find((g) => g.id === 'golden')?.status).toBe('fail');
  });

  it('si falla la integridad, no se ejecutan las de búsqueda y no se publica', async () => {
    const f = files();
    const gates = await runGates({
      files: { ...f, coreText: 'basura' },
      names: new Map(GAMES.map((g) => [g.appid, g.name])),
      previous: null,
      skipDelta: false,
      golden: [],
      cfg: { ...cfg, minGames: 1 },
      fuzzy: { filter: () => [] },
    });
    expect(gates.find((g) => g.id === 'integrity')?.status).toBe('fail');
    expect(gates.filter((g) => ['smoke', 'golden'].includes(g.id)).map((g) => g.status)).toEqual([
      'skip',
      'skip',
    ]);
    expect(gatesPassed(gates)).toBe(false);
  });
});
