// Utilidades de las pruebas de los detalles: índice y *shards* publicados como los deja el
// pipeline (§7.6), con su *hash* en el nombre, y un servidor en memoria para `fetch`.
import {
  DETAIL_SHARDS,
  type DetailShard,
  detailShardOf,
  detailShardPath,
  type GameDetails,
} from '@gameagenda/core/catalog-format';
import type { CatalogFileRef, CatalogInfo } from '../search-client/protocol.ts';

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Detalles de prueba: `[fmt, capsule, header, release, reviews, plat, deck]`. */
export function gameDetails(appid: number, overrides: Partial<{ capsule: string | null }> = {}) {
  const details: GameDetails = [
    `steam/apps/${appid}/\${FILENAME}?t=1700000000`,
    overrides.capsule === undefined ? 'library_600x900.jpg' : overrides.capsule,
    'header.jpg',
    [1700000000, 'day'],
    [8, 1234, 93],
    3,
    3,
  ];
  return details;
}

export interface PublishedDetails {
  readonly index: CatalogFileRef;
  readonly files: ReadonlyMap<string, string>;
  /** Ruta de cada *shard* publicado, por número. */
  readonly shardPaths: ReadonlyMap<number, string>;
  readonly catalog: CatalogInfo;
}

/** Índice y *shards* de `games` (por `appid`), en la versión `version`. */
export async function publishDetails(
  games: Readonly<Record<number, GameDetails>>,
  version = '20261028.1',
): Promise<PublishedDetails> {
  const byShard = new Map<number, DetailShard>();
  for (const [key, details] of Object.entries(games)) {
    const shard = detailShardOf(Number(key));
    const data = byShard.get(shard) ?? {};
    data[key] = details;
    byShard.set(shard, data);
  }
  const files = new Map<string, string>();
  const shardPaths = new Map<number, string>();
  const hashes: Array<string | null> = Array.from({ length: DETAIL_SHARDS }, () => null);
  for (const [shard, data] of byShard) {
    const text = JSON.stringify(data);
    const hash = (await sha256(text)).slice(0, 16);
    hashes[shard] = hash;
    const path = detailShardPath(shard, hash);
    files.set(path, text);
    shardPaths.set(shard, path);
  }
  const indexText = JSON.stringify({
    format: 'gacat-details-index',
    v: 1,
    version,
    shards: hashes,
  });
  const indexHash = await sha256(indexText);
  const index: CatalogFileRef = {
    path: `details/index.${indexHash.slice(0, 16)}.json`,
    sha256: indexHash,
    bytes: new TextEncoder().encode(indexText).byteLength,
  };
  files.set(index.path, indexText);
  return {
    index,
    files,
    shardPaths,
    catalog: {
      version,
      generatedAt: '2026-10-28T00:00:00Z',
      enrichmentAgeDays: 0,
      killSwitches: { covers: false, details: false },
      detailsIndex: index,
    },
  };
}

/** Servidor de ficheros en memoria para `fetch`; `offline` simula el modo avión. */
export function detailsServer(base: string) {
  const files = new Map<string, string>();
  const state = { offline: false, requests: [] as string[] };
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    state.requests.push(url.slice(base.length));
    if (state.offline) throw new TypeError('Failed to fetch');
    const text = url.startsWith(base) ? files.get(url.slice(base.length)) : undefined;
    return text === undefined ? new Response('', { status: 404 }) : new Response(text);
  }) as typeof fetch;
  return {
    fetch: fetchFn,
    state,
    serve(published: PublishedDetails, overrides: Readonly<Record<string, string>> = {}) {
      for (const [path, text] of published.files) files.set(path, text);
      for (const [path, text] of Object.entries(overrides)) files.set(path, text);
    },
  };
}
