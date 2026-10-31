// Transporte entre ejecuciones del pipeline por *Releases* de GitHub (§4.5, §4.6 y §12.5 de
// prototipe.md), con `gh` (en `catalog.yml`, el `GITHUB_TOKEN`; en el PC, la sesión de `gh`):
// - **Estado** (*Release* `catalog-state`): `pipeline/state/` sin páginas crudas, informes ni
//   rechazados, como `state-<versión>.tgz`. Se guardan las 7 copias más recientes y se restaura
//   la de versión más alta. Sin *Release* (la primera ejecución de M2), no hay estado: todo es alta.
// - **Preparación** (*Release* `catalog-staging`): `stage.tgz`, lo que sube `npm run
//   catalog:stage` desde el PC: `stage.json` y las páginas crudas de Steam (`raw/`), con las que
//   `catalog.yml -f source=staging` vuelve a derivar el catálogo sin red (`--from-raw`).
//
// Uso:
//   node scripts/catalog-release.ts restore-state [--dir=pipeline/state]
//   node scripts/catalog-release.ts save-state --version=<AAAAMMDD.N> [--dir=pipeline/state]
//   node scripts/catalog-release.ts download-stage --dir=<carpeta> --state-asset=<nombre>
//        [--state-sha256=<hex>] [--commit=<sha>]
// Escriben sus resultados en `$GITHUB_OUTPUT` si existe. `GH_PATH` cambia el ejecutable de `gh`.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { compareVersions, writeGithubOutput } from './catalog-live.ts';
import { packTgz, readDirEntries, type TarEntry, unpackTgz, writeEntries } from './tar.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
export const DEFAULT_STATE_DIR = join(root, 'pipeline/state');
export const STATE_RELEASE = 'catalog-state';
export const STAGING_RELEASE = 'catalog-staging';
export const STATE_COPIES = 7;
export const STAGE_ASSET = 'stage.tgz';
/** Un `catalog:stage` más antiguo no se publica: daría un catálogo viejo (aviso a las 36 h). */
export const STAGE_MAX_AGE_MS = 36 * 3600_000;

const RE_STATE_ASSET = /^state-(\d{8}\.[1-9]\d*)\.tgz$/;
const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

export function stateAssetName(version: string): string {
  const name = `state-${version}.tgz`;
  if (!RE_STATE_ASSET.test(name)) throw new Error(`Versión no válida para el estado: ${version}`);
  return name;
}

/** Copias del estado de `names`, de la versión más alta a la más baja. */
export function stateAssets(names: readonly string[]): string[] {
  return names
    .filter((n) => RE_STATE_ASSET.test(n))
    .sort((a, b) =>
      compareVersions(
        (RE_STATE_ASSET.exec(b) as RegExpExecArray)[1] as string,
        (RE_STATE_ASSET.exec(a) as RegExpExecArray)[1] as string,
      ),
    );
}

export function latestStateAsset(names: readonly string[]): string | null {
  return stateAssets(names)[0] ?? null;
}

/** Copias que sobran para quedarse con las `keep` más recientes. */
export function stateAssetsToPrune(names: readonly string[], keep = STATE_COPIES): string[] {
  return stateAssets(names).slice(keep);
}

/**
 * Qué parte de `pipeline/state/` es estado: todo menos las páginas crudas (`raw-<fecha>`, ≈50 MB al día;
 * van como artefacto si la ejecución falla), los informes (`reports/`, artefacto) y los catálogos
 * rechazados (`rejected/`).
 */
export function isStatePath(path: string): boolean {
  const top = path.split('/')[0] as string;
  return !(top === 'reports' || top === 'rejected' || top === 'raw' || top.startsWith('raw-'));
}

/** `stage.json`, el índice de lo que sube `catalog:stage`. */
export const stageSchema = z.object({
  format: z.literal('gacat-stage'),
  v: z.literal(1),
  createdAt: z.iso.datetime(),
  /** El `--now` de la construcción en el PC: `catalog.yml` lo repite. */
  runAt: z.iso.datetime(),
  keyless: z.boolean(),
  skipDeltaGates: z.boolean(),
  /** Copia del estado con la que se construyó (`null`: sin estado). */
  stateAsset: z.string().nullable(),
  stateSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  /** *Commit* del PC y versión que le dio (informativos). */
  commit: z.string().nullable(),
  pcVersion: z.string().nullable(),
});
export type Stage = z.infer<typeof stageSchema>;

