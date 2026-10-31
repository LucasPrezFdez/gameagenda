// Pipeline con fixtures (§12.1): pasos 0–5 con clave y en el plan B sin clave, determinismo
// (las mismas entradas dan los mismos bytes), volver a derivar desde las páginas crudas sin red,
// estado, informe de cobertura y la orden `catalog:build -- --source=fixtures`.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CatalogFlag,
  catalogManifestSchema,
  parseCore,
  trustedSigningKeys,
} from '@gameagenda/core/catalog-format';
import { afterAll, describe, expect, it } from 'vitest';
import { coverageReport, frozenDiff } from '../src/coverage.ts';
import { RawStore } from '../src/raw-store.ts';
import { type BuildResult, buildCatalog, FIXTURES_PROFILE, versionFor } from '../src/run.ts';
import { verifyManifest } from '../src/signing.ts';
import { readState, serializeState, writeState } from '../src/state.ts';
import { SteamClient, type Transport } from '../steam/client.ts';
import { fixtureTransport } from '../steam/transports.ts';
import { fakeRuntime, recordedFixtures, statePath } from './helpers.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RUN_AT = Date.parse('2026-10-29T14:30:00Z');
const tmp: string[] = [];
afterAll(() => {
  for (const d of tmp) rmSync(d, { recursive: true, force: true });
});
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'ga-pipeline-'));
  tmp.push(d);
  return d;
}

async function build(
  keyless: boolean,
  transport: Transport = fixtureTransport(recordedFixtures()),
  cache: RawStore | null = null,
  offline = false,
): Promise<{ result: BuildResult; client: SteamClient }> {
  const rt = fakeRuntime();
  const client = new SteamClient({ transport, ...rt, key: null, cache, offline });
  const result = await buildCatalog(client, {
    keyless,
    profile: FIXTURES_PROFILE,
    state: readState(statePath()).rows,
    dump: null,
    frozen: null,
    golden: [],
    skipDeltaGates: false,
    runAt: RUN_AT,
    previousVersion: null,
    now: rt.now,
    log: () => {},
  });
  return { result, client };
}

const row = (r: BuildResult, appid: number) => r.games.find((g) => g.appid === appid);

describe('con clave (lista de GetAppList, sintética en los fixtures)', async () => {
  const { result: r, client } = await build(false);

  it('pasa las puertas y no sale de los fixtures', () => {
    expect(r.ok).toBe(true);
    expect(r.version).toBe('20261029.1');
    expect(client.records.every((x) => x.status === 200)).toBe(true);
    expect(r.gates.find((g) => g.id === 'renames')?.status).toBe('skip');
  });

  it('clasifica y excluye como la §4.9', () => {
    expect(r.inputs.h1.length).toBeGreaterThan(0);
    expect(r.inputs.h2).toEqual([50300, 241560, 271590, 1293830, 3158110, 999999999]);
    for (const a of [50300, 241560, 271590, 1293830, 3158110]) {
      expect(row(r, a)).toMatchObject({ cls: 'retired' });
      expect((row(r, a)?.flags ?? 0) & CatalogFlag.retired).toBe(CatalogFlag.retired);
    }
    expect(row(r, 21130)?.cls).toBe('blocked');
    expect(row(r, 35030)).toMatchObject({ cls: 'blocked', name: 'Championship Manager 2010' });
    expect(Object.fromEntries(r.excluded.map((e) => [e.appid, e.reason]))).toEqual({
      22490: 'duplicate-sku',
      396420: 'empty-name',
      473930: 'not-game',
      639770: 'blacklist',
      708030: 'empty-name',
      866490: 'blacklist',
      999999999: 'deleted',
      1025620: 'blacklist',
    });
    expect(row(r, 837470)?.name).toBe('Untitled Goose Game');
    expect(row(r, 360430)).toMatchObject({
      name: 'Mafia III: Definitive Edition',
      nameEs: 'Mafia III: Edición Definitiva',
    });
    expect(row(r, 730)).toMatchObject({ pop: 46, flags: CatalogFlag.free, year: 2012 });
    expect(row(r, 4354570)?.flags).toBe(CatalogFlag.soon);
    expect(row(r, 4018990)?.flags).toBe(CatalogFlag.soon | CatalogFlag.tba);
    expect(row(r, 644560)?.flags).toBe(CatalogFlag.adult);
  });

  it('escribe núcleo, recent, alias, shards y manifest de M2 con los serializadores de core', () => {
    const m = catalogManifestSchema.parse(JSON.parse(r.files.manifestText));
    expect(Object.keys(m).sort()).toEqual([
      'counts',
      'enrichmentAgeDays',
      'files',
      'format',
      'generatedAt',
      'killSwitches',
      'minClientVersion',
      'v',
      'version',
    ]);
    expect(Object.keys(m.files).sort()).toEqual(['aliases', 'core', 'details', 'recent']);
    expect(m).toMatchObject({
      enrichmentAgeDays: 0,
      minClientVersion: '0.0.0',
      killSwitches: { covers: false, details: false },
    });
    expect(m.files.core.path).toMatch(/^core\.[0-9a-f]{16}\.tsv$/);
    expect(m.files.details?.path).toMatch(/^details\/index\.[0-9a-f]{16}\.json$/);
    // El estado de los fixtures solo tiene los retirados: todo lo demás es alta.
    expect(m.counts.recent).toBe(r.games.length - 5);
    expect(parseCore(r.files.recentText, 'recent').count).toBe(m.counts.recent);
    const core = parseCore(r.files.coreText);
    expect(core.count).toBe(r.games.length);
    expect(core.appid[0]).toBe(730);
    // Los retirados, al final.
    expect((core.flags[core.count - 1] ?? 0) & CatalogFlag.retired).toBe(CatalogFlag.retired);
  });
});

