// `npm run catalog:build` (§13.3): pasos 0–5 de la §4.5 y catálogo de M1 en `pipeline/out/`
// (núcleo, alias y *manifest* sin firma). El paso 6, publicar, queda fuera en M1.
//
//   npm run catalog:build                                  con STEAM_WEB_API_KEY, con clave;
//                                                          sin ella, plan B (§4.8)
//   npm run catalog:build -- --keyless                     plan B aunque haya clave
//   npm run catalog:build -- --compare=<volcado.json>      informe de cobertura del CA1.1
//   npm run catalog:build -- --skip-delta-gates            sin las puertas que comparan
//   npm run catalog:build -- --from-raw=pipeline/state/raw-AAAA-MM-DD
//                                                          vuelve a derivar sin red
//   npm run catalog:build -- --source=fixtures --out=<dir> desde fixtures/steam/, sin red
//
// Si una puerta falla, no se escribe `--out`: el catálogo va a `pipeline/state/rejected/<versión>/`
// (con `--source=fixtures`, a `<out>-rejected/`) y el proceso sale con error.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { type CoreCatalog, parseCore } from '@gameagenda/core/catalog-format';
import { parseGolden } from '@gameagenda/core/search-quality';
import { writeCatalog } from './src/catalog-files.ts';
import { madridDate, realRuntime } from './src/clock.ts';
import { readDump } from './src/coverage.ts';
import { FIXTURE_DIRS } from './src/fixtures.ts';
import { RawStore } from './src/raw-store.ts';
import { type BuildResult, buildCatalog, FIXTURES_PROFILE, STEAM_PROFILE } from './src/run.ts';
import { readState, writeState } from './src/state.ts';
import { SteamClient, SteamError, type Transport } from './steam/client.ts';
import { fixtureTransport, httpsTransport, readFixtures } from './steam/transports.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const at = (p: string): string => join(ROOT, p);
const userPath = (p: string): string => (isAbsolute(p) ? p : resolve(process.cwd(), p));

const { values: args } = parseArgs({
  options: {
    source: { type: 'string', default: 'steam' },
    out: { type: 'string' },
    compare: { type: 'string' },
    keyless: { type: 'boolean', default: false },
    'skip-delta-gates': { type: 'boolean', default: false },
    'from-raw': { type: 'string' },
    raw: { type: 'string' },
    state: { type: 'string' },
    'report-dir': { type: 'string' },
    version: { type: 'string' },
    now: { type: 'string' },
    fixtures: { type: 'string' },
  },
  strict: true,
});

