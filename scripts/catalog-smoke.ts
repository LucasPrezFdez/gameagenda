// Prueba de humo de `ga-catalog` tras desplegar (§5.4, §7.6 y §12.5 de prototipe.md; CA0.2,
// CA0.3, CA2.4 y CA2.7). Compara lo publicado con `pipeline/dist/`, byte a byte:
// - `manifest.json`: el mismo texto que el montado, firmado con una clave `prod`, `no-cache` y
//   con CORS para `ga-web`. Espera hasta 2 min a que el CDN sirva la versión nueva;
// - cada fichero de la carpeta (los de la versión nueva **y** los de la anterior, CA2.4): 200, el
//   mismo SHA-256, CORS, `immutable` y, los TSV, `text/plain; charset=utf-8` (comprimidos: si no,
//   avisa; R-16);
// - un fichero con *hash* que no existe da 404, también con CORS (el cliente ve el 404, §5.4).
// Deja en `$GITHUB_STEP_SUMMARY` la tabla de cabeceras que hacía `deploy-catalog.yml` en M0.
//
// Uso: node scripts/catalog-smoke.ts --url=<workers.dev> --web-origin=<origen de ga-web>
//        [--dist=pipeline/dist] [--expect-origin=<CATALOG_ORIGIN>] [--report=<fichero.json>]
//        [--signature=prod|dev|optional]  (por defecto, prod; `optional`, para el de M0 sin firma)
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { checkSignature, type SignaturePolicy } from './assemble-catalog.ts';
import { catalogUrl, type FetchLike, fetchWithRetry, mapLimit } from './catalog-live.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const MISSING = 'core.0000000000000000.tsv';

export interface SmokeRow {
  readonly path: string;
  readonly status: number;
  readonly contentType: string;
  readonly cacheControl: string;
  readonly contentEncoding: string;
  readonly cors: string;
}

export interface SmokeResult {
  readonly version: string;
  readonly checked: number;
  readonly rows: readonly SmokeRow[];
  readonly problems: readonly string[];
  readonly warnings: readonly string[];
}

export interface SmokeOptions {
  readonly url: string;
  readonly dist: string;
  readonly webOrigin: string;
  readonly expectOrigin?: string | null;
  readonly signature?: SignaturePolicy;
  readonly fetchImpl?: FetchLike;
  readonly waitMs?: number;
  readonly pollMs?: number;
}

/** Rutas publicadas (con `/`) de todos los ficheros de `dir`. */
function filesOf(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory()
      ? filesOf(path, base)
      : [relative(base, path).split(sep).join('/')];
  });
}

const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