/** Comprueba que `stage` se construyó con el estado vigente y no es viejo; si no, lanza. */
export function checkStage(
  stage: Stage,
  current: { readonly asset: string | null; readonly sha256: string | null; readonly now: number },
): void {
  if (stage.stateAsset !== current.asset) {
    throw new Error(
      `catalog:stage se construyó con el estado ${stage.stateAsset ?? '(ninguno)'} y el vigente es ${current.asset ?? '(ninguno)'}: vuelve a lanzar npm run catalog:stage`,
    );
  }
  if (stage.stateSha256 !== current.sha256) {
    throw new Error(
      `El estado ${current.asset} no es el que bajó catalog:stage (SHA-256 distinto)`,
    );
  }
  const age = current.now - Date.parse(stage.runAt);
  if (age > STAGE_MAX_AGE_MS) {
    throw new Error(`catalog:stage es de ${stage.runAt}, hace más de 36 h: vuelve a lanzarlo`);
  }
  if (age < -10 * 60_000) throw new Error(`catalog:stage tiene una fecha futura, ${stage.runAt}`);
}

// --- gh ---------------------------------------------------------------------------------------

interface GhResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

function gh(args: readonly string[], options: { readonly allowFail?: boolean } = {}): GhResult {
  const r = spawnSync(process.env.GH_PATH || 'gh', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) throw new Error(`No se puede ejecutar gh: ${r.error.message}`);
  const out = { status: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
  if (out.status !== 0 && !options.allowFail) {
    throw new Error(`gh ${args.slice(0, 3).join(' ')} falla: ${out.stderr.trim()}`);
  }
  return out;
}

/** Nombres de los *assets* de la *Release* `tag`, o `null` si no existe. */
export function releaseAssets(tag: string): string[] | null {
  const r = gh(['api', `repos/{owner}/{repo}/releases/tags/${tag}`, '--jq', '[.assets[].name]'], {
    allowFail: true,
  });
  if (r.status !== 0) {
    if (/HTTP 404/.test(r.stderr)) return null;
    throw new Error(`No se puede leer la Release ${tag}: ${r.stderr.trim()}`);
  }
  return z.array(z.string()).parse(JSON.parse(r.stdout));
}

function ensureRelease(tag: string, title: string, notes: string): void {
  if (releaseAssets(tag) !== null) return;
  gh([
    'release',
    'create',
    tag,
    '--title',
    title,
    '--notes',
    notes,
    '--prerelease',
    '--latest=false',
  ]);
  console.log(`  Release ${tag} creada`);
}

function download(tag: string, asset: string): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'gacat-release-'));
  try {
    gh(['release', 'download', tag, '--pattern', asset, '--dir', dir, '--clobber']);
    return readFileSync(join(dir, asset));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function upload(tag: string, asset: string, bytes: Uint8Array): void {
  const dir = mkdtempSync(join(tmpdir(), 'gacat-release-'));
  try {
    const file = join(dir, asset);
    writeFileSync(file, bytes);
    gh(['release', 'upload', tag, file, '--clobber']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- Órdenes ------------------------------------------------------------------------------------

export interface RestoredState {
  readonly asset: string | null;
  readonly sha256: string | null;
}

/** Baja la copia más reciente del estado y sustituye con ella el estado de `dir`. */
export function restoreState(dir: string): RestoredState {
  const names = releaseAssets(STATE_RELEASE);
  const asset = names ? latestStateAsset(names) : null;
  if (!asset) {
    console.log(
      `Sin ${names ? 'copias del estado en' : 'la Release'} ${STATE_RELEASE}: primera ejecución, todo es alta`,
    );
    return { asset: null, sha256: null };
  }
  const bytes = download(STATE_RELEASE, asset);
  const entries = unpackTgz(bytes);
  // Lo que había de estado se va: el de la Release manda (las páginas crudas se quedan).
  for (const old of readDirEntriesSafe(dir)) rmSync(join(dir, ...old.path.split('/')));
  writeEntries(dir, entries);
  const hash = sha256(bytes);
  console.log(`✓ Estado ${asset} (${entries.length} ficheros, ${bytes.length} bytes) en ${dir}`);
  return { asset, sha256: hash };
}

function readDirEntriesSafe(dir: string): TarEntry[] {
  try {
    return readDirEntries(dir, isStatePath);
  } catch {
    return [];
  }
}

/** Sube el estado de `dir` como `state-<versión>.tgz` y deja las 7 copias más recientes. */
export function saveState(dir: string, version: string): void {
  const entries = readDirEntries(dir, isStatePath);
  if (entries.length === 0) throw new Error(`No hay estado que guardar en ${dir}`);
  const asset = stateAssetName(version);
  const bytes = packTgz(entries);
  ensureRelease(
    STATE_RELEASE,
    'Estado del pipeline del catálogo',
    'Estado de `catalog.yml` (§4.6 de prototipe.md): `state-<versión>.tgz`, las 7 copias más recientes. Lo escribe el flujo; no se edita a mano.',
  );
  upload(STATE_RELEASE, asset, bytes);
  for (const old of stateAssetsToPrune(releaseAssets(STATE_RELEASE) ?? [])) {
    gh(['release', 'delete-asset', STATE_RELEASE, old, '--yes']);
    console.log(`  Copia antigua borrada: ${old}`);
  }
  console.log(
    `✓ Estado ${asset} (${entries.length} ficheros, ${bytes.length} bytes) en ${STATE_RELEASE}`,
  );
}

/** Sube lo que prepara `catalog:stage` a `catalog-staging` (sustituye lo anterior). */
export function uploadStage(bytes: Uint8Array): void {
  ensureRelease(
    STAGING_RELEASE,
    'Catálogo preparado en el PC',
    'Lo que sube `npm run catalog:stage` (§12.5 de prototipe.md): páginas crudas de Steam para `gh workflow run catalog.yml -f source=staging`, que deriva, pasa las puertas, firma y publica.',
  );
  upload(STAGING_RELEASE, STAGE_ASSET, bytes);
}

export interface DownloadedStage {
  readonly stage: Stage;
  readonly rawDir: string;
}

/** Baja `stage.tgz` a `dir` y comprueba que vale para el estado restaurado. */
export function downloadStage(
  dir: string,
  current: RestoredState & { readonly commit?: string | null },
): DownloadedStage {
  const names = releaseAssets(STAGING_RELEASE);
  if (!names?.includes(STAGE_ASSET)) {
    throw new Error(
      `No hay ${STAGE_ASSET} en la Release ${STAGING_RELEASE}: lanza antes npm run catalog:stage`,
    );
  }
  const entries = unpackTgz(download(STAGING_RELEASE, STAGE_ASSET));
  rmSync(dir, { recursive: true, force: true });
  writeEntries(dir, entries);
  const stageEntry = entries.find((e) => e.path === 'stage.json');
  if (!stageEntry) throw new Error(`${STAGE_ASSET} no trae stage.json`);
  const stage = stageSchema.parse(JSON.parse(Buffer.from(stageEntry.data).toString('utf8')));
  checkStage(stage, { asset: current.asset, sha256: current.sha256, now: Date.now() });
  const raw = entries.filter((e) => e.path.startsWith('raw/')).length;
  if (raw === 0) throw new Error(`${STAGE_ASSET} no trae páginas crudas (raw/)`);
  if (current.commit && stage.commit && stage.commit !== current.commit) {
    console.log(
      `::warning::catalog:stage se construyó en ${stage.commit.slice(0, 7)} y aquí se deriva con ${current.commit.slice(0, 7)}`,
    );
  }
  console.log(
    `✓ catalog:stage del ${stage.runAt} (${stage.keyless ? 'sin clave' : 'con clave'}, ${raw} páginas crudas, versión del PC ${stage.pcVersion ?? '—'})`,
  );
  return { stage, rawDir: join(dir, 'raw') };
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      dir: { type: 'string' },
      version: { type: 'string' },
      'state-asset': { type: 'string' },
      'state-sha256': { type: 'string' },
      commit: { type: 'string' },
    },
  });
  const command = positionals[0];
  if (command === 'restore-state') {
    const r = restoreState(resolve(values.dir ?? DEFAULT_STATE_DIR));
    writeGithubOutput({ asset: r.asset ?? '', sha256: r.sha256 ?? '' });
  } else if (command === 'save-state') {
    if (!values.version) throw new Error('Falta --version');
    saveState(resolve(values.dir ?? DEFAULT_STATE_DIR), values.version);
  } else if (command === 'download-stage') {
    if (!values.dir) throw new Error('Falta --dir');
    const { stage, rawDir } = downloadStage(resolve(values.dir), {
      asset: values['state-asset'] || null,
      sha256: values['state-sha256'] || null,
      commit: values.commit ?? null,
    });
    writeGithubOutput({
      raw: rawDir,
      now: stage.runAt,
      keyless: String(stage.keyless),
      skip_delta_gates: String(stage.skipDeltaGates),
    });
  } else {
    throw new Error('Uso: catalog-release.ts restore-state | save-state | download-stage …');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    console.error(`✗ ${(e as Error).message}`);
    process.exitCode = 1;
  });
}