describe('plan B sin clave', async () => {
  const { result: r, client } = await build(true);

  it('no pide GetAppList: L := ids de Q, sin H1', () => {
    expect(client.records.some((x) => x.endpoint === 'getapplist')).toBe(false);
    expect(r.inputs.list).toBeNull();
    expect(r.inputs.h1).toEqual([]);
    const q = new Set(r.inputs.query.items.keys());
    expect(r.games.filter((g) => !q.has(g.appid)).every((g) => g.cls === 'retired')).toBe(true);
  });

  it('pide en inglés los nombres que parecen españoles y, sin centinelas, no publica', () => {
    expect(r.inputs.baseNamesAsked).toBe(2);
    expect(r.ok).toBe(false);
    expect(r.gates.find((g) => g.id === 'sentinels')?.status).toBe('fail');
  });
});

describe('determinismo y páginas crudas', () => {
  it('las mismas entradas dan los mismos bytes', async () => {
    const a = (await build(false)).result;
    const b = (await build(false)).result;
    expect(b.files.coreText).toBe(a.files.coreText);
    expect(b.files.aliasesText).toBe(a.files.aliasesText);
    expect(b.files.manifestText).toBe(a.files.manifestText);
    expect(serializeState(b.state)).toBe(serializeState(a.state));
  });

  it('vuelve a derivar sin red desde las páginas crudas', async () => {
    const dir = tempDir();
    const now = () => RUN_AT;
    const first = (await build(false, fixtureTransport(recordedFixtures()), new RawStore(dir, now)))
      .result;
    expect(readdirSync(dir).some((f) => f.startsWith('query-000015'))).toBe(true);
    const noNetwork: Transport = async () => {
      throw new Error('sin red');
    };
    const again = await build(false, noNetwork, new RawStore(dir, now), true);
    expect(again.client.records.every((x) => x.cached)).toBe(true);
    expect(again.result.files.coreText).toBe(first.files.coreText);
  });
});

describe('estado, versión e informes', () => {
  it('el estado se escribe y se vuelve a leer igual (gzip), con su cabecera', async () => {
    const { result } = await build(false);
    const f = join(tempDir(), 'master.ndjson.gz');
    writeState(f, result.state, result.stateMeta);
    const back = readState(f);
    expect([...back.rows.values()]).toEqual(result.state);
    expect(back.meta).toEqual({ version: '20261029.1', enrichedOn: '2026-10-29' });
    expect(result.state.some((r) => r.details)).toBe(true);
    expect(readState(join(tempDir(), 'no-existe.ndjson.gz')).rows.size).toBe(0);
    // El estado de M1, sin cabecera: el último enriquecimiento sale de las filas.
    expect(readState(statePath()).meta).toEqual({ version: null, enrichedOn: '2026-10-29' });
  });

  it('AAAAMMDD.N en Europe/Madrid', () => {
    expect(versionFor(Date.parse('2026-10-29T22:30:00Z'), null)).toBe('20261029.1');
    expect(versionFor(Date.parse('2026-10-29T23:30:00Z'), null)).toBe('20261030.1');
    expect(versionFor(RUN_AT, '20261029.1')).toBe('20261029.2');
    expect(versionFor(RUN_AT, '20261028.3')).toBe('20261029.1');
  });

  it('cobertura del CA1.1: cada juego del volcado está en el núcleo o tiene motivo', async () => {
    const { result } = await build(false);
    const dump = [
      { appid: 730, name: 'Counter-Strike 2' },
      { appid: 22490, name: 'Fallout: New Vegas' },
      { appid: 396420, name: '' },
      { appid: 4000000001, name: 'Juego Bloqueado' },
      { appid: 4000000005, name: 'Sin clasificar' },
    ];
    const c = coverageReport({
      dump,
      games: result.games,
      excluded: result.excluded,
      classified: new Map([
        [
          4000000001,
          { cls: 'blocked', item: null, country: 'US', reason: 'bloqueado en ES, visible en US' },
        ],
      ]),
    });
    expect(c.inCore).toBe(1);
    expect(c.byReason).toEqual({ 'duplicate-sku': 1, 'blocked-es': 1, unexplained: 1 });
    expect(c.emptyNamed).toEqual({ total: 1, completed: [], excluded: [[396420, 'empty-name']] });
    const core = parseCore(result.files.coreText);
    const d = frozenDiff(core, result.games);
    expect(d).toMatchObject({
      common: result.games.length,
      added: 0,
      removed: 0,
      renamed: { count: 0 },
    });
  });
});

