// Vistas, filtros, orden y secciones de Mi lista (ver §9.1). La vista, los filtros y el orden
// van en la URL con nombres en español: `/?vista=jugando&compra=por-comprar&orden=nombre&q=…`.

import {
  type AgendaEntry,
  compareRank,
  type EntryView,
  STATUSES,
  type Status,
  viewOf,
} from '../../agenda/types.ts';
import { matchesAllPrefixes, tokensOf } from '../../lib/text.ts';

export type ListView = 'pending' | Status | 'all';
export type PurchaseFilter = 'any' | 'owned' | 'not_owned';
/** `release` (lanzamiento) llega en M2. */
export type ListOrder = 'priority' | 'added' | 'name';

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

export const LIST_VIEWS: readonly ListView[] = ['pending', ...STATUSES, 'all'];
export const PURCHASE_FILTERS: readonly PurchaseFilter[] = ['any', 'owned', 'not_owned'];
export const LIST_ORDERS: readonly ListOrder[] = ['priority', 'added', 'name'];

const VIEW_SLUGS: Readonly<Record<ListView, string>> = {
  pending: 'pendientes',
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
  /** `null`: lista sin secciones (orden distinto de prioridad). */
  readonly id: SectionId | null;
  readonly entries: readonly AgendaEntry[];
  /** «En pausa» va plegada en Pendientes. */
  readonly collapsible: boolean;
  /** Muestra el número de prioridad (Quiero jugar, ordenada a mano). */
  readonly ranked: boolean;
}

function inView(entry: AgendaEntry, view: ListView): boolean {
  if (view === 'all') return true;
  if (view === 'pending') return PENDING_SECTIONS.includes(viewOf(entry));
  return entry.status === view;
}

function inPurchase(entry: AgendaEntry, purchase: PurchaseFilter): boolean {
  if (purchase === 'any') return true;
  return (entry.flags.owned === true) === (purchase === 'owned');
}

const collator = new Intl.Collator('es-ES', { sensitivity: 'base', numeric: true });

function compare(order: ListOrder) {
  return (a: AgendaEntry, b: AgendaEntry): number => {
    if (order === 'name') return collator.compare(a.title, b.title);
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

export function buildSections(entries: readonly AgendaEntry[], params: ListParams): ListSection[] {
  const visible = filterEntries(entries, params).sort(compare(params.order));
  if (params.order !== 'priority') {
    return [{ id: null, entries: visible, collapsible: false, ranked: false }];
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
      id,
      entries: visible.filter((entry) => viewOf(entry) === id),
      collapsible: params.view === 'pending' && id === 'on_hold',
      ranked: id === 'want_to_play',
    }))
    .filter((section) => section.entries.length > 0);
}

function pinnable(view: ListView): boolean {
  return view === 'want_to_play' || view === 'on_hold';
}

/** Contadores de los chips de vista, con el filtro de compra aplicado. */
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
    for (const view of LIST_VIEWS) if (inView(entry, view)) counts[view] += 1;
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
