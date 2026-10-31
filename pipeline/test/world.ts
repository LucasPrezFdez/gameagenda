// Steam de mentira para las puertas del CA2.2 (no es un fichero de pruebas): un «mundo» de juegos
// sacado de la copia congelada del núcleo real (`fixtures/catalog-frozen/`) y un transporte que
// contesta `GetAppList`, Query y `GetItems` como Steam con ese mundo. Así el pipeline entero, con
// el conjunto dorado real y todas las puertas de búsqueda, corre sin red sobre ≈3 000 juegos, y
// cada prueba cambia el mundo para forzar el fallo de una puerta.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { CatalogFlag, parseCore } from '@gameagenda/core/catalog-format';
import { type GoldenQuery, parseGolden } from '@gameagenda/core/search-quality';
import { PUBLISH_GATES, SENTINELS } from '../src/gates.ts';
import type { Profile } from '../src/run.ts';
import type { Transport, TransportResponse } from '../steam/client.ts';
import { endpointOf } from '../steam/endpoints.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export interface WorldGame {
  readonly appid: number;
  /** Nombre base (`GetAppList`). */
  readonly name: string;
  /** Nombre en `spanish` (Query), si es otro. */
  readonly nameEs?: string;
  readonly reviews: number;
  /** Bits de la §7.6 sin el de retirado. */
  readonly flags: number;
  readonly year: number;
}

export interface World {
  readonly games: Map<number, WorldGame>;
  /** Estado HTTP de Query (200 si no se dice): un 403 es Query pidiendo clave (§4.8). */
  readonly queryStatus?: number;
}

export function readGoldenSet(): GoldenQuery[] {
  return parseGolden(readFileSync(`${ROOT}packages/core/test/golden.es.tsv`, 'utf8'));
}

/** Reseñas con el `pop` dado (`pop = ⌊2·log2(r + 1)⌋`). */
function reviewsFor(pop: number): number {
  return pop === 0 ? 0 : Math.ceil(2 ** (pop / 2)) - 1;
}

/**
 * Los `top` juegos más populares de la copia congelada, más los del dorado, los centinelas y
 * «Counter-Strike» (10), sin los retirados.
 */
export function frozenWorld(top = 3000): World {
  const gz = readFileSync(`${ROOT}fixtures/catalog-frozen/core.20261028.1.tsv.gz`);
  const core = parseCore(gunzipSync(gz).toString('utf8'));
  const want = new Set<number>([...SENTINELS, 10, ...readGoldenSet().flatMap((g) => g.appids)]);
  const games = new Map<number, WorldGame>();
  for (let g = 0; g < core.count; g++) {
    const appid = core.appid[g] as number;
    const flags = core.flags[g] as number;
    if (flags & CatalogFlag.retired) continue;
    if (games.size >= top && !want.has(appid)) continue;
    const nameEs = core.nameEs.get(g);
    games.set(appid, {
      appid,
      name: core.name[g] as string,
      ...(nameEs ? { nameEs } : {}),
      reviews: reviewsFor(core.pop[g] as number),
      flags,
      year: core.year[g] as number,
    });
  }
  return { games };
}

/** Un juego tal como lo devuelven Query y `GetItems` con el `data_request` del pipeline. */
function storeItem(g: WorldGame): Record<string, unknown> {
  const soon = (g.flags & CatalogFlag.soon) !== 0;
  const tba = (g.flags & CatalogFlag.tba) !== 0;
  const ts = g.year ? Date.UTC(g.year, 5, 1) / 1000 : undefined;
  return {
    appid: g.appid,
    id: g.appid,
    type: 0,
    success: 1,
    visible: true,
    name: g.nameEs ?? g.name,
    // Steam omite los falsos.
    ...(g.flags & CatalogFlag.free ? { is_free: true } : {}),
    ...(g.flags & CatalogFlag.earlyAccess ? { is_early_access: true } : {}),
    ...(soon ? { is_coming_soon: true } : {}),
    ...(g.flags & CatalogFlag.adult ? { content_descriptorids: [3] } : {}),
    release: soon
      ? tba
        ? { is_coming_soon: true, coming_soon_display: 'text_comingsoon' }
        : { is_coming_soon: true, coming_soon_display: 'date_year', steam_release_date: ts }
      : { steam_release_date: ts },
    reviews: {
      summary_filtered: { review_count: g.reviews, review_score: 8, percent_positive: 90 },
    },
    assets: {
      asset_url_format: `steam/apps/${g.appid}/\${FILENAME}?t=1761955200`,
      library_capsule: 'library_600x900.jpg',
      header: 'header.jpg',
    },
    platforms: { windows: true, steam_deck_compat_category: g.appid % 4 },
  };
}

function ok(json: unknown): TransportResponse {
  return { status: 200, header: () => null, body: JSON.stringify(json), wireBytes: 0 };
}

/** Transporte que contesta como Steam con el mundo de `world()` (se lee en cada petición). */
export function worldTransport(world: () => World): Transport {
  return async (req) => {
    const w = world();
    const url = new URL(req.url);
    const sorted = [...w.games.values()].sort((a, b) => a.appid - b.appid);
    switch (endpointOf(req.url)) {
      case 'getapplist': {
        const last = Number(url.searchParams.get('last_appid') ?? 0);
        const max = Number(url.searchParams.get('max_results'));
        const rest = sorted.filter((g) => g.appid > last);
        const page = rest.slice(0, max);
        const more = rest.length > max;
        return ok({
          response: {
            apps: page.map((g) => ({ appid: g.appid, name: g.name, last_modified: 1761955200 })),
            ...(more ? { have_more_results: true, last_appid: page[page.length - 1]?.appid } : {}),
          },
        });
      }
      case 'query': {
        if (w.queryStatus && w.queryStatus !== 200) {
          return { status: w.queryStatus, header: () => null, body: '', wireBytes: 0 };
        }
        const input = JSON.parse(url.searchParams.get('input_json') ?? '{}');
        const { start, count } = input.query as { start: number; count: number };
        return ok({
          response: {
            metadata: { total_matching_records: sorted.length, start, count },
            store_items: sorted.slice(start, start + count).map(storeItem),
          },
        });
      }
      case 'getitems': {
        const input = JSON.parse(url.searchParams.get('input_json') ?? '{}');
        const ids = (input.ids as Array<{ appid: number }>).map((i) => i.appid);
        // Lo que no está en el mundo ya no existe: `success 15` con `appid 0` y sin nombre.
        const items = ids.map((a) => {
          const g = w.games.get(a);
          return g ? storeItem(g) : { id: a, appid: 0, success: 15 };
        });
        return ok({ response: { store_items: items } });
      }
      default:
        return { status: 404, header: () => null, body: '', wireBytes: 0 };
    }
  };
}

/**
 * Perfil del mundo: el de Steam con las páginas reales (Query de 1 000 con 50 de solape), la
 * lista en páginas de 1 000 y el mínimo de juegos a escala (≈95 % del mundo).
 */
export function worldProfile(world: World, gates: Partial<Profile['gates']> = {}): Profile {
  return {
    name: 'world',
    pageSize: 1000,
    overlap: 50,
    listPageSize: 1000,
    minListApps: 1,
    minQueryCoverage: 0.95,
    maxGapIds: 4000,
    deltaGates: true,
    gates: { ...PUBLISH_GATES, minGames: Math.floor(world.games.size * 0.95), ...gates },
  };
}

/** Un mundo nuevo con los cambios de `edit` (no toca el original). */
export function evolve(world: World, edit: (games: Map<number, WorldGame>) => void): World {
  const games = new Map(world.games);
  edit(games);
  return { ...world, games };
}