export async function smoke(options: SmokeOptions): Promise<SmokeResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const problems: string[] = [];
  const warnings: string[] = [];
  const rows: SmokeRow[] = [];
  const headers = { Origin: options.webOrigin };
  const row = (path: string, res: Response): SmokeRow => {
    const h = (name: string): string => res.headers.get(name) ?? '';
    return {
      path,
      status: res.status,
      contentType: h('content-type'),
      cacheControl: h('cache-control'),
      contentEncoding: h('content-encoding'),
      cors: h('access-control-allow-origin'),
    };
  };

  const expectedText = readFileSync(join(options.dist, 'manifest.json'), 'utf8');
  const expected = JSON.parse(expectedText) as Record<string, unknown>;
  const version = String(expected.version);

  // El CDN puede tardar unos segundos en servir el despliegue nuevo.
  const deadline = Date.now() + (options.waitMs ?? 120_000);
  let manifestRow: SmokeRow | null = null;
  let servedText = '';
  for (;;) {
    const res = await fetchWithRetry(fetchImpl, catalogUrl(options.url, 'manifest.json'), {
      headers,
      cache: 'no-store',
    });
    manifestRow = row('manifest.json', res);
    servedText = await res.text();
    if ((res.ok && servedText === expectedText) || Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, options.pollMs ?? 3000));
  }
  rows.push(manifestRow);
  if (manifestRow.status !== 200) {
    problems.push(`manifest.json responde ${manifestRow.status}`);
  } else if (servedText !== expectedText) {
    problems.push(`manifest.json no es el montado (versión ${version}) tras esperar al CDN`);
  }
  if (manifestRow.cacheControl !== 'no-cache') {
    problems.push('manifest.json sin Cache-Control: no-cache');
  }
  if (manifestRow.cors !== options.webOrigin) {
    problems.push(`manifest.json sin CORS para ${options.webOrigin} («${manifestRow.cors}»)`);
  }
  try {
    checkSignature(JSON.parse(servedText) as Record<string, unknown>, options.signature ?? 'prod');
  } catch (e) {
    problems.push(`manifest.json publicado: ${(e as Error).message}`);
  }

  const paths = filesOf(options.dist).filter((p) => p !== 'manifest.json' && p !== '_headers');
  // Para la tabla: los ficheros de primer nivel y un *shard*; el resto solo se cuenta.
  const listed = new Set(paths.filter((p) => !p.includes('/') || p.startsWith('details/index.')));
  const firstShard = paths.find((p) => p.startsWith('details/') && !p.startsWith('details/index.'));
  if (firstShard) listed.add(firstShard);
  await mapLimit(paths, 16, async (path) => {
    const res = await fetchWithRetry(fetchImpl, catalogUrl(options.url, path), { headers });
    const r = row(path, res);
    if (listed.has(path)) rows.push(r);
    if (res.status !== 200) {
      problems.push(`${path} responde ${res.status}`);
      await res.body?.cancel();
      return;
    }
    const body = new Uint8Array(await res.arrayBuffer());
    if (sha256(body) !== sha256(readFileSync(join(options.dist, ...path.split('/'))))) {
      problems.push(`${path}: lo servido no es el fichero montado`);
    }
    if (r.cors !== options.webOrigin) problems.push(`${path} sin CORS para ${options.webOrigin}`);
    if (!r.cacheControl.includes('immutable')) problems.push(`${path} sin Cache-Control immutable`);
    if (path.endsWith('.tsv')) {
      if (r.contentType !== 'text/plain; charset=utf-8') {
        problems.push(`${path} no es text/plain; charset=utf-8 («${r.contentType}»)`);
      }
      if (path.startsWith('core.') && !r.contentEncoding) {
        warnings.push(`${path} llega sin Content-Encoding (CA0.3, R-16)`);
      }
    }
  });
  rows.sort((a, b) =>
    a.path === 'manifest.json' ? -1 : b.path === 'manifest.json' ? 1 : a.path.localeCompare(b.path),
  );

  const missing = await fetchWithRetry(fetchImpl, catalogUrl(options.url, MISSING), { headers });
  await missing.body?.cancel();
  rows.push(row(MISSING, missing));
  if (missing.status !== 404) problems.push(`un fichero que no existe responde ${missing.status}`);
  if (missing.headers.get('access-control-allow-origin') !== options.webOrigin) {
    problems.push('el 404 no lleva CORS: el cliente lo vería como un fallo de red (§5.4)');
  }

  if (options.expectOrigin) {
    const got = new URL(options.url).origin;
    const want = new URL(options.expectOrigin).origin;
    if (got !== want) {
      problems.push(
        `wrangler ha publicado en ${got} y CATALOG_ORIGIN es ${want}: cambia la variable CATALOG_ORIGIN (y, en la app, VITE_CATALOG_URL y connect-src) o la próxima ejecución no conservará esta versión`,
      );
    }
  }
  return { version, checked: paths.length + 2, rows, problems, warnings };
}

/** Tabla en Markdown para el resumen del trabajo. */
export function renderSmoke(url: string, r: SmokeResult): string {
  const lines = [
    `### Prueba de humo de ga-catalog (${r.version})`,
    '',
    `${url}: ${r.checked} peticiones, ${r.problems.length === 0 ? 'todas correctas' : `${r.problems.length} problemas`}.`,
    '',
    '| Ruta | HTTP | Content-Type | Cache-Control | Content-Encoding | CORS |',
    '|---|---|---|---|---|---|',
    ...r.rows.map(
      (x) =>
        `| \`${x.path}\` | ${x.status} | ${x.contentType} | ${x.cacheControl} | ${x.contentEncoding} | ${x.cors} |`,
    ),
  ];
  for (const p of r.problems) lines.push('', `- ✗ ${p}`);
  for (const w of r.warnings) lines.push('', `- ⚠ ${w}`);
  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      url: { type: 'string' },
      dist: { type: 'string', default: join(root, 'pipeline/dist') },
      'web-origin': { type: 'string' },
      'expect-origin': { type: 'string' },
      report: { type: 'string' },
      signature: { type: 'string', default: 'prod' },
    },
  });
  if (!values.url || !values['web-origin']) throw new Error('Faltan --url o --web-origin');
  const signature = values.signature;
  if (signature !== 'optional' && signature !== 'dev' && signature !== 'prod') {
    throw new Error(`--signature=${signature} no válido (optional, dev o prod)`);
  }
  const result = await smoke({
    signature,
    url: values.url,
    dist: values.dist,
    webOrigin: values['web-origin'],
    expectOrigin: values['expect-origin'] ?? null,
  });
  const md = renderSmoke(values.url, result);
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  if (values.report) {
    mkdirSync(dirname(values.report), { recursive: true });
    writeFileSync(values.report, `${JSON.stringify(result, null, 1)}\n`);
  }
  for (const w of result.warnings) console.log(`::warning::${w}`);
  for (const p of result.problems) console.log(`::error::${p}`);
  if (result.problems.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    console.error(`✗ ${(e as Error).message}`);
    process.exitCode = 1;
  });
}
