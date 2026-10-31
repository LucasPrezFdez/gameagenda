// Catálogos de prueba para los *scripts* de publicación: núcleo, alias, recientes, índice de
// *shards* y *shards* con su *hash* en el nombre, y el *manifest*, sin firma o firmado.
import { createHash, createPrivateKey, type KeyObject, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DETAIL_SHARDS,
  detailShardOf,
  detailShardPath,
  type GameDetails,
  manifestSigningBytes,
  toBase64Url,
} from '@gameagenda/core/catalog-format';

const root = fileURLToPath(new URL('..', import.meta.url));

export const DEV_KEY: KeyObject = createPrivateKey(
  readFileSync(join(root, 'fixtures/signing/dev-catalog-key.pem')),
);

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

export function tempDir(prefix: string, dirs: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

export function cleanup(dirs: string[]): void {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

const details = (appid: number): GameDetails => [
  `steam/apps/${appid}/\${FILENAME}?t=1`,
  'library_600x900.jpg',
  'header.jpg',
  [1345507200, 'day'],
  [8, appid, 87],
  1,
  3,
];

export interface TestCatalogOptions {
  readonly version: string;
  /** `appid` del núcleo y de los *shards*. */
  readonly appids?: readonly number[];
  /** Texto que cambia el contenido sin cambiar los `appid` (otra versión del núcleo). */
  readonly salt?: string;
  readonly sign?: { readonly kid: string; readonly key: KeyObject } | null;
}

export interface TestCatalog {
  readonly dir: string;
  readonly manifest: Record<string, unknown>;
  /** Rutas publicadas de todos los ficheros (sin el *manifest*). */
  readonly paths: readonly string[];
}

export function signManifest(
  manifest: Record<string, unknown>,
  kid: string,
  key: KeyObject,
): Record<string, unknown> {
  const { sig: _sig, ...unsigned } = manifest;
  const signature = sign(null, manifestSigningBytes(unsigned), key);
  return { ...unsigned, sig: { kid, ed25519: toBase64Url(signature) } };
}

export function writeTestCatalog(dir: string, options: TestCatalogOptions): TestCatalog {
  const { version } = options;
  const appids = options.appids ?? [730, 570, 367520];
  const salt = options.salt ?? '';
  const files = new Map<string, string>();
  const spec = (prefix: string, ext: string, text: string) => {
    const hash = sha256(text);
    const path = `${prefix}.${hash.slice(0, 16)}.${ext}`;
    files.set(path, text);
    return { path, sha256: hash, bytes: Buffer.byteLength(text) };
  };
  const coreRows = appids.map((a) => `${a}\tJuego ${a}${salt}\t\t\t2020\t10`).join('\n');
  const core = spec(
    'core',
    'tsv',
    `#gacat-core v1\t${version}\tappid\tname\tnameEs\tflags\tyear\tpop\n${coreRows}\n`,
  );
  const aliases = spec('aliases', 'tsv', `#gacat-aliases v1\t${version}\talias\tappid\ncs\t730\n`);
  const recent = spec(
    'recent',
    'tsv',
    `#gacat-recent v1\t${version}\tappid\tname\tnameEs\tflags\tyear\tpop\n`,
  );

  const byShard = new Map<number, Record<string, GameDetails>>();
  for (const a of appids) {
    const n = detailShardOf(a);
    byShard.set(n, { ...byShard.get(n), [String(a)]: details(a) });
  }
  const shards: (string | null)[] = new Array(DETAIL_SHARDS).fill(null);
  for (const [n, shard] of byShard) {
    const text = `${JSON.stringify(shard)}\n`;
    const hash = sha256(text).slice(0, 16);
    shards[n] = hash;
    files.set(detailShardPath(n, hash), text);
  }
  const index = spec(
    'details/index',
    'json',
    `${JSON.stringify({ format: 'gacat-details-index', v: 1, version, shards })}\n`,
  );

  let manifest: Record<string, unknown> = {
    format: 'gacat',
    v: 1,
    version,
    generatedAt: '2026-10-31T04:20:00Z',
    counts: { core: appids.length, aliases: 1, recent: 0 },
    files: { core, aliases, recent, details: index },
    enrichmentAgeDays: 0,
    minClientVersion: '0.2.0',
    killSwitches: { covers: false, details: false },
  };
  if (options.sign) manifest = signManifest(manifest, options.sign.kid, options.sign.key);
  writeCatalogFiles(dir, files, manifest);
  return { dir, manifest, paths: [...files.keys()] };
}

export function writeCatalogFiles(
  dir: string,
  files: ReadonlyMap<string, string>,
  manifest: Record<string, unknown>,
): void {
  for (const [path, text] of files) {
    const full = join(dir, ...path.split('/'));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}
