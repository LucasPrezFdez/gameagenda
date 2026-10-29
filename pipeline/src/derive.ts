// Etapa 4 · Construir (§4.5, §4.9 y §7.6): L ∪ Q (más los huecos), solo `type 0`, fuera los
// vacíos, los inexistentes y la lista negra exacta, SKU regionales duplicados, y `nameEs`,
// `flags`, `year` y `pop` de cada juego, en el orden del rango estático.

import { CatalogFlag } from '@gameagenda/core/catalog-format';
import { normalize } from '@gameagenda/core/normalize';
import type { StoreItem } from '../steam/schemas.ts';
import type { Classified, GameClass } from './get-items.ts';

/** Lista negra **exacta** (§4.9): `appid` y nombre a la vez, nunca por prefijo. */
export const BLACKLIST: ReadonlyArray<readonly [appid: number, name: string]> = [
  [866490, 'TestApp'],
  [639770, 'UNTITLED'],
  [1025620, 'Untitled'],
];

const blacklisted = new Set(BLACKLIST.map(([appid, name]) => `${appid}\t${name}`));

export function isBlacklisted(appid: number, name: string): boolean {
  return blacklisted.has(`${appid}\t${name}`);
}

/** Descriptores de contenido adulto (§4.9): 3 o 4. */
const ADULT_DESCRIPTORS: ReadonlySet<number> = new Set([3, 4]);
/** `coming_soon_display` sin fecha que mostrar (bit 32, §7.6). */
const NO_DATE_DISPLAYS: ReadonlySet<string> = new Set(['text_tba', 'text_comingsoon']);

/** En los nombres, tabuladores, CR y LF pasan a espacio; sin espacios en los extremos. */
export function cleanName(s: string | undefined | null): string {
  return String(s ?? '')
    .replace(/[\t\r\n]+/g, ' ')
    .trim();
}

/** `min(63, floor(2·log2(reseñas + 1)))` (§7.6). */
export function popOf(reviews: number): number {
  return Math.min(63, Math.floor(2 * Math.log2(reviews + 1)));
}

/** Lo que el núcleo saca de un juego de la tienda (sin el bit de retirado). */
export interface Enrichment {
  readonly type: number | null;
  readonly flags: number;
  readonly year: number;
  readonly reviews: number;
}

/** `flags`, `year` y reseñas de un juego de Query o de `GetItems` (§7.6 y §4.9). */
export function enrichmentOf(it: StoreItem): Enrichment {
  const r = it.release ?? {};
  const soon = Boolean(it.is_coming_soon || r.is_coming_soon);
  const early = Boolean(it.is_early_access || r.is_early_access);
  const adult = (it.content_descriptorids ?? []).some((d) => ADULT_DESCRIPTORS.has(d));
  const free = Boolean(it.is_free);
  const ts = r.steam_release_date || r.original_release_date || 0;
  // Fecha por confirmar: Steam no muestra fecha (`text_comingsoon`, `text_tba` o ninguna).
  const display = r.coming_soon_display;
  const tba = soon && (display === undefined || NO_DATE_DISPLAYS.has(display) || !ts);
  let flags = 0;
  if (soon) flags |= CatalogFlag.soon;
  if (early) flags |= CatalogFlag.earlyAccess;
  if (adult) flags |= CatalogFlag.adult;
  if (free) flags |= CatalogFlag.free;
  if (tba) flags |= CatalogFlag.tba;
  const year = ts && !tba ? new Date(ts * 1000).getUTCFullYear() : 0;
  return {
    type: it.type ?? null,
    flags,
    year,
    reviews: it.reviews?.summary_filtered?.review_count ?? 0,
  };
}

// Letras y palabras que delatan un nombre traducido al español. Medido el 29-10-2026 sobre la
// pasada completa frente a la copia congelada: ver `needsBaseName`.
const RE_SPANISH_LETTERS = /[áéíóúñü¿¡]/i;
const RE_SPANISH_WORDS = new RegExp(
  `(?:^|[\\s:\\-–—(«"'])(?:${[
    'de',
    'del',
    'la',
    'las',
    'el',
    'los',
    'y',
    'en',
    'un',
    'una',
    'con',
    'sin',
    'para',
    'por',
    'al',
    'su',
    'sus',
    'mi',
    'tu',
    'lo',
    'es',
    'contra',
    'entre',
    'hacia',
    'sobre',
    'edicion',
    'juego',
    'juegos',
    'aventura',
    'aventuras',
    'misterio',
    'misterios',
    'guerra',
    'leyenda',
    'leyendas',
    'historia',
    'historias',
    'reino',
    'mundo',
    'tierra',
    'ciudad',
    'casa',
    'noche',
    'sombra',
    'sombras',
    'caballero',
    'caballeros',
    'definitiva',
    'completa',
    'coleccionista',
    'simulador',
    'nuevo',
    'nueva',
    'mundos',
    'secreto',
    'secretos',
    'isla',
    'viaje',
    'objetos',
    'ocultos',
    'oculto',
    'oculta',
    'chica',
    'chicas',
    'amor',
    'cero',
    'luz',
    'bosque',
    'bruja',
    'brujas',
    'guerrero',
    'guerreros',
    'oscuro',
    'oscura',
    'perdido',
    'perdida',
    'perdidos',
    'princesa',
    'reina',
    'esponja',
    'mascotas',
    'salvaje',
    'muerte',
    'muertes',
    'vida',
    'fuego',
    'hielo',
    'cielo',
    'sangre',
    'alma',
    'almas',
    'espada',
    'espadas',
  ].join('|')})(?=$|[\\s:,.!?)»"'–—-])`,
  'i',
);