/** Ficheros de `dir` (con `details/`), ordenados, con su contenido. */
function listing(dir: string): Array<[string, string]> {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) =>
      join(e.parentPath, e.name)
        .slice(dir.length + 1)
        .replaceAll('\\', '/'),
    )
    .sort()
    .map((f) => [f, readFileSync(join(dir, f), 'utf8')]);
}

function catalogBuild(args: readonly string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, ['pipeline/build.ts', '--source=fixtures', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      STEAM_MODE: 'fixtures',
      STEAM_WEB_API_KEY: '',
      CATALOG_SIGNING_KEY: '',
      ...env,
    },
  });
}

describe('npm run catalog:build -- --source=fixtures', () => {
  it('construye sin red, firma con --dev-sign y dos veces da los mismos bytes', {
    timeout: 60_000,
  }, () => {
    const outs = [tempDir(), tempDir()];
    for (const out of outs) {
      const p = catalogBuild([`--out=${out}`, '--dev-sign']);
      expect(p.status, p.stderr).toBe(0);
    }
    const [a, b] = outs.map(listing);
    const names = a?.map(([f]) => f) ?? [];
    expect(names).toContain('manifest.json');
    expect(names.some((f) => /^details\/index\.[0-9a-f]{16}\.json$/.test(f))).toBe(true);
    expect(names.some((f) => /^details\/\d{4}\.[0-9a-f]{16}\.json$/.test(f))).toBe(true);
    expect(names.some((f) => /^recent\.[0-9a-f]{16}\.tsv$/.test(f))).toBe(true);
    // ed25519 es determinista: la firma también sale igual.
    expect(b).toEqual(a);
    const m = JSON.parse(readFileSync(join(outs[0] as string, 'manifest.json'), 'utf8'));
    expect(m).toMatchObject({ minClientVersion: '0.2.0', sig: { kid: 'dev-1' } });
    expect(verifyManifest(m, trustedSigningKeys({ dev: true }))).toBe(true);
    expect(verifyManifest(m, trustedSigningKeys({ dev: false }))).toBe(false);
  });

  it('si falla una puerta sale con 1 y no toca --out (CA2.2)', { timeout: 60_000 }, () => {
    const out = tempDir();
    expect(catalogBuild([`--out=${out}`]).status).toBe(0);
    const before = listing(out);
    // Sin clave, los fixtures no traen los centinelas que salen de GetAppList.
    const p = catalogBuild([`--out=${out}`, '--keyless', '--dev-sign']);
    expect(p.status).toBe(1);
    expect(p.stdout).toContain('✗ sentinels');
    expect(listing(out)).toEqual(before);
    const rejected = listing(`${out}-rejected`);
    const m = JSON.parse(rejected.find(([f]) => f === 'manifest.json')?.[1] ?? '{}');
    // Lo rechazado no se firma.
    expect(m.sig).toBeUndefined();
  });

  it('una etapa que falla sale con 2; una clave de producción fuera de Actions, también', {
    timeout: 60_000,
  }, () => {
    const out = tempDir();
    const bad = join(tempDir(), 'kill-switches.json');
    writeFileSync(bad, '{"covers": "sí"}');
    expect(catalogBuild([`--out=${out}`, `--kill-switches=${bad}`]).status).toBe(2);
    const p = catalogBuild([`--out=${out}`], {
      CATALOG_SIGNING_KEY: readFileSync(join(ROOT, 'fixtures/signing/dev-catalog-key.pem'), 'utf8'),
      CATALOG_SIGNING_KID: 'prod-1',
    });
    expect(p.status).toBe(2);
    expect(p.stderr).toContain('kid «prod-1» desconocido');
    expect(catalogBuild([`--out=${out}`, '--dev-sign', '--require-signature']).status).toBe(2);
    expect(readdirSync(out)).toEqual([]);
  });
});
