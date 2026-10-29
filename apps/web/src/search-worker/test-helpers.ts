// Utilidades de las pruebas del Worker: catálogo sintético publicado, Cache Storage en memoria y
// un planificador manual (las tareas cedidas se ejecutan cuando la prueba quiere).
import {
  type AliasPair,
  CatalogFlag,
  type CatalogManifest,
  type CoreRow,
  serializeAliases,
  serializeCore,
} from '@gameagenda/core/catalog-format';
import type { CatalogTexts } from './catalog-store.ts';

const { adult, free, retired, soon } = CatalogFlag;

/** Mini-catálogo en orden de rango estático (los retirados al final). */
export const ROWS: readonly CoreRow[] = [
  { appid: 730, name: 'Counter-Strike 2', flags: free, year: 2012, pop: 46 },
  { appid: 1245620, name: 'ELDEN RING', year: 2022, pop: 39 },
  { appid: 1086940, name: "Baldur's Gate 3", year: 2023, pop: 39 },
  { appid: 367520, name: 'Hollow Knight', year: 2017, pop: 37 },
  { appid: 1030300, name: 'Hollow Knight: Silksong', year: 2025, pop: 37 },
  { appid: 1145360, name: 'Hades', year: 2020, pop: 36 },
  { appid: 1145350, name: 'Hades II', year: 2025, pop: 33 },
  { appid: 504230, name: 'Celeste', year: 2018, pop: 34 },
  { appid: 3429040, name: 'Celeste & Luna', flags: adult, year: 2025, pop: 4 },
  { appid: 3779560, name: 'Celeste Blue Wizard Luna', flags: soon, year: 2026 },
  { appid: 50300, name: 'Spec Ops: The Line', flags: retired, year: 2012, pop: 31 },
];
export const ALIASES: readonly AliasPair[] = [
  ['bg3', 1086940],
  ['cs2', 730],
];

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface Published {
  readonly manifest: CatalogManifest;
  readonly files: ReadonlyMap<string, string>;
  readonly texts: CatalogTexts;
}

/** Catálogo publicado como lo deja `catalog:frozen`: *manifest* y ficheros con su *hash*. */
export async function publish(
  version: string,
  rows: readonly CoreRow[] = ROWS,
  aliases: readonly AliasPair[] = ALIASES,
): Promise<Published> {
  const core = serializeCore(rows, { version });
  const aliasText = serializeAliases(aliases, { version });
  const coreHash = await sha256(core);
  const aliasHash = await sha256(aliasText);
  const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
  const manifest: CatalogManifest = {
    format: 'gacat',
    v: 1,
    version,
    generatedAt: '2026-10-28T00:00:00Z',
    counts: { core: rows.length, aliases: aliases.length },
    files: {
      core: { path: `core.${coreHash.slice(0, 16)}.tsv`, sha256: coreHash, bytes: bytes(core) },
      aliases: {
        path: `aliases.${aliasHash.slice(0, 16)}.tsv`,
        sha256: aliasHash,
        bytes: bytes(aliasText),
      },
    },
    enrichmentAgeDays: 0,
    minClientVersion: '0.0.0',
  };
  return {
    manifest,
    files: new Map([
      [manifest.files.core.path, core],
      [manifest.files.aliases.path, aliasText],
    ]),
    texts: { manifest, core, aliases: aliasText },
  };
}

/** Cache Storage en memoria, con lo que usa el Worker. */
export class MemoryCacheStorage {
  readonly stores = new Map<string, Map<string, { body: ArrayBuffer; type: string }>>();

  private keyOf(request: RequestInfo | URL): string {
    return typeof request === 'string'
      ? request
      : request instanceof URL
        ? request.href
        : request.url;
  }

  async open(name: string): Promise<Cache> {
    let store = this.stores.get(name);
    if (!store) {
      store = new Map();
      this.stores.set(name, store);
    }
    const entries = store;
    const cache = {
      match: async (request: RequestInfo | URL) => {
        const hit = entries.get(this.keyOf(request));
        return hit
          ? new Response(hit.body.slice(0), { headers: { 'Content-Type': hit.type } })
          : undefined;
      },
      put: async (request: RequestInfo | URL, response: Response) => {
        entries.set(this.keyOf(request), {
          body: await response.arrayBuffer(),
          type: response.headers.get('Content-Type') ?? '',
        });
      },
      delete: async (request: RequestInfo | URL) => entries.delete(this.keyOf(request)),
      keys: async () => [...entries.keys()].map((url) => new Request(url)),
    };
    return cache as unknown as Cache;
  }

  async keys(): Promise<string[]> {
    return [...this.stores.keys()];
  }

  async delete(name: string): Promise<boolean> {
    return this.stores.delete(name);
  }

  async has(name: string): Promise<boolean> {
    return this.stores.has(name);
  }

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    for (const name of this.stores.keys()) {
      const hit = await (await this.open(name)).match(request);
      if (hit) return hit;
    }
    return undefined;
  }

  asCacheStorage(): CacheStorage {
    return this as unknown as CacheStorage;
  }
}

/** Servidor de catálogo en memoria para `fetch`; `offline` simula el modo avión. */
export function catalogServer(base: string) {
  let current: Published | null = null;
  const state = { offline: false, requests: [] as string[], corrupt: false };
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    state.requests.push(url);
    if (state.offline) throw new TypeError('Failed to fetch');
    if (!current || !url.startsWith(base)) return new Response('', { status: 404 });
    const path = url.slice(base.length);
    if (path === 'manifest.json') return Response.json(current.manifest);
    const text = current.files.get(path);
    if (text === undefined) return new Response('', { status: 404 });
    return new Response(state.corrupt ? `${text}x` : text);
  }) as typeof fetch;
  return {
    fetch: fetchFn,
    state,
    serve(published: Published) {
      current = published;
    },
  };
}

/** Planificador manual: las tareas cedidas esperan a `runUntil()`. */
export function manualScheduler() {
  const queue: Array<() => void> = [];
  let ran = 0;
  return {
    schedule: (task: () => void) => queue.push(task),
    /** Tareas cedidas ejecutadas hasta ahora. */
    get ran() {
      return ran;
    },
    /**
     * Ejecuta las tareas cedidas y deja avanzar las promesas (red, WebCrypto, caché) hasta que
     * se cumple `done`; falla si no llega en `timeoutMs`.
     */
    async runUntil(done: () => boolean, timeoutMs = 5000): Promise<void> {
      const limit = performance.now() + timeoutMs;
      while (!done()) {
        if (performance.now() > limit) throw new Error('El Worker no ha llegado a tiempo');
        const task = queue.shift();
        if (task) {
          task();
          ran++;
        } else {
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
      }
    },
  };
}