/** `true` si el nombre parece traducido al español (letras o palabras del español). */
export function looksSpanish(name: string): boolean {
  return RE_SPANISH_LETTERS.test(name) || RE_SPANISH_WORDS.test(name);
}

/**
 * Plan B sin clave: Query en `spanish` da el nombre en español, no el base, y en ese idioma
 * Steam traduce también `store_url_slug` y `store_url_path` (comprobado el 29-10-2026), así que
 * no hay de dónde sacar el base. Se pide a `GetItems` en `english` cuando el nombre parece
 * español (≈3 000 juegos, ≈16 peticiones) o viene vacío; el resto se queda con el de Query.
 */
export function needsBaseName(it: StoreItem): boolean {
  const name = cleanName(it.name);
  return !name || looksSpanish(name);
}

/** Fila del estado (§4.6): una por `appid` conocido, con su último enriquecimiento fechado. */
export interface StateRow {
  readonly appid: number;
  readonly name: string;
  readonly nameEs?: string;
  readonly cls: Exclude<GameClass, 'deleted' | 'unknown'>;
  readonly flags: number;
  readonly year: number;
  readonly reviews: number;
  /** Día (`AAAA-MM-DD`, Europe/Madrid) del último enriquecimiento. */
  readonly enrichedOn: string;
  readonly lastModified?: number;
  readonly priceChangeNumber?: number;
}

/** Un juego del núcleo, antes de serializarlo. */
export interface Game {
  readonly appid: number;
  readonly name: string;
  readonly nameEs: string;
  /** Con el bit de retirado. */
  readonly flags: number;
  readonly year: number;
  readonly reviews: number;
  readonly pop: number;
  readonly cls: StateRow['cls'];
  readonly enrichedOn: string;
  readonly lastModified?: number;
  readonly priceChangeNumber?: number;
}

export type ExclusionReason =
  | 'not-game'
  | 'empty-name'
  | 'blacklist'
  | 'deleted'
  | 'duplicate-sku'
  | 'no-data';

export interface Exclusion {
  readonly appid: number;
  readonly name: string;
  readonly reason: ExclusionReason;
  readonly detail: string;
}

/** Entrada de L (`GetAppList`): nombre base y marcas de cambio. */
export interface ListEntry {
  readonly name: string;
  readonly last_modified?: number | undefined;
  readonly price_change_number?: number | undefined;
}

export interface AssembleInput {
  /** L: qué juegos existen (con clave); `null` en el plan B, donde L := ids de Q. */
  readonly list: ReadonlyMap<number, ListEntry> | null;
  /** Q: Query en ES. */
  readonly query: ReadonlyMap<number, StoreItem>;
  /** H1 y H2 clasificados con `GetItems`. */
  readonly gaps: ReadonlyMap<number, Classified>;
  /** Nombres base pedidos a `GetItems` en `english` (plan B y nombres vacíos). */
  readonly baseNames: ReadonlyMap<number, string>;
  readonly state: ReadonlyMap<number, StateRow>;
  /** Día de esta ejecución (`AAAA-MM-DD`). */
  readonly today: string;
}

export interface Assembled {
  /** En el orden del rango estático (§7.6). */
  readonly games: Game[];
  readonly excluded: Exclusion[];
}

/**
 * Rango estático (§7.6 y DECISIONES §10.5): no retirados por reseñas descendentes (a igualdad,
 * `appid` descendente: lo más reciente primero) y, al final, los retirados, con el mismo criterio.
 */
export function compareRank(a: Game, b: Game): number {
  const ra = a.flags & CatalogFlag.retired;
  const rb = b.flags & CatalogFlag.retired;
  return ra - rb || b.reviews - a.reviews || b.appid - a.appid;
}

