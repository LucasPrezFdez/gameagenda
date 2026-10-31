// Detalles del catálogo en el hilo principal (§7.6): el índice de *shards* que da el *manifest*
// (`CatalogInfo.detailsIndex`, comprobado con su `sha256`) y solo los *shards* que se piden, cada
// uno comprobado con el *hash* de su nombre (WebCrypto) y con su esquema Zod. Se guardan en Cache
// Storage (`gacat-details`) y, al cambiar el índice, se borra lo que ya no es suyo.
//
// Va en un *chunk* diferido (Zod no entra en el JS inicial) y no hace tareas largas: cada *shard*
// (≈31 KB, ≈192 juegos) se lee en su propia tarea, cediendo el hilo entre uno y otro.
import {
  type DetailShard,
  type DetailsIndex,
  detailShardOf,
  detailShardPath,
  detailShardSchema,
  detailsIndexSchema,
  type GameDetailsView,
  viewDetails,
} from '@gameagenda/core/catalog-format';
import type { CatalogFileRef } from '../search-client/protocol.ts';

export const DETAILS_CACHE = 'gacat-details';
/** *Shards* ya leídos que se quedan en memoria (la paleta salta de uno a otro). */
const MEMORY_SHARDS = 16;
const DEFAULT_CONCURRENCY = 4;

export interface DetailsSourceDeps {
  readonly fetch: typeof fetch;
  /** `null` donde no hay Cache Storage: se descarga cada vez. */
  readonly caches: CacheStorage | null;
  readonly subtle: SubtleCrypto;
  /** URL absoluta de la carpeta del catálogo, terminada en `/` (`catalogBaseUrl()`). */
  readonly baseUrl: string;
  /** Cede el hilo entre *shards*. */
  readonly yieldToMain?: () => Promise<void>;
  /** *Shards* que se piden a la vez. */
  readonly concurrency?: number;
}

/** Detalles de cada `appid` pedido: `null` si su *shard* no lo trae. */
export type ShardResult = ReadonlyMap<number, GameDetailsView | null>;

export interface DetailsLoad {
  /** `appid` cuyo *shard* no se ha podido leer (sin red y sin caché, o no válido). */
  readonly failed: readonly number[];
}

export interface DetailsSource {
  /**
   * Detalles de `appids`, agrupados por *shard*: `onShard` recibe los de cada uno en cuanto
   * llega. Si el índice no se puede leer, la promesa se rechaza.
   */
  load(
    ref: CatalogFileRef,
    appids: readonly number[],
    onShard: (result: ShardResult) => void,
  ): Promise<DetailsLoad>;
  /** Borra de `gacat-details` lo que no es de este índice (versiones anteriores). */
  evict(ref: CatalogFileRef): Promise<number>;
  /** Olvida lo que tiene en memoria (tras «Borrar los datos de Steam»). */
  clearMemory(): void;
}

export class DetailsError extends Error {
  readonly code: 'network' | 'http' | 'integrity' | 'format';

  constructor(code: DetailsError['code'], message: string) {
    super(message);
    this.name = 'DetailsError';
    this.code = code;
  }
}

function toHex(buffer: ArrayBuffer): string {
  let out = '';
  for (const byte of new Uint8Array(buffer)) out += byte.toString(16).padStart(2, '0');
  return out;
}

const decoder = new TextDecoder('utf-8');

