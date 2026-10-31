// `npm run catalog:build` (§13.3): pasos 0–5 de la §4.5 y la firma del paso 6. Escribe en
// `pipeline/out/` el núcleo, `recent`, los alias, los *shards* de detalles con su índice y el
// *manifest* (firmado si hay clave de firma), conservando los ficheros de la versión anterior, y el
// estado nuevo. Desplegar `ga-catalog` y subir el estado son de `catalog.yml`.
//
//   npm run catalog:build                                  con STEAM_WEB_API_KEY, con clave;
//                                                          sin ella, plan B (§4.8)
//   npm run catalog:build -- --keyless                     plan B aunque haya clave
//   npm run catalog:build -- --compare=<volcado.json>      informe de cobertura del CA1.1
//   npm run catalog:build -- --skip-delta-gates            sin las puertas que comparan
//   npm run catalog:build -- --from-raw=pipeline/state/raw-AAAA-MM-DD
//                                                          vuelve a derivar sin red
//   npm run catalog:build -- --source=fixtures --out=<dir> desde fixtures/steam/, sin red
//   npm run catalog:build -- --dev-sign                    firma con la clave de desarrollo
//   npm run catalog:build -- --kill-switches=<fichero>     por defecto, pipeline/kill-switches.json
//   npm run catalog:build -- --require-signature           error si no firma con una de producción
//
// Firma (§11.3): CATALOG_SIGNING_KEY (privada ed25519, PKCS#8 en PEM) y CATALOG_SIGNING_KID, solo
// en GitHub Actions; en el PC, sin firma o con `--dev-sign`. Si una puerta falla, no se escribe
// `--out` ni el estado: el catálogo va a `pipeline/state/rejected/<versión>/` (con
// `--source=fixtures`, a `<out>-rejected/`). Códigos de salida: `EXIT` en `src/output.ts`.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { type CoreCatalog, parseCore } from '@gameagenda/core/catalog-format';
import { parseGolden } from '@gameagenda/core/search-quality';
import { madridDate, realRuntime } from './src/clock.ts';
import { readDump } from './src/coverage.ts';
import { FIXTURE_DIRS } from './src/fixtures.ts';
import { readKillSwitches } from './src/kill-switches.ts';
import { EXIT, laterVersion, writeReports, writeResult } from './src/output.ts';
import { RawStore } from './src/raw-store.ts';
import { buildCatalog, FIXTURES_PROFILE, STEAM_PROFILE } from './src/run.ts';
import { loadSigner } from './src/signing.ts';
import { readState } from './src/state.ts';
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
    'dev-sign': { type: 'boolean', default: false },
    'require-signature': { type: 'boolean', default: false },
    'kill-switches': { type: 'string' },
  },
  strict: true,
});

function manifestVersion(dir: string): string | null {
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
  const signer = loadSigner({
    devSign: args['dev-sign'],
    devKeyPath: at('fixtures/signing/dev-catalog-key.pem'),
    env: process.env,
  });
  if (args['require-signature'] && signer?.use !== 'prod') {
    throw new Error('--require-signature: falta CATALOG_SIGNING_KEY con una clave de producción');
  }
  const killSwitches = readKillSwitches(
    userPath(args['kill-switches'] ?? at('pipeline/kill-switches.json')),
  );
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
    `Catálogo · origen ${source}${fixtureMode ? ' (STEAM_MODE=fixtures)' : ''} · ${keyless ? 'sin clave' : 'con clave'} · ${signer ? `firma ${signer.kid} (${signer.use})` : 'sin firma'}${rawDir ? ` · páginas crudas en ${rawDir}${args['from-raw'] ? ' (sin red)' : ''}` : ''}`,
  );
  const state = readState(statePath);
  const result = await buildCatalog(client, {
    keyless,
    profile: fixtures ? FIXTURES_PROFILE : STEAM_PROFILE,
    state: state.rows,
    stateMeta: state.meta,
    dump: args.compare ? readDump(userPath(args.compare)) : null,
    frozen: fixtures ? null : readFrozen(),
    golden: parseGolden(readFileSync(at('packages/core/test/golden.es.tsv'), 'utf8')),
    skipDeltaGates: args['skip-delta-gates'],
    runAt,
    previousVersion: laterVersion(state.meta.version, manifestVersion(outDir)),
    ...(args.version ? { version: args.version } : {}),
    killSwitches,
    signer,
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
  const rejectedDir = fixtures
    ? `${outDir}-rejected`
    : at(`pipeline/state/rejected/${result.version}`);
  const code = writeResult(result, { outDir, rejectedDir, statePath: fixtures ? null : statePath });
  if (code !== EXIT.ok) {
    log(`✗ No se publica: el catálogo queda en ${rejectedDir}`);
    return code;
  }
  log(
    `✓ ${outDir}: ${result.games.length} juegos (${result.files.manifest.files.core.path}), ${result.recent.length} recientes, enrichmentAgeDays ${result.enrichmentAgeDays}`,
  );
  if (reportDir) log(`  Informes en ${join(reportDir, result.version)}`);
  return EXIT.ok;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    console.error(`✗ ${e instanceof SteamError ? `Steam: ${e.message}` : (e as Error).stack}`);
    process.exitCode =
      e instanceof SteamError && e.kind === 'key-rejected' ? EXIT.keyRejected : EXIT.stage;
  },
);
