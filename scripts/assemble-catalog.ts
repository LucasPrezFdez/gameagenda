// Carpeta que despliega `ga-catalog` (§7.6 y §15.3 de prototipe.md; CA0.2 y CA0.3): copia un
// catálogo ya construido a `pipeline/dist/` y le añade `pipeline/catalog.headers` como `_headers`.
// Antes comprueba el *manifest* con el esquema de `core` y que cada fichero que cita existe, con
// sus bytes, su SHA-256 y el prefijo del *hash* en el nombre (las reglas de `_headers` los cachean
// como inmutables). No escribe en la carpeta de origen: `fixtures/catalog/` es del generador.
//
// Uso: node scripts/assemble-catalog.ts [carpeta]  (por defecto, fixtures/catalog; desde M2,
// pipeline/out) y después `npx wrangler deploy -c pipeline/wrangler.jsonc`.
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogManifestSchema } from '@gameagenda/core/catalog-format';

const root = fileURLToPath(new URL('..', import.meta.url));
/** `assets.directory` de `pipeline/wrangler.jsonc`. */
const OUT = join(root, 'pipeline/dist');
const HEADERS = join(root, 'pipeline/catalog.headers');

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

/** Comprueba el *manifest* de `dir` y los ficheros que cita; devuelve su versión. */
function checkCatalog(dir: string): string {
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) fail(`Falta ${manifestPath}: ¿es la carpeta de un catálogo?`);
  const parsed = catalogManifestSchema.safeParse(JSON.parse(readFileSync(manifestPath, 'utf8')));
  if (!parsed.success) fail(`${manifestPath} no cumple el esquema: ${parsed.error.message}`);
  for (const [kind, spec] of Object.entries(parsed.data.files)) {
    if (!spec) continue;
    const path = join(dir, spec.path);
    if (!existsSync(path)) fail(`El manifest cita ${spec.path} (${kind}) y no está en ${dir}`);
    const bytes = readFileSync(path);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== spec.bytes) fail(`${spec.path}: ${bytes.length} bytes, no ${spec.bytes}`);
    if (sha256 !== spec.sha256) fail(`${spec.path}: el SHA-256 no coincide con el del manifest`);
    if (!spec.path.includes(`.${sha256.slice(0, 16)}.`)) {
      fail(`${spec.path}: el nombre no lleva el prefijo de su hash, ${sha256.slice(0, 16)}`);
    }
  }
  return parsed.data.version;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function main(): void {
  const source = resolve(process.argv[2] ?? join(root, 'fixtures/catalog'));
  if (source === OUT) fail(`El origen no puede ser la propia carpeta de despliegue, ${OUT}`);
  const version = checkCatalog(source);

  rmSync(OUT, { recursive: true, force: true });
  cpSync(source, OUT, { recursive: true });
  copyFileSync(HEADERS, join(OUT, '_headers'));

  const files = walk(OUT);
  const total = files.reduce((sum, path) => sum + statSync(path).size, 0);
  console.log(`✓ Catálogo ${version} de ${source} montado en ${OUT}:`);
  for (const path of files) console.log(`    ${relative(OUT, path)}`);
  console.log(`  ${files.length} ficheros, ${total.toLocaleString('es-ES')} bytes.`);
}

main();