function defaultYield(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function createDetailsSource(deps: DetailsSourceDeps): DetailsSource {
  const urlOf = (path: string): string => new URL(path, deps.baseUrl).href;
  const yieldToMain = deps.yieldToMain ?? defaultYield;
  const concurrency = Math.max(1, deps.concurrency ?? DEFAULT_CONCURRENCY);
  let index: { readonly path: string; readonly value: Promise<DetailsIndex> } | null = null;
  /** LRU de *shards* leídos, por URL. */
  const shards = new Map<string, DetailShard>();
  const pendingShards = new Map<string, Promise<DetailShard>>();
  let cache: Promise<Cache | null> | null = null;

  function openCache(): Promise<Cache | null> {
    if (!deps.caches) return Promise.resolve(null);
    cache ??= deps.caches.open(DETAILS_CACHE).catch(() => null);
    return cache;
  }

  async function download(url: string): Promise<Uint8Array<ArrayBuffer>> {
    let response: Response;
    try {
      // Inmutables (el *hash* va en el nombre), pero `ga-catalog` sirve también los 404 con
      // `immutable` (ADR-003): si falla, otra vez sin la caché HTTP, como el Worker de búsqueda.
      response = await deps.fetch(url);
      if (!response.ok) response = await deps.fetch(url, { cache: 'reload' });
    } catch {
      throw new DetailsError('network', `Sin red: ${url}`);
    }
    if (!response.ok) throw new DetailsError('http', `${url}: HTTP ${response.status}`);
    try {
      return new Uint8Array(await response.arrayBuffer());
    } catch {
      throw new DetailsError('network', `Descarga cortada: ${url}`);
    }
  }

  async function digestHex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
    return toHex(await deps.subtle.digest('SHA-256', bytes));
  }

  /** Bytes válidos de `url`: de la caché si están y valen; si no, de la red (y a la caché). */
  async function readVerified(
    url: string,
    valid: (bytes: Uint8Array<ArrayBuffer>) => Promise<boolean>,
  ): Promise<Uint8Array<ArrayBuffer>> {
    const store = await openCache();
    const hit = await store?.match(url).catch(() => undefined);
    if (hit) {
      const bytes = new Uint8Array(await hit.arrayBuffer());
      if (await valid(bytes)) return bytes;
      await store?.delete(url).catch(() => false);
    }
    const bytes = await download(url);
    if (!(await valid(bytes)))
      throw new DetailsError('integrity', `${url} no coincide con su hash`);
    await store
      ?.put(
        url,
        new Response(bytes, { headers: { 'Content-Type': 'application/json; charset=utf-8' } }),
      )
      .catch(() => undefined);
    return bytes;
  }

  function parseJson(bytes: Uint8Array<ArrayBuffer>, url: string): unknown {
    try {
      return JSON.parse(decoder.decode(bytes));
    } catch {
      throw new DetailsError('format', `${url} no es JSON`);
    }
  }

  async function readIndex(ref: CatalogFileRef): Promise<DetailsIndex> {
    const url = urlOf(ref.path);
    const bytes = await readVerified(
      url,
      async (b) => b.byteLength === ref.bytes && (await digestHex(b)) === ref.sha256,
    );
    const parsed = detailsIndexSchema.safeParse(parseJson(bytes, url));
    if (!parsed.success) throw new DetailsError('format', `${url} no es un índice de detalles`);
    return parsed.data;
  }

  function getIndex(ref: CatalogFileRef): Promise<DetailsIndex> {
    if (index?.path !== ref.path) {
      const value = readIndex(ref);
      index = { path: ref.path, value };
      // Un fallo no se queda en memoria: la próxima petición lo vuelve a intentar.
      value.catch(() => {
        if (index?.value === value) index = null;
      });
    }
    return index.value;
  }

  async function readShard(url: string, hash: string): Promise<DetailShard> {
    const bytes = await readVerified(url, async (b) => (await digestHex(b)).startsWith(hash));
    await yieldToMain();
    const parsed = detailShardSchema.safeParse(parseJson(bytes, url));
    if (!parsed.success) throw new DetailsError('format', `${url} no es un shard de detalles`);
    return parsed.data;
  }

  function getShard(shard: number, hash: string): Promise<DetailShard> {
    const url = urlOf(detailShardPath(shard, hash));
    const memory = shards.get(url);
    if (memory) {
      shards.delete(url);
      shards.set(url, memory);
      return Promise.resolve(memory);
    }
    let pending = pendingShards.get(url);
    if (!pending) {
      pending = readShard(url, hash)
        .then((value) => {
          shards.set(url, value);
          while (shards.size > MEMORY_SHARDS) {
            const oldest = shards.keys().next().value;
            if (oldest === undefined) break;
            shards.delete(oldest);
          }
          return value;
        })
        .finally(() => pendingShards.delete(url));
      pendingShards.set(url, pending);
    }
    return pending;
  }

  return {
    async load(ref, appids, onShard) {
      const detailsIndex = await getIndex(ref);
      const byShard = new Map<number, number[]>();
      for (const appid of new Set(appids)) {
        const shard = detailShardOf(appid);
        const list = byShard.get(shard);
        if (list) list.push(appid);
        else byShard.set(shard, [appid]);
      }
      // *Shards* sin juegos: nada que pedir.
      const empty = new Map<number, null>();
      const queue: Array<[number, string, number[]]> = [];
      for (const [shard, list] of byShard) {
        const hash = detailsIndex.shards[shard];
        if (hash == null) for (const appid of list) empty.set(appid, null);
        else queue.push([shard, hash, list]);
      }
      if (empty.size > 0) onShard(empty);

      const failed: number[] = [];
      const worker = async (): Promise<void> => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          const [shard, hash, list] = next;
          try {
            const data = await getShard(shard, hash);
            const result = new Map<number, GameDetailsView | null>();
            for (const appid of list) {
              const details = data[String(appid)];
              result.set(appid, details ? viewDetails(details) : null);
            }
            onShard(result);
          } catch {
            failed.push(...list);
          }
          await yieldToMain();
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
      return { failed };
    },

    async evict(ref) {
      const store = await openCache();
      if (!store) return 0;
      const detailsIndex = await getIndex(ref);
      const keep = new Set([urlOf(ref.path)]);
      detailsIndex.shards.forEach((hash, shard) => {
        if (hash !== null) keep.add(urlOf(detailShardPath(shard, hash)));
      });
      let removed = 0;
      for (const request of await store.keys()) {
        if (keep.has(request.url)) continue;
        if (await store.delete(request)) removed += 1;
      }
      return removed;
    },

    clearMemory() {
      index = null;
      shards.clear();
      cache = null;
    },
  };
}
