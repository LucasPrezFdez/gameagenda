// Carpeta que despliega `ga-catalog` (§5.4, §7.6 y §15.5 de prototipe.md; CA0.2, CA2.4): monta en
// `pipeline/dist/` la versión nueva del catálogo **y los ficheros de la anterior**, para que un
// cliente con el *manifest* anterior siga funcionando después del despliegue (CA2.4). Solo entra
// el `manifest.json` nuevo; `pipeline/catalog.headers` va como `_headers`. Copia únicamente lo que
// cita el *manifest*: lo demás que haya en el origen se avisa y no se publica.
//
// Antes lo comprueba todo y, si algo falla, no toca la carpeta de despliegue:
// - el *manifest*, con el esquema de `core`, y su firma si la lleva. Con `--signature=prod` es
//   obligatoria y de una clave `prod` de `CATALOG_SIGNING_KEYS`: si no, el cliente la rechazaría;
// - cada fichero que cita: existe, con sus bytes, su SHA-256 y el prefijo del *hash* en el nombre
//   (las reglas de `_headers` los cachean como inmutables);
// - el índice de *shards* (`details`) y cada *shard*: esquema Zod, versión del índice, prefijo del
//   *hash* y que cada `appid` cae en su *shard*;
// - la versión anterior, igual (sin el Zod de los *shards*, ya publicados), y que la nueva es
//   posterior. Una ruta que esté en las dos tiene que tener el mismo contenido;
// - los límites del plan gratuito: ≤20 000 ficheros de ≤25 MiB por despliegue.
//
// La versión anterior se descarga del `ga-catalog` publicado (`--previous=<origen>`): es justo lo
// que tienen los clientes, y el estado de la *Release* no tiene que guardar el catálogo entero. Un
// 404 del *manifest* es una primera publicación (no hay nada que conservar); cualquier otro fallo
// para el montaje. También puede ser una carpeta con un catálogo (`--previous=<carpeta>`).
//
// Uso: node scripts/assemble-catalog.ts [carpeta] [--previous=<origen|carpeta>]
//        [--signature=optional|dev|prod] [--out=<carpeta>]
// Por defecto, `fixtures/catalog` (el mini-catálogo de M0, con o sin firma) y `pipeline/dist`;
// en `catalog.yml`, `pipeline/out --previous=$CATALOG_ORIGIN --signature=prod`. Después,
// `npm run catalog:publish` (solo en `catalog.yml`) o `npx wrangler dev -c pipeline/wrangler.jsonc`.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  CATALOG_SIGNING_KEYS,
  type CatalogManifest,
  type CatalogSigningKey,
  catalogManifestSchema,
  detailShardOf,
  detailShardPath,
  detailShardSchema,
  detailsIndexSchema,
  fromBase64Url,
  manifestSigningBytes,
} from '@gameagenda/core/catalog-format';
import {
  catalogUrl,
  compareVersions,
  type FetchLike,
  fetchWithRetry,
  mapLimit,
} from './catalog-live.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
/** `assets.directory` de `pipeline/wrangler.jsonc`. */
export const DEFAULT_OUT = join(root, 'pipeline/dist');
export const DEFAULT_HEADERS = join(root, 'pipeline/catalog.headers');

/** Límites por despliegue de Workers Static Assets en el plan gratuito (§7.6). */
export const DEPLOY_LIMITS = { maxFiles: 20_000, maxFileBytes: 25 * 1024 * 1024 } as const;

/** `optional`: la firma, si está, tiene que valer; `dev`: obligatoria; `prod`: de producción. */
export type SignaturePolicy = 'optional' | 'dev' | 'prod';

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** De dónde se leen los ficheros de un catálogo: `null` si no existe. */
interface Reader {
  readonly label: string;
  read(path: string): Promise<Buffer | null>;
}

function dirReader(dir: string): Reader {
  return {
    label: dir,
    read: async (path) => {
      const full = join(dir, ...path.split('/'));
      return existsSync(full) ? readFileSync(full) : null;
    },
  };
}