export function assemble(input: AssembleInput): Assembled {
  const { list, query, gaps, baseNames, state, today } = input;
  const universe = new Set<number>([...(list ?? query).keys(), ...gaps.keys()]);
  const games: Game[] = [];
  const excluded: Exclusion[] = [];
  for (const appid of [...universe].sort((a, b) => a - b)) {
    const q = query.get(appid);
    const g = gaps.get(appid);
    const s = state.get(appid);
    const l = list?.get(appid);
    const item = q ?? g?.item ?? null;
    const nameEsRaw = cleanName(item?.name);
    if (!q && g?.cls === 'deleted') {
      excluded.push({
        appid,
        name: s?.name ?? cleanName(l?.name),
        reason: 'deleted',
        detail: g.reason,
      });
      continue;
    }
    // Clase: lo que dice Query o GetItems; si GetItems no aclara nada, la del estado.
    const cls: StateRow['cls'] = q
      ? 'visible'
      : g && g.cls !== 'unknown' && g.cls !== 'deleted'
        ? g.cls
        : (s?.cls ?? 'visible');
    const fresh = item ? enrichmentOf(item) : null;
    // GetAppList (include_games) solo lista juegos; el estado solo guarda juegos.
    const type = fresh?.type ?? (l || s ? 0 : null);
    const base = cleanName(l?.name) || baseNames.get(appid) || nameEsRaw || s?.name || '';
    if (type !== 0) {
      excluded.push({ appid, name: base, reason: 'not-game', detail: `type ${type ?? '?'}` });
      continue;
    }
    if (!base) {
      excluded.push({
        appid,
        name: '',
        reason: 'empty-name',
        detail: 'sin nombre en ES ni en inglés',
      });
      continue;
    }
    if (isBlacklisted(appid, base)) {
      excluded.push({ appid, name: base, reason: 'blacklist', detail: 'lista negra exacta' });
      continue;
    }
    if (!fresh && !s && !l) {
      excluded.push({ appid, name: base, reason: 'no-data', detail: g?.reason ?? 'sin datos' });
      continue;
    }
    const e = fresh ?? {
      flags: s?.flags ?? 0,
      year: s?.year ?? 0,
      reviews: s?.reviews ?? 0,
    };
    const nameEs = fresh ? (nameEsRaw !== base ? nameEsRaw : '') : (s?.nameEs ?? '');
    const flags = e.flags | (cls === 'retired' ? CatalogFlag.retired : 0);
    const lastModified = l?.last_modified ?? s?.lastModified;
    const priceChangeNumber = l?.price_change_number ?? s?.priceChangeNumber;
    games.push({
      appid,
      name: base,
      nameEs,
      flags,
      year: e.year,
      reviews: e.reviews,
      pop: popOf(e.reviews),
      cls,
      enrichedOn: fresh ? today : (s?.enrichedOn ?? today),
      ...(lastModified !== undefined ? { lastModified } : {}),
      ...(priceChangeNumber !== undefined ? { priceChangeNumber } : {}),
    });
  }
  // SKU regionales duplicados (§4.9): si uno no visible en ES se llama igual que otro visible,
  // se queda el visible.
  const visibleByName = new Map<string, number>();
  for (const g of games) {
    if (g.cls !== 'visible') continue;
    const k = normalize(g.name);
    if (!visibleByName.has(k)) visibleByName.set(k, g.appid);
  }
  const kept = games.filter((g) => {
    if (g.cls !== 'blocked') return true;
    const twin = visibleByName.get(normalize(g.name));
    if (twin === undefined) return true;
    excluded.push({
      appid: g.appid,
      name: g.name,
      reason: 'duplicate-sku',
      detail: `SKU regional de ${twin}, visible en ES`,
    });
    return false;
  });
  kept.sort(compareRank);
  excluded.sort((a, b) => a.appid - b.appid);
  return { games: kept, excluded };
}

/** Filas del estado nuevo, por `appid`. */
export function stateRows(games: readonly Game[]): StateRow[] {
  return [...games]
    .sort((a, b) => a.appid - b.appid)
    .map((g) => ({
      appid: g.appid,
      name: g.name,
      ...(g.nameEs ? { nameEs: g.nameEs } : {}),
      cls: g.cls,
      flags: g.flags & ~CatalogFlag.retired,
      year: g.year,
      reviews: g.reviews,
      enrichedOn: g.enrichedOn,
      ...(g.lastModified !== undefined ? { lastModified: g.lastModified } : {}),
      ...(g.priceChangeNumber !== undefined ? { priceChangeNumber: g.priceChangeNumber } : {}),
    }));
}