function previousVersion(dir: string): string | null {
  const f = join(dir, 'manifest.json');
  if (!existsSync(f)) return null;
  try {
    return (JSON.parse(readFileSync(f, 'utf8')) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
}

function readFrozen(): CoreCatalog | null {
  const dir = at('fixtures/catalog-frozen/');
  if (!existsSync(dir)) return null;
  const f = readdirSync(dir).find((n) => /^core\..+\.tsv\.gz$/.test(n));
  return f ? parseCore(gunzipSync(readFileSync(join(dir, f))).toString('utf8')) : null;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 1)}\n`, 'utf8');
}

function writeReports(dir: string, r: BuildResult): void {
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, 'build.json'), { ...r.summary, gatesFull: r.gates });
  writeFileSync(
    join(dir, 'excluded.tsv'),
    `appid\tname\treason\tdetail\n${r.excluded.map((e) => `${e.appid}\t${e.name}\t${e.reason}\t${e.detail}`).join('\n')}\n`,
  );
  if (r.coverage) {
    const { missing, ...rest } = r.coverage;
    writeJson(join(dir, 'coverage.json'), rest);
    writeFileSync(
      join(dir, 'coverage-missing.tsv'),
      `appid\tname\treason\tdetail\n${missing.map((m) => `${m.appid}\t${m.name}\t${m.reason}\t${m.detail}`).join('\n')}\n`,
    );
  }
  if (r.frozenDiff) writeJson(join(dir, 'frozen-diff.json'), r.frozenDiff);
}

async function main(): Promise<number> {
  const source = args.source;
  if (source !== 'steam' && source !== 'fixtures') throw new Error(`--source=${source} no válido`);
  const fixtures = source === 'fixtures';
  const fixturesDir = userPath(args.fixtures ?? at('fixtures/steam'));
  const fixtureMode = fixtures || process.env.STEAM_MODE === 'fixtures';
  const records = fixtureMode ? readFixtures(FIXTURE_DIRS.map((d) => join(fixturesDir, d))) : [];
  const fixturesNow = records.reduce((m, r) => Math.max(m, Date.parse(r.date) || 0), 0);
  const runAt = args.now ? Date.parse(args.now) : fixtures ? fixturesNow : Date.now();
  if (!Number.isFinite(runAt) || runAt <= 0) throw new Error('--now no válido');

  // Solo el pipeline lee la clave (§14.3); nunca se imprime ni se guarda.
  const key = fixtureMode || args.keyless ? null : process.env.STEAM_WEB_API_KEY?.trim() || null;
  const keyless = fixtures ? args.keyless : args.keyless || key === null;
  const transport: Transport = fixtureMode ? fixtureTransport(records) : httpsTransport();
  const rawDir = fixtures
    ? null
    : userPath(args['from-raw'] ?? args.raw ?? at(`pipeline/state/raw-${madridDate(runAt)}`));
  const outDir = args.out ? userPath(args.out) : fixtures ? null : at('pipeline/out');
  if (!outDir) throw new Error('Con --source=fixtures hay que indicar --out=<carpeta>');
  const statePath = args.state
    ? userPath(args.state)
    : fixtures
      ? join(fixturesDir, 'state/master.ndjson')
      : at('pipeline/state/master.ndjson.gz');
  const reportDir = args['report-dir']
    ? userPath(args['report-dir'])
    : fixtures
      ? null
      : at('pipeline/state/reports');

  const log = (l: string): void => console.log(l);
  // Sin red (fixtures) no hay ritmo que respetar.
  const runtime = fixtureMode ? { ...realRuntime, sleep: async () => {} } : realRuntime;
  const client = new SteamClient({
    transport,
    ...runtime,
    key,
    cache: rawDir ? new RawStore(rawDir, realRuntime.now) : null,
    offline: Boolean(args['from-raw']),
    log,
  });
  log(
    `Catálogo · origen ${source}${fixtureMode ? ' (STEAM_MODE=fixtures)' : ''} · ${keyless ? 'sin clave' : 'con clave'}${rawDir ? ` · páginas crudas en ${rawDir}${args['from-raw'] ? ' (sin red)' : ''}` : ''}`,
  );
  const result = await buildCatalog(client, {
    keyless,
    profile: fixtures ? FIXTURES_PROFILE : STEAM_PROFILE,
    state: readState(statePath),
    dump: args.compare ? readDump(userPath(args.compare)) : null,
    frozen: fixtures ? null : readFrozen(),
    golden: parseGolden(readFileSync(at('packages/core/test/golden.es.tsv'), 'utf8')),
    skipDeltaGates: args['skip-delta-gates'],
    runAt,
    previousVersion: previousVersion(outDir),
    ...(args.version ? { version: args.version } : {}),
    now: realRuntime.now,
    log,
  });

  if (reportDir) writeReports(join(reportDir, result.version), result);
  if (result.coverage) {
    const c = result.coverage;
    log(
      `CA1.1 · volcado ${c.dump.entries} (${c.dump.withName} con nombre): ${c.inCore} en el núcleo, ${c.missing.length} fuera ${JSON.stringify(c.byReason)}; sin motivo ${c.unexplained}`,
    );
  }
  if (!result.ok) {
    const rejected = fixtures
      ? `${outDir}-rejected`
      : at(`pipeline/state/rejected/${result.version}`);
    writeCatalog(rejected, result.files);
    log(`✗ No se publica: el catálogo queda en ${rejected}`);
    return 1;
  }
  writeCatalog(outDir, result.files);
  if (!fixtures) writeState(statePath, result.state);
  log(`✓ ${outDir}: ${result.games.length} juegos (${result.files.manifest.files.core.path})`);
  if (reportDir) log(`  Informes en ${join(reportDir, result.version)}`);
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    console.error(`✗ ${e instanceof SteamError ? `Steam: ${e.message}` : (e as Error).stack}`);
    process.exitCode = 1;
  },
);
