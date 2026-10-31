// Vistas, filtros, orden y secciones de Mi lista (ver §9.1). La vista, los filtros y el orden
// van en la URL con nombres en español: `/?vista=jugando&compra=por-comprar&orden=nombre&q=…`.
// Próximos (`/?vista=proximos`) y el orden por lanzamiento (M2) agrupan y ordenan con las fechas
// de los *shards* de detalles (ver §9.2).

import {
  type AgendaEntry,
  compareRank,
  type EntryView,
  STATUSES,
  type Status,
  viewOf,
} from '../../agenda/types.ts';
import {
  compareReleaseKeys,
  type DayNumber,
  groupKey,
  groupOrder,
  type ReleaseInfo,
  releaseSortKey,
  type UpcomingGroup,
  upcomingGroup,
} from '../../details/release.ts';
import { matchesAllPrefixes, tokensOf } from '../../lib/text.ts';

export type ListView = 'pending' | 'upcoming' | Status | 'all';
export type PurchaseFilter = 'any' | 'owned' | 'not_owned';
export type ListOrder = 'priority' | 'added' | 'name' | 'release';

export interface ListParams {
  readonly view: ListView;
  readonly purchase: PurchaseFilter;
  readonly order: ListOrder;
  readonly q: string;
}

export const DEFAULT_LIST_PARAMS: ListParams = {
  view: 'pending',
  purchase: 'any',
  order: 'priority',
  q: '',
};

export const LIST_VIEWS: readonly ListView[] = ['pending', 'upcoming', ...STATUSES, 'all'];
export const PURCHASE_FILTERS: readonly PurchaseFilter[] = ['any', 'owned', 'not_owned'];
export const LIST_ORDERS: readonly ListOrder[] = ['priority', 'added', 'name', 'release'];

const VIEW_SLUGS: Readonly<Record<ListView, string>> = {
  pending: 'pendientes',
  upcoming: 'proximos',
  want_to_play: 'quiero-jugar',
  playing: 'jugando',
  on_hold: 'en-pausa',
  completed: 'completado',
  dropped: 'abandonado',
  all: 'todos',
};
const PURCHASE_SLUGS: Readonly<Record<PurchaseFilter, string>> = {
  any: 'todos',
  owned: 'comprados',
  not_owned: 'por-comprar',
};
const ORDER_SLUGS: Readonly<Record<ListOrder, string>> = {
  priority: 'prioridad',
  added: 'apuntado',
  name: 'nombre',
  release: 'lanzamiento',
};

function fromSlug<T extends string>(slugs: Readonly<Record<T, string>>, slug: string | null) {
  if (slug === null) return undefined;
  return (Object.keys(slugs) as T[]).find((key) => slugs[key] === slug);
}

export function parseListParams(search: string): ListParams {
  const params = new URLSearchParams(search);
  return {
    view: fromSlug(VIEW_SLUGS, params.get('vista')) ?? DEFAULT_LIST_PARAMS.view,
    purchase: fromSlug(PURCHASE_SLUGS, params.get('compra')) ?? DEFAULT_LIST_PARAMS.purchase,
    order: fromSlug(ORDER_SLUGS, params.get('orden')) ?? DEFAULT_LIST_PARAMS.order,
    q: params.get('q') ?? '',
  };
}

/** Parámetros de la URL, sin los valores por defecto. */
export function listSearchParams(list: ListParams): URLSearchParams {
  const params = new URLSearchParams();
  if (list.view !== DEFAULT_LIST_PARAMS.view) params.set('vista', VIEW_SLUGS[list.view]);
  if (list.purchase !== DEFAULT_LIST_PARAMS.purchase) {
    params.set('compra', PURCHASE_SLUGS[list.purchase]);
  }
  if (list.order !== DEFAULT_LIST_PARAMS.order) params.set('orden', ORDER_SLUGS[list.order]);
  if (list.q !== '') params.set('q', list.q);
  return params;
}

/** Secciones de «Pendientes» y de «Todos», en este orden (ver §9.1). */
export type SectionId = EntryView;
const PENDING_SECTIONS: readonly SectionId[] = ['playing', 'next', 'want_to_play', 'on_hold'];
const ALL_SECTIONS: readonly SectionId[] = [...PENDING_SECTIONS, 'completed', 'dropped'];

export interface ListSection {
  /** Clave estable de la sección (React y el `id` de su título). */
  readonly key: string;
  /** `null`: lista sin secciones (orden distinto de prioridad) o un grupo de Próximos. */
  readonly id: SectionId | null;
  /** Grupo de Próximos por lanzamiento. */
  readonly group?: UpcomingGroup;
  readonly entries: readonly AgendaEntry[];
  /** «En pausa» va plegada en Pendientes. */
  readonly collapsible: boolean;
  /** Muestra el número de prioridad (Quiero jugar, ordenada a mano). */
  readonly ranked: boolean;
}

function inView(entry: AgendaEntry, view: ListView): boolean {
  // Próximos depende de las fechas: lo decide `upcomingSections`.
  if (view === 'all' || view === 'upcoming') return true;
  if (view === 'pending') return PENDING_SECTIONS.includes(viewOf(entry));
  return entry.status === view;
}

function inPurchase(entry: AgendaEntry, purchase: PurchaseFilter): boolean {
  if (purchase === 'any') return true;
  return (entry.flags.owned === true) === (purchase === 'owned');
}

const collator = new Intl.Collator('es-ES', { sensitivity: 'base', numeric: true });

