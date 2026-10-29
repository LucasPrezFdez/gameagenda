// Puerta de tamaño (ver §6.2 y §12.4 de prototipe.md): comprime con brotli (calidad 11) el JS
// inicial del *build* de producción, según `.vite/manifest.json`, y el *chunk* de entrada del
// Worker de búsqueda, y falla si alguno pasa de su presupuesto. Comprueba también que el *build*
// de producción no lleva la página de prueba de `npm run perf` (`apps/web/perf/`).
//
// Uso: npm run build && npm run size  (KB = 1000 bytes, como los informes de Vite).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants } from 'node:zlib';

const root = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(root, 'apps/web/dist');
const MANIFEST = join(DIST, '.vite/manifest.json');

/** Presupuestos brotli de la §6.2, en bytes. */
const BUDGETS = {
  initial: 150_000,
  worker: 40_000,
} as const;

/** Lo que la página de prueba de `perf` deja en cualquier fichero suyo (ver `apps/web/perf/`). */
const PERF_BENCH_MARKER = 'gameagenda-perf-bench';

interface ManifestChunk {
  readonly file: string;
  readonly src?: string;
  readonly isEntry?: boolean;
  readonly imports?: readonly string[];
  readonly assets?: readonly string[];
}

type Manifest = Readonly<Record<string, ManifestChunk>>;

function brotli(file: string): number {
  const bytes = readFileSync(join(DIST, file));
  return brotliCompressSync(bytes, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
    },
  }).length;
}

/** Ficheros JS que se cargan antes de pintar: las entradas y sus `imports` estáticos. */
function initialFiles(manifest: Manifest): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  const visit = (key: string): void => {
    if (seen.has(key)) return;
    seen.add(key);
    const chunk = manifest[key];
    if (!chunk) throw new Error(`El manifest no tiene «${key}»`);
    files.push(chunk.file);
    for (const dep of chunk.imports ?? []) visit(dep);
  };
  for (const [key, chunk] of Object.entries(manifest)) if (chunk.isEntry) visit(key);
  return files;
}

const RE_WORKER = /new Worker\(\s*new URL\(\s*[`'"]\/?([^`'"]+\.js)[`'"]/g;

/**
 * *Chunks* de entrada de los Workers: Vite los emite como `assets` de quien los crea y la
 * llamada queda como `new Worker(new URL("/assets/…js", import.meta.url), …)`.
 */
function workerFiles(manifest: Manifest, read: (file: string) => string): string[] {
  const assets = new Set(
    Object.values(manifest).flatMap((chunk) =>
      (chunk.assets ?? []).filter((a) => a.endsWith('.js')),
    ),
  );
  const found = new Set<string>();
  for (const chunk of Object.values(manifest)) {
    for (const match of read(chunk.file).matchAll(RE_WORKER)) {
      const file = match[1] as string;
      if (assets.has(file)) found.add(file);
    }
  }
  return [...found];
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const kb = (bytes: number): string =>
  `${(bytes / 1000).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KB`;

function main(): void {
  if (!existsSync(MANIFEST)) {
    console.error(`✗ Falta ${MANIFEST}: ejecuta antes «npm run build».`);
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest;
  const read = (file: string) => readFileSync(join(DIST, file), 'utf8');
  let failed = false;
  const report = (label: string, files: readonly string[], budget: number): void => {
    const sizes = files.map((file) => ({ file, size: brotli(file) }));
    const total = sizes.reduce((sum, s) => sum + s.size, 0);
    const ok = total <= budget;
    failed ||= !ok;
    console.log(`${ok ? '✓' : '✗'} ${label}: ${kb(total)} brotli (presupuesto ${kb(budget)})`);
    for (const s of sizes) console.log(`    ${s.file}  ${kb(s.size)}`);
  };

  const initial = initialFiles(manifest);
  if (initial.length === 0) {
    console.error('✗ El manifest no tiene ninguna entrada.');
    process.exit(1);
  }
  report('JS inicial', initial, BUDGETS.initial);

  const workers = workerFiles(manifest, read);
  if (workers.length !== 1) {
    console.error(
      `✗ Se esperaba un Worker de búsqueda y hay ${workers.length}: ${workers.join(', ') || '—'}.`,
    );
    process.exit(1);
  }
  report('Worker de búsqueda (chunk de entrada)', workers, BUDGETS.worker);

  // La página de prueba de `perf` va en su propio *build* (`dist-perf`), nunca en el de producción.
  const leaks = walk(DIST).filter(
    (path) =>
      /\.(html|js|json|webmanifest)$/.test(path) &&
      readFileSync(path, 'utf8').includes(PERF_BENCH_MARKER),
  );
  const fromPerf = Object.values(manifest).filter((chunk) => chunk.src?.startsWith('perf/'));
  if (leaks.length > 0 || fromPerf.length > 0) {
    failed = true;
    console.log('✗ El build de producción lleva la página de prueba de perf:');
    for (const path of leaks) console.log(`    ${path}`);
    for (const chunk of fromPerf) console.log(`    ${chunk.src}`);
  } else {
    console.log('✓ El build de producción no lleva la página de prueba de perf');
  }

  if (failed) process.exit(1);
}

main();
