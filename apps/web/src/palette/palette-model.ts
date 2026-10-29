// Filas de la paleta y fila activa por defecto (ver §9.2 y §8.7), sin React ni DOM.

import { type AgendaEntry, steamId } from '../agenda/types.ts';
import { matchesAllPrefixes, tokensOf } from '../lib/text.ts';
import type { CoreGame, QueryState, StatusMessage } from '../search-client/index.ts';
import { canSearchCatalog, PALETTE_LIMIT } from '../search-client/index.ts';

export type PaletteOption =
  | {
      readonly kind: 'game' | 'suggestion';
      readonly key: string;
      readonly game: CoreGame;
      readonly entry: AgendaEntry | undefined;
    }
  /** Estado `none`: resultado de Mi lista. */
  | { readonly kind: 'entry'; readonly key: string; readonly entry: AgendaEntry }
  | { readonly kind: 'catalog'; readonly key: 'catalog' }
  | { readonly kind: 'manual'; readonly key: 'manual'; readonly title: string };

export interface PaletteModel {
  readonly options: readonly PaletteOption[];
  /** Fila que actúa con Intro si no se ha elegido otra; −1 si ninguna. */
  readonly defaultIndex: number;
  /** Solo hay sugerencias del nivel 4: Intro no apunta (ver §8.7). */
  readonly onlySuggestions: boolean;
  /** Ya han llegado resultados del texto escrito, aunque sean de un `seq` anterior. */
  readonly hasResults: boolean;
  /** El catálogo no tiene nada para este texto: «No hemos encontrado…» (ver §9.6). */
  readonly noItems: boolean;
}

const EMPTY: PaletteModel = {
  options: [],
  defaultIndex: -1,
  onlySuggestions: false,
  hasResults: false,
  noItems: false,
};

export function displayName(game: CoreGame): string {
  return game.nameEs ?? game.name;
}

/** En `none` la paleta busca en Mi lista (ver §8.8). */
export function searchEntries(entries: readonly AgendaEntry[], text: string): AgendaEntry[] {
  const query = tokensOf(text);
  if (query.length === 0) return [];
  return entries
    .filter((entry) => matchesAllPrefixes(tokensOf(entry.title), query))
    .slice(0, PALETTE_LIMIT);
}

export function buildPaletteModel(
  query: QueryState,
  status: StatusMessage,
  entriesById: ReadonlyMap<string, AgendaEntry>,
): PaletteModel {
  const text = query.text.trim();
  if (text === '') return EMPTY;
  const manual: PaletteOption = { kind: 'manual', key: 'manual', title: text };

  if (!canSearchCatalog(status.state)) {
    const matches = searchEntries([...entriesById.values()], text).map(
      (entry): PaletteOption => ({ kind: 'entry', key: `e:${entry.id}`, entry }),
    );
    // Sin catálogo no se resalta la fila manual: el juego seguramente está en Steam.
    return {
      options: [...matches, manual],
      defaultIndex: matches.length > 0 ? 0 : -1,
      onlySuggestions: false,
      hasResults: true,
      noItems: false,
    };
  }

  const items = query.results?.items ?? [];
  const suggestions = query.suggestions?.items ?? [];
  const toOption =
    (kind: 'game' | 'suggestion') =>
    (game: CoreGame): PaletteOption => ({
      kind,
      key: `${kind === 'game' ? 'g' : 's'}:${game.appid}`,
      game,
      entry: entriesById.get(steamId(game.appid)),
    });
  const options: PaletteOption[] = [
    ...items.map(toOption('game')),
    ...suggestions.map(toOption('suggestion')),
  ];
  if (items.length >= PALETTE_LIMIT) options.push({ kind: 'catalog', key: 'catalog' });
  options.push(manual);

  const hasResults = query.results !== null;
  const onlySuggestions = items.length === 0 && suggestions.length > 0;
  let defaultIndex = -1;
  if (items.length > 0) defaultIndex = 0;
  else if (hasResults && !onlySuggestions) defaultIndex = options.length - 1;
  const noItems = query.fresh && items.length === 0;
  return { options, defaultIndex, onlySuggestions, hasResults, noItems };
}
