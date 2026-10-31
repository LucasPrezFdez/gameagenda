// Utilidades de las pruebas del Worker: catálogo sintético publicado y firmado con la clave de
// desarrollo, Cache Storage en memoria, un servidor de catálogo en memoria y un planificador
// manual (las tareas cedidas se ejecutan cuando la prueba quiere).
import {
  type AliasPair,
  CatalogFlag,
  type CatalogManifest,
  type CoreRow,
  DETAIL_SHARDS,
  manifestSigningBytes,
  serializeAliases,
  serializeCore,
  toBase64Url,
} from '@gameagenda/core/catalog-format';
// biome-ignore lint/style/noRestrictedImports: las pruebas firman con la clave de desarrollo, que solo vive en fixtures/.
import devKeyPem from '../../../../fixtures/signing/dev-catalog-key.pem?raw';
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

/** `kid` de la clave de desarrollo (`fixtures/signing/dev-catalog-key.pem`). */
export const DEV_KID = 'dev-1';

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

let devKey: Promise<CryptoKey> | null = null;

function devSigningKey(): Promise<CryptoKey> {
  devKey ??= (async () => {
    const base64 = devKeyPem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
    const der = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    return crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, false, ['sign']);
  })();
  return devKey;
}

/** `manifest` con `sig`: ed25519 de la clave de desarrollo sobre su JSON canónico sin `sig`. */
export async function signManifest<T extends Record<string, unknown>>(
  manifest: T,
  kid = DEV_KID,
): Promise<T & { sig: { kid: string; ed25519: string } }> {
  const bytes = new Uint8Array(manifestSigningBytes(manifest));
  const signature = await crypto.subtle.sign('Ed25519', await devSigningKey(), bytes);
  return { ...manifest, sig: { kid, ed25519: toBase64Url(new Uint8Array(signature)) } };
}

export interface Published {
  /** El *manifest* tal como se sirve (firmado, salvo con `sign: false`). */
  readonly manifest: CatalogManifest;
  readonly files: ReadonlyMap<string, string>;
  readonly texts: CatalogTexts;
}

export interface PublishOptions {
  /** Filas de `recent`; `null`, un *manifest* sin `recent` (como el de M1). Por defecto, ninguna. */
  readonly recent?: readonly CoreRow[] | null;
  /**
   * Versión en la cabecera de `recent`, de los alias y del índice de *shards* (por defecto, la
   * del *manifest*): con la de una versión anterior, los mismos ficheros dan el mismo *hash*.
   */
  readonly fileVersion?: string;
  readonly killSwitches?: { readonly covers: boolean; readonly details: boolean };
  /** `false`: sin firma. */
  readonly sign?: boolean;
  /** Campos más del *manifest* (van firmados). */
  readonly extra?: Readonly<Record<string, unknown>>;
}

const bytesOf = (text: string) => new TextEncoder().encode(text).byteLength;

async function fileOf(prefix: string, ext: string, text: string) {
  const hash = await sha256(text);
  return { path: `${prefix}.${hash.slice(0, 16)}.${ext}`, sha256: hash, bytes: bytesOf(text) };
}

/**
 * Catálogo publicado como lo deja `catalog:frozen`: *manifest* firmado con la clave de desarrollo
 * y ficheros con su *hash*: núcleo, `recent`, alias e índice de *shards* (vacío).
 */