/** Lanzamiento de cada entrada, para Próximos y el orden por lanzamiento. */
export interface ReleaseLookup {
  readonly today: DayNumber;
  /** `null` si no se sabe nada (juego manual o sin datos). */
  get(entry: AgendaEntry): ReleaseInfo | null;
}

function byRelease(releases: ReleaseLookup) {
  return (a: AgendaEntry, b: AgendaEntry): number =>
    compareReleaseKeys(releaseSortKey(releases.get(a)), releaseSortKey(releases.get(b))) ||
    collator.compare(a.title, b.title);
}

function compare(order: ListOrder, releases: ReleaseLookup | undefined) {
  if (order === 'release' && releases) return byRelease(releases);
  return (a: AgendaEntry, b: AgendaEntry): number => {
    if (order === 'name' || order === 'release') return collator.compare(a.title, b.title);
    if (order === 'added') {
      // Fecha de apuntado, lo último primero; a igual fecha, lo apuntado después (mayor rank).
      const day = (b.addedAt ?? '').localeCompare(a.addedAt ?? '');
      return day !== 0 ? day : compareRank(b, a);
    }
    return compareRank(a, b);
  };
}

export function filterEntries(entries: readonly AgendaEntry[], params: ListParams): AgendaEntry[] {
  const query = tokensOf(params.q);
  return entries.filter(
    (entry) =>
      inView(entry, params.view) &&
      inPurchase(entry, params.purchase) &&
      (query.length === 0 || matchesAllPrefixes(tokensOf(entry.title), query)),
  );
}

/** Grupos de Próximos (§9.2), en su orden y, dentro de cada uno, por lanzamiento. */
function upcomingSections(visible: readonly AgendaEntry[], releases: ReleaseLookup): ListSection[] {
  const groups = new Map<string, { group: UpcomingGroup; entries: AgendaEntry[] }>();
  for (const entry of visible) {
    const info = releases.get(entry);
    const group = info && upcomingGroup(info, releases.today);
    if (!group) continue;
    const key = groupKey(group);
    const found = groups.get(key);
    if (found) found.entries.push(entry);
    else groups.set(key, { group, entries: [entry] });
  }
  const sort = byRelease(releases);
  return [...groups.entries()]
    .sort(([, a], [, b]) => groupOrder(a.group) - groupOrder(b.group))
    .map(([key, { group, entries: list }]) => ({
      key,
      id: null,
      group,
      entries: list.sort(sort),
      collapsible: false,
      ranked: false,
    }));
}

/**
 * Secciones de la vista. Próximos y el orden por lanzamiento necesitan `releases`; sin ellas,
 * Próximos no tiene secciones y el orden por lanzamiento usa el nombre.
 */
export function buildSections(
  entries: readonly AgendaEntry[],
  params: ListParams,
  releases?: ReleaseLookup,
): ListSection[] {
  if (params.view === 'upcoming') {
    return releases ? upcomingSections(filterEntries(entries, params), releases) : [];
  }
  const visible = filterEntries(entries, params).sort(compare(params.order, releases));
  if (params.order !== 'priority') {
    return [{ key: 'all', id: null, entries: visible, collapsible: false, ranked: false }];
  }
  const ids =
    params.view === 'pending'
      ? PENDING_SECTIONS
      : params.view === 'all'
        ? ALL_SECTIONS
        : ALL_SECTIONS.filter(
            (id) => id === params.view || (id === 'next' && pinnable(params.view)),
          );
  return ids
    .map((id) => ({
      key: id,
      id,
      entries: visible.filter((entry) => viewOf(entry) === id),
      collapsible: params.view === 'pending' && id === 'on_hold',
      ranked: id === 'want_to_play',
    }))
    .filter((section) => section.entries.length > 0);
}

/** Juegos de Próximos (con el filtro de compra), o `null` si aún no se saben las fechas. */
export function countUpcoming(
  entries: readonly AgendaEntry[],
  purchase: PurchaseFilter,
  releases: ReleaseLookup | null,
): number | null {
  if (!releases) return null;
  let count = 0;
  for (const entry of entries) {
    if (!inPurchase(entry, purchase)) continue;
    const info = releases.get(entry);
    if (info && upcomingGroup(info, releases.today)) count += 1;
  }
  return count;
}

function pinnable(view: ListView): boolean {
  return view === 'want_to_play' || view === 'on_hold';
}

/** Contadores de los chips de vista, con el filtro de compra aplicado (Próximos va aparte). */
export function countViews(
  entries: readonly AgendaEntry[],
  purchase: PurchaseFilter,
): Record<ListView, number> {
  const counts = Object.fromEntries(LIST_VIEWS.map((view) => [view, 0])) as Record<
    ListView,
    number
  >;
  for (const entry of entries) {
    if (!inPurchase(entry, purchase)) continue;
    for (const view of LIST_VIEWS) {
      if (view !== 'upcoming' && inView(entry, view)) counts[view] += 1;
    }
  }
  return counts;
}

/** Posición de prioridad de una entrada dentro de su vista («Prioridad 1 de 25»). */
export function priorityOf(
  entries: readonly AgendaEntry[],
  entry: AgendaEntry,
): { position: number; total: number } {
  const view = viewOf(entry);
  const siblings = entries.filter((e) => viewOf(e) === view).sort(compareRank);
  return { position: siblings.findIndex((e) => e.id === entry.id) + 1, total: siblings.length };
}
