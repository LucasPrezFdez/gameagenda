// Etapa 2 · Enriquecer (§4.5): pasada completa de Query en `spanish`/`ES`, ordenada por `appid`
// (`sort: 2`), en páginas de 1 000 con 50 de solape, hasta `total_matching_records`; Zod en cada
// página y deduplicación por `appid` (gana la primera aparición).

import type { SteamClient } from '../steam/client.ts';
import { ES, queryUrl, type StoreContext } from '../steam/endpoints.ts';
import { type QueryItem, queryResponseSchema } from '../steam/schemas.ts';

export interface QueryPassOptions {
  /** Juegos por página (1 000). */
  readonly pageSize: number;
  /** Solape entre páginas (50): cubre altas y bajas en plena pasada. */
  readonly overlap: number;
  /** Corta tras estas páginas (solo el perfil de *fixtures*). */
  readonly maxPages?: number;
  readonly ctx?: StoreContext;
  readonly log?: (line: string) => void;
}

export interface QueryPass {
  /** Juegos únicos por `appid`, en el orden en que llegaron. */
  readonly items: ReadonlyMap<number, QueryItem>;
  readonly pages: number;
  /** `total_matching_records` de la primera y de la última página. */
  readonly firstTotal: number;
  readonly lastTotal: number;
  /** Filas leídas (con las repetidas del solape). */
  readonly rows: number;
  /** `true` si se cortó por `maxPages` antes del total. */
  readonly truncated: boolean;
}

/** Nombre de la página cruda: `query-000950`. */
export function queryPageName(start: number): string {
  return `query-${String(start).padStart(6, '0')}`;
}

export async function queryPass(client: SteamClient, opts: QueryPassOptions): Promise<QueryPass> {
  const { pageSize, overlap } = opts;
  if (overlap < 1 || overlap >= pageSize)
    throw new RangeError('El solape debe estar en [1, página)');
  const items = new Map<number, QueryItem>();
  let start = 0;
  let pages = 0;
  let rows = 0;
  let firstTotal = -1;
  let lastTotal = 0;
  let truncated = false;
  for (;;) {
    const r = await client.get(
      queryUrl(start, pageSize, opts.ctx ?? ES),
      queryResponseSchema,
      queryPageName(start),
    );
    pages++;
    const page = r.response.store_items;
    lastTotal = r.response.metadata.total_matching_records;
    if (firstTotal < 0) firstTotal = lastTotal;
    // El solape debe empalmar con lo ya leído; si no, se habrían saltado juegos (≥50 bajas
    // entre dos páginas) y la etapa falla.
    if (start > 0 && page.length > 0 && !page.slice(0, overlap).some((it) => items.has(it.appid))) {
      throw new Error(
        `Query: la página ${start} no empalma con la anterior (solape de ${overlap})`,
      );
    }
    rows += page.length;
    for (const it of page) if (!items.has(it.appid)) items.set(it.appid, it);
    if (pages % 20 === 1) {
      opts.log?.(`Query: página ${pages} (start ${start}), ${items.size} de ${lastTotal}`);
    }
    if (page.length === 0) break;
    start += pageSize - overlap;
    if (start >= lastTotal) break;
    if (opts.maxPages !== undefined && pages >= opts.maxPages) {
      truncated = true;
      break;
    }
  }
  return { items, pages, firstTotal, lastTotal, rows, truncated };
}
