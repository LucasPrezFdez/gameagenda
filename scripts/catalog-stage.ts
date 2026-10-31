// `npm run catalog:stage` (§4.5, §12.5 y §13.3 de prototipe.md; DECISIONES §10.12): el pipeline
// desde el PC, cuando los *runners* de GitHub reciben 429 o faltan minutos (R-03). El PC solo
// descarga y construye; **nunca firma con la clave de producción ni despliega**:
// 1. baja el estado de la *Release* `catalog-state`, el mismo que restaurará `catalog.yml`;
// 2. construye con `pipeline/build.ts` (pasos 0–5 de la §4.5), con `--now` y `--raw` fijos, sin
//    `CATALOG_SIGNING_KEY` y firmado con la clave de desarrollo (`--dev-sign`). Si falla una
//    puerta, no sube nada;
// 3. sube a la *Release* `catalog-staging` `stage.tgz`: `stage.json` y las páginas crudas.
// Después, `gh workflow run catalog.yml -f source=staging` vuelve a derivar el catálogo con esas
// páginas y sin red (`--from-raw`), con el código de `main`, y pasa las puertas, firma y publica.
//
// Uso: npm run catalog:stage [-- --keyless] [-- --skip-delta-gates] [-- --no-upload]
// La clave de Steam sale de `.env.local` (`STEAM_WEB_API_KEY`); sin ella, plan B (§4.8).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { madridDate } from '../pipeline/src/clock.ts';
import {
  DEFAULT_STATE_DIR,
  restoreState,
  STAGE_ASSET,
  STAGING_RELEASE,
  STATE_RELEASE,
  type Stage,
  stageSchema,
  uploadStage,
} from './catalog-release.ts';
import { scanText } from './scan-secrets.ts';
import { packTgz, readDirEntries } from './tar.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

function isoSeconds(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');
}

function gitHead(): string | null {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

function builtVersion(): string | null {
  const f = join(root, 'pipeline/out/manifest.json');
  if (!existsSync(f)) return null;
  return (JSON.parse(readFileSync(f, 'utf8')) as { version?: string }).version ?? null;
}

function main(): number {
  const { values } = parseArgs({
    options: {
      keyless: { type: 'boolean', default: false },
      'skip-delta-gates': { type: 'boolean', default: false },
      'no-upload': { type: 'boolean', default: false },
    },
  });
  const keyless = values.keyless || !process.env.STEAM_WEB_API_KEY?.trim();
  if (process.env.CATALOG_SIGNING_KEY) {
    console.warn(
      '⚠ CATALOG_SIGNING_KEY está definida y se ignora: el PC nunca firma con la de producción',
    );
  }

  console.log(`1 · Estado de la Release ${STATE_RELEASE}`);
  const state = restoreState(DEFAULT_STATE_DIR);

  const runAt = Date.now();
  const now = isoSeconds(runAt);
  const rawDir = join(DEFAULT_STATE_DIR, `raw-${madridDate(runAt)}`);
  const args = ['pipeline/build.ts', `--now=${now}`, `--raw=${rawDir}`, '--dev-sign'];
  if (keyless) args.push('--keyless');
  if (values['skip-delta-gates']) args.push('--skip-delta-gates');
  console.log(
    `2 · Construye en el PC (${keyless ? 'sin clave' : 'con clave'}): node ${args.join(' ')}`,
  );
  const build = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
    // Vacías, por si `.env.local` las trajera: `--env-file` no pisa lo que ya está en el entorno.
    env: { ...process.env, CATALOG_SIGNING_KEY: '', CATALOG_SIGNING_KID: '' },
  });
  if (build.status !== 0) {
    console.error('✗ La construcción ha fallado (o una puerta): no se sube nada');
    return 1;
  }

  const stage: Stage = stageSchema.parse({
    format: 'gacat-stage',
    v: 1,
    createdAt: isoSeconds(Date.now()),
    runAt: now,
    keyless,
    skipDeltaGates: values['skip-delta-gates'],
    stateAsset: state.asset,
    stateSha256: state.sha256,
    commit: gitHead(),
    pcVersion: builtVersion(),
  });
  const raw = readDirEntries(rawDir).map((e) => ({ path: `raw/${e.path}`, data: e.data }));
  if (raw.length === 0) throw new Error(`No hay páginas crudas en ${rawDir}`);
  // Las páginas van comprimidas: la búsqueda de la clave de `catalog.yml` no vería dentro. La
  // clave viaja en una cabecera y nunca debería estar en ellas; se comprueba antes de subirlas.
  const key = process.env.STEAM_WEB_API_KEY?.trim();
  const keyHash = key ? createHash('sha256').update(key).digest('hex') : null;
  for (const e of raw) {
    const text = (e.path.endsWith('.gz') ? gunzipSync(e.data) : Buffer.from(e.data)).toString(
      'latin1',
    );
    const found = scanText(text, keyHash);
    if (found.length > 0) throw new Error(`${e.path} contiene ${found.join(', ')}: no se sube`);
  }
  const bytes = packTgz([
    { path: 'stage.json', data: Buffer.from(`${JSON.stringify(stage, null, 1)}\n`) },
    ...raw,
  ]);
  console.log(
    `3 · ${STAGE_ASSET}: ${raw.length} páginas crudas, ${bytes.length.toLocaleString('es-ES')} bytes`,
  );
  if (values['no-upload']) {
    const file = join(tmpdir(), STAGE_ASSET);
    writeFileSync(file, bytes);
    console.log(`✓ No se sube (--no-upload): ${file}`);
    return 0;
  }
  uploadStage(bytes);
  console.log(`✓ Subido a la Release ${STAGING_RELEASE}. Para publicarlo:`);
  console.log('    gh workflow run catalog.yml -f source=staging');
  return 0;
}

try {
  process.exitCode = main();
} catch (e) {
  console.error(`✗ ${(e as Error).message}`);
  process.exitCode = 1;
}