function originReader(origin: string, fetchImpl: FetchLike): Reader {
  return {
    label: origin,
    read: async (path) => {
      const url = catalogUrl(origin, path);
      const res = await fetchWithRetry(fetchImpl, url, { cache: 'no-store' });
      if (res.status === 404) {
        await res.body?.cancel();
        return null;
      }
      if (!res.ok) throw new Error(`${url} responde ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

export interface LoadedCatalog {
  readonly version: string;
  readonly manifest: CatalogManifest;
  /** El *manifest* tal como se publica (`JSON.parse`): es lo que se firma. */
  readonly raw: Record<string, unknown>;
  readonly manifestText: string;
  /** Ruta publicada → bytes: los ficheros del *manifest*, el índice y los *shards*. */
  readonly files: ReadonlyMap<string, Buffer>;
}

/** Un `appid` de un *shard* que no le corresponde, o `null`. */
function misplacedAppid(shard: Record<string, unknown>, n: number): string | null {
  for (const key of Object.keys(shard)) if (detailShardOf(Number(key)) !== n) return key;
  return null;
}

/**
 * Lee y comprueba un catálogo. `reuse` da los bytes de rutas ya leídas (las de la versión nueva,
 * al leer la anterior): no se descargan otra vez, pero se comprueban contra este *manifest*.
 */
async function loadCatalog(
  reader: Reader,
  options: { readonly validateShards: boolean; readonly reuse?: ReadonlyMap<string, Buffer> },
): Promise<LoadedCatalog | null> {
  const where = reader.label;
  const manifestBytes = await reader.read('manifest.json');
  if (manifestBytes === null) return null;
  const manifestText = manifestBytes.toString('utf8');
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(manifestText) as Record<string, unknown>;
  } catch {
    throw new Error(`${where}/manifest.json no es JSON`);
  }
  const parsed = catalogManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`${where}/manifest.json no cumple el esquema: ${parsed.error.message}`);
  }
  const manifest = parsed.data;
  const files = new Map<string, Buffer>();
  const get = async (path: string, what: string): Promise<Buffer> => {
    const bytes = options.reuse?.get(path) ?? (await reader.read(path));
    if (bytes === null) {
      throw new Error(
        `El manifest ${manifest.version} cita ${path} (${what}) y no está en ${where}`,
      );
    }
    return bytes;
  };

  for (const [kind, spec] of Object.entries(manifest.files)) {
    if (!spec) continue;
    const bytes = await get(spec.path, kind);
    const hash = sha256(bytes);
    if (bytes.length !== spec.bytes) {
      throw new Error(`${spec.path}: ${bytes.length} bytes, no ${spec.bytes}`);
    }
    if (hash !== spec.sha256) {
      throw new Error(`${spec.path}: el SHA-256 no coincide con el del manifest`);
    }
    if (!spec.path.includes(`.${hash.slice(0, 16)}.`)) {
      throw new Error(
        `${spec.path}: el nombre no lleva el prefijo de su hash, ${hash.slice(0, 16)}`,
      );
    }
    files.set(spec.path, bytes);
  }

  const indexSpec = manifest.files.details;
  if (indexSpec) {
    const indexBytes = files.get(indexSpec.path) as Buffer;
    let indexJson: unknown;
    try {
      indexJson = JSON.parse(indexBytes.toString('utf8'));
    } catch {
      throw new Error(`${indexSpec.path} no es JSON`);
    }
    const index = detailsIndexSchema.safeParse(indexJson);
    if (!index.success) {
      throw new Error(`${indexSpec.path} no cumple el esquema: ${index.error.message}`);
    }
    if (index.data.version !== manifest.version) {
      throw new Error(
        `${indexSpec.path} es de la versión ${index.data.version}, no ${manifest.version}`,
      );
    }
    const shards = index.data.shards.flatMap((hash, n) => (hash === null ? [] : [{ n, hash }]));
    const loaded = await mapLimit(shards, 16, async ({ n, hash }) => {
      const path = detailShardPath(n, hash);
      const bytes = await get(path, `shard ${n}`);
      if (!sha256(bytes).startsWith(hash)) {
        throw new Error(`${path}: el SHA-256 no empieza por el hash de su nombre`);
      }
      if (options.validateShards) {
        let json: unknown;
        try {
          json = JSON.parse(bytes.toString('utf8'));
        } catch {
          throw new Error(`${path} no es JSON`);
        }
        const shard = detailShardSchema.safeParse(json);
        if (!shard.success) throw new Error(`${path} no cumple el esquema: ${shard.error.message}`);
        const wrong = misplacedAppid(shard.data, n);
        if (wrong !== null) {
          throw new Error(
            `${path}: el appid ${wrong} es del shard ${detailShardOf(Number(wrong))}`,
          );
        }
      }
      return [path, bytes] as const;
    });
    for (const [path, bytes] of loaded) files.set(path, bytes);
  }
  return { version: manifest.version, manifest, raw, manifestText, files };
}

/** Comprueba la firma del *manifest* según `policy`; devuelve una descripción para el registro. */
export function checkSignature(
  raw: Record<string, unknown>,
  policy: SignaturePolicy,
  keys: readonly CatalogSigningKey[] = CATALOG_SIGNING_KEYS,
): string {
  const sig = raw.sig as { kid?: unknown; ed25519?: unknown } | undefined;
  if (sig === undefined) {
    if (policy === 'optional') return 'sin firma';
    throw new Error('El manifest no lleva firma (sig) y aquí es obligatoria');
  }
  const key = keys.find((k) => k.kid === sig.kid);
  if (!key) {
    throw new Error(
      `El manifest va firmado con kid «${String(sig.kid)}», cuya clave pública no está en CATALOG_SIGNING_KEYS (packages/core/src/catalog-format/signature.ts): el cliente lo rechazaría`,
    );
  }
  if (policy === 'prod' && key.use !== 'prod') {
    throw new Error(
      `El manifest va firmado con la clave de desarrollo ${key.kid}: ga-catalog solo publica con la de producción`,
    );
  }
  const signature = typeof sig.ed25519 === 'string' ? fromBase64Url(sig.ed25519) : null;
  const publicKey = createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: key.ed25519 },
    format: 'jwk',
  });
  if (signature === null || !verify(null, manifestSigningBytes(raw), publicKey, signature)) {
    throw new Error(`La firma del manifest no es válida con la clave ${key.kid}`);
  }
  return `firmado con ${key.kid} (${key.use})`;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

export interface AssembleOptions {
  readonly source: string;
  readonly out?: string;
  readonly headers?: string;
  /** Origen publicado (`https://…`) o carpeta de la versión anterior; `null`, sin ella. */
  readonly previous?: string | null;
  readonly signature?: SignaturePolicy;
  readonly limits?: { readonly maxFiles: number; readonly maxFileBytes: number };
  readonly keys?: readonly CatalogSigningKey[];
  readonly fetchImpl?: FetchLike;
  readonly log?: (line: string) => void;
}

export interface AssembleResult {
  readonly version: string;
  readonly previousVersion: string | null;
  readonly signature: string;
  /** Ficheros desplegados (con `manifest.json` y `_headers`) y sus bytes. */
  readonly files: number;
  readonly bytes: number;
  /** Ficheros que solo están en la versión anterior. */
  readonly previousOnly: number;
  /** Ficheros del origen que no cita el *manifest* (no se publican). */
  readonly unreferenced: readonly string[];
}

/** Monta la carpeta de despliegue; no la toca si algo falla. */
export async function assemble(options: AssembleOptions): Promise<AssembleResult> {
  const source = resolve(options.source);
  const out = resolve(options.out ?? DEFAULT_OUT);
  const limits = options.limits ?? DEPLOY_LIMITS;
  const log = options.log ?? (() => {});
  if (source === out) {
    throw new Error(`El origen no puede ser la propia carpeta de despliegue, ${out}`);
  }

  const current = await loadCatalog(dirReader(source), { validateShards: true });
  if (!current) {
    throw new Error(`Falta ${join(source, 'manifest.json')}: ¿es la carpeta de un catálogo?`);
  }
  const signature = checkSignature(current.raw, options.signature ?? 'optional', options.keys);

  let previous: LoadedCatalog | null = null;
  if (options.previous) {
    const isOrigin = /^https?:\/\//.test(options.previous);
    const reader = isOrigin
      ? originReader(options.previous, options.fetchImpl ?? fetch)
      : dirReader(resolve(options.previous));
    previous = await loadCatalog(reader, { validateShards: false, reuse: current.files });
    if (!previous && !isOrigin) throw new Error(`Falta ${join(reader.label, 'manifest.json')}`);
    if (!previous) log(`  Sin versión anterior en ${reader.label} (404): primera publicación`);
    if (previous && compareVersions(current.version, previous.version) <= 0) {
      throw new Error(
        `La versión ${current.version} no es posterior a la publicada, ${previous.version}: el cliente la rechazaría`,
      );
    }
  }

  const planned = new Map<string, Buffer>(current.files);
  let previousOnly = 0;
  for (const [path, bytes] of previous?.files ?? []) {
    if (planned.has(path)) continue;
    planned.set(path, bytes);
    previousOnly++;
  }
  planned.set('manifest.json', Buffer.from(current.manifestText, 'utf8'));
  planned.set('_headers', readFileSync(options.headers ?? DEFAULT_HEADERS));

  if (planned.size > limits.maxFiles) {
    throw new Error(
      `${planned.size} ficheros: el plan gratuito admite ${limits.maxFiles} por despliegue`,
    );
  }
  for (const [path, bytes] of planned) {
    if (bytes.length > limits.maxFileBytes) {
      throw new Error(
        `${path} ocupa ${bytes.length} bytes: el máximo por fichero es ${limits.maxFileBytes}`,
      );
    }
  }

  const unreferenced = walk(source)
    .map((p) => relative(source, p).split(sep).join('/'))
    .filter((p) => !planned.has(p))
    .sort();

  rmSync(out, { recursive: true, force: true });
  await mapLimit([...planned], 32, async ([path, bytes]) => {
    const full = join(out, ...path.split('/'));
    mkdirSync(dirname(full), { recursive: true });
    await writeFile(full, bytes);
  });
  const bytes = [...planned.values()].reduce((sum, b) => sum + b.length, 0);
  return {
    version: current.version,
    previousVersion: previous?.version ?? null,
    signature,
    files: planned.size,
    bytes,
    previousOnly,
    unreferenced,
  };
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      previous: { type: 'string' },
      signature: { type: 'string', default: 'optional' },
      out: { type: 'string' },
    },
  });
  const policy = values.signature;
  if (policy !== 'optional' && policy !== 'dev' && policy !== 'prod') {
    throw new Error(`--signature=${policy} no válido (optional, dev o prod)`);
  }
  const source = resolve(positionals[0] ?? join(root, 'fixtures/catalog'));
  const out = resolve(values.out ?? DEFAULT_OUT);
  const r = await assemble({
    source,
    out,
    previous: values.previous ?? null,
    signature: policy,
    log: (line) => console.log(line),
  });
  console.log(`✓ Catálogo ${r.version} de ${source} montado en ${out} (${r.signature}):`);
  console.log(
    r.previousVersion
      ? `  conserva la versión ${r.previousVersion}: ${r.previousOnly} ficheros solo suyos`
      : '  sin versión anterior que conservar',
  );
  console.log(`  ${r.files} ficheros, ${r.bytes.toLocaleString('es-ES')} bytes.`);
  if (r.unreferenced.length > 0) {
    console.warn(
      `  ⚠ ${r.unreferenced.length} ficheros del origen no los cita el manifest y no se publican:`,
    );
    for (const p of r.unreferenced.slice(0, 20)) console.warn(`    ${p}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    console.error(`✗ ${(e as Error).message}`);
    process.exitCode = 1;
  });
}
