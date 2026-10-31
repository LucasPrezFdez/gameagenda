// El catálogo publicado en `ga-catalog` (§5.4 y §12.5 de prototipe.md): leer su *manifest*,
// comparar versiones y calcular la siguiente. La versión nueva tiene que ser posterior a la
// publicada, porque el cliente rechaza las anteriores a la suya (§11.3); por eso `catalog.yml` no
// deja que el pipeline la saque de `pipeline/out/` (en el *runner* está vacía) y se la pasa con
// `--version`.
//
// Uso: node scripts/catalog-live.ts next-version --origin=<url> [--now=<ISO>] [--no-previous]
// Escribe `version` y `previous` en `$GITHUB_OUTPUT` (si existe) y en la salida.
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { type CatalogManifest, catalogManifestSchema } from '@gameagenda/core/catalog-format';
import { madridDate } from '../pipeline/src/clock.ts';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const RE_VERSION = /^(\d{8})\.([1-9]\d*)$/;

function parseVersion(v: string): [day: string, n: number] {
  const m = RE_VERSION.exec(v);
  if (!m) throw new Error(`Versión del catálogo no válida: «${v}»`);
  return [m[1] as string, Number(m[2])];
}

/** Orden de las versiones `AAAAMMDD.N`: negativo si `a` es anterior a `b`. */
export function compareVersions(a: string, b: string): number {
  const [da, na] = parseVersion(a);
  const [db, nb] = parseVersion(b);
  return da === db ? na - nb : da < db ? -1 : 1;
}

/**
 * Versión de una ejecución en `runAt`: `AAAAMMDD.1` del día en Europe/Madrid o, si la publicada
 * es de ese día o posterior (dos ejecuciones el mismo día, o un `catalog:stage` del día
 * anterior), la siguiente a la publicada.
 */
export function nextVersion(runAt: number, previous: string | null): string {
  const day = madridDate(runAt).replaceAll('-', '');
  if (previous === null) return `${day}.1`;
  const [pday, n] = parseVersion(previous);
  return pday < day ? `${day}.1` : `${pday}.${n + 1}`;
}

/** URL de `path` en el origen del catálogo (con o sin `/` final). */
export function catalogUrl(origin: string, path: string): string {
  return new URL(path, origin.endsWith('/') ? origin : `${origin}/`).href;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** GET con reintentos ante errores de red y 5xx (1, 2 y 4 s); un 4xx se devuelve tal cual. */
export async function fetchWithRetry(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit = {},
  tries = 4,
): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(30_000) });
      if (res.status < 500 || attempt >= tries) return res;
      await res.body?.cancel();
    } catch (e) {
      if (attempt >= tries) throw new Error(`${url}: ${(e as Error).message}`);
    }
    await sleep(1000 * 2 ** (attempt - 1));
  }
}

/** Ejecuta `task` sobre `items` con, como mucho, `limit` a la vez. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await task(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export interface LiveManifest {
  readonly text: string;
  readonly manifest: CatalogManifest;
}

/**
 * El *manifest* publicado en `origin`, o `null` si no hay ninguno (404: primera publicación).
 * Cualquier otro fallo es un error: sin saber qué hay publicado no se puede conservar.
 */
export async function readLiveManifest(
  origin: string,
  fetchImpl: FetchLike = fetch,
): Promise<LiveManifest | null> {
  const url = catalogUrl(origin, 'manifest.json');
  const res = await fetchWithRetry(fetchImpl, url, { cache: 'no-store' });
  if (res.status === 404) {
    await res.body?.cancel();
    return null;
  }
  if (!res.ok) throw new Error(`${url} responde ${res.status}`);
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${url} no es JSON`);
  }
  const parsed = catalogManifestSchema.safeParse(json);
  if (!parsed.success) throw new Error(`${url} no cumple el esquema: ${parsed.error.message}`);
  return { text, manifest: parsed.data };
}

export function writeGithubOutput(values: Readonly<Record<string, string>>): void {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  appendFileSync(
    file,
    Object.entries(values)
      .map(([k, v]) => `${k}=${v}\n`)
      .join(''),
  );
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      origin: { type: 'string' },
      now: { type: 'string' },
      'no-previous': { type: 'boolean', default: false },
    },
  });
  if (positionals[0] !== 'next-version') throw new Error('Uso: catalog-live.ts next-version …');
  const runAt = values.now ? Date.parse(values.now) : Date.now();
  if (!Number.isFinite(runAt)) throw new Error(`--now no válido: ${values.now}`);
  let previous: string | null = null;
  if (!values['no-previous']) {
    if (!values.origin) throw new Error('Falta --origin');
    const live = await readLiveManifest(values.origin);
    previous = live?.manifest.version ?? null;
    console.log(
      live ? `Publicada: ${previous} en ${values.origin}` : `Sin catálogo en ${values.origin}`,
    );
  } else {
    console.log('Sin versión anterior (--no-previous)');
  }
  const version = nextVersion(runAt, previous);
  console.log(`Versión nueva: ${version}`);
  writeGithubOutput({ version, previous: previous ?? '' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    console.error(`✗ ${(e as Error).message}`);
    process.exitCode = 1;
  });
}