export async function publish(
  version: string,
  rows: readonly CoreRow[] = ROWS,
  aliases: readonly AliasPair[] = ALIASES,
  options: PublishOptions = {},
): Promise<Published> {
  const recentRows = options.recent === undefined ? [] : options.recent;
  const core = serializeCore(rows, { version });
  const fileVersion = options.fileVersion ?? version;
  const recent = recentRows && serializeCore(recentRows, { version: fileVersion, kind: 'recent' });
  const aliasText = serializeAliases(aliases, { version: fileVersion });
  const detailsIndex = JSON.stringify({
    format: 'gacat-details-index',
    v: 1,
    version: fileVersion,
    shards: Array.from({ length: DETAIL_SHARDS }, () => null),
  });
  const coreFile = await fileOf('core', 'tsv', core);
  const recentFile = recent === null ? null : await fileOf('recent', 'tsv', recent);
  const aliasFile = await fileOf('aliases', 'tsv', aliasText);
  const detailsFile = await fileOf('details/index', 'json', detailsIndex);
  const unsigned: Record<string, unknown> = {
    format: 'gacat',
    v: 1,
    version,
    generatedAt: `${version.slice(0, 4)}-${version.slice(4, 6)}-${version.slice(6, 8)}T03:00:00Z`,
    counts: {
      core: rows.length,
      aliases: aliases.length,
      ...(recentRows ? { recent: recentRows.length } : {}),
    },
    files: {
      core: coreFile,
      aliases: aliasFile,
      ...(recentFile ? { recent: recentFile } : {}),
      details: detailsFile,
    },
    enrichmentAgeDays: 0,
    minClientVersion: '0.0.0',
    killSwitches: options.killSwitches ?? { covers: false, details: false },
    ...options.extra,
  };
  const manifest = (
    options.sign === false ? unsigned : await signManifest(unsigned)
  ) as CatalogManifest;
  const files = new Map([
    [coreFile.path, core],
    [aliasFile.path, aliasText],
    [detailsFile.path, detailsIndex],
  ]);
  if (recentFile && recent !== null) files.set(recentFile.path, recent);
  return {
    manifest,
    files,
    texts: {
      manifest,
      coreFile: { ...coreFile, version },
      core,
      recent,
      aliases: aliasText,
    },
  };
}

/**
 * WebCrypto sin Ed25519, como el WebKit de Playwright en Windows o Safari <17: `importKey` y
 * `verify` dan `NotSupportedError`; SHA-256 sí funciona.
 */
export function subtleWithoutEd25519(): SubtleCrypto {
  const unsupported = () =>
    Promise.reject(new DOMException('Algorithm: Unrecognized name', 'NotSupportedError'));
  return {
    digest: (algorithm: AlgorithmIdentifier, data: BufferSource) =>
      crypto.subtle.digest(algorithm, data),
    importKey: unsupported,
    verify: unsupported,
  } as unknown as SubtleCrypto;
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

/**
 * Servidor de catálogo en memoria para `fetch`. Como el publicador, conserva los ficheros de las
 * versiones anteriores (`drop` quita uno); `offline` simula el modo avión y `missing`, ficheros
 * que dan 404. `bytes` suma los cuerpos servidos.
 */
export function catalogServer(base: string) {
  let current: Published | null = null;
  const files = new Map<string, string>();
  const state = {
    offline: false,
    requests: [] as string[],
    corrupt: false,
    bytes: 0,
    missing: new Set<string>(),
  };
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    state.requests.push(url);
    if (state.offline) throw new TypeError('Failed to fetch');
    if (!current || !url.startsWith(base)) return new Response('', { status: 404 });
    const path = url.slice(base.length);
    if (path === 'manifest.json') {
      const body = JSON.stringify(current.manifest);
      state.bytes += bytesOf(body);
      return new Response(body, { headers: { 'Content-Type': 'application/json' } });
    }
    const text = files.get(path);
    if (text === undefined || state.missing.has(path)) return new Response('', { status: 404 });
    const body = state.corrupt ? `${text}x` : text;
    state.bytes += bytesOf(body);
    return new Response(body);
  }) as typeof fetch;
  return {
    fetch: fetchFn,
    state,
    serve(published: Published) {
      current = published;
      for (const [path, text] of published.files) files.set(path, text);
    },
    drop(path: string) {
      files.delete(path);
    },
    /** Pone a cero el registro de peticiones y bytes. */
    reset() {
      state.requests.length = 0;
      state.bytes = 0;
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

/** Temporizador manual (`HostDeps.setTimer`): la prueba ve las esperas y las dispara. */
export function manualTimers() {
  const pending: { task: () => void; ms: number }[] = [];
  /** Esperas pedidas hasta ahora, en orden. */
  const delays: number[] = [];
  return {
    setTimer: (task: () => void, ms: number) => {
      pending.push({ task, ms });
      delays.push(ms);
    },
    delays,
    get pending() {
      return pending.map((p) => p.ms);
    },
    /** Dispara la primera espera pendiente. */
    fire(): void {
      const next = pending.shift();
      if (!next) throw new Error('No hay ningún temporizador pendiente');
      next.task();
    },
  };
}
