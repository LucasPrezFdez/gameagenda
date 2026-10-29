// Filas de la paleta y fila activa por defecto (ver §9.2 y §8.7), sin React ni DOM.

import { findSteamLink, parseSteamLink, type SteamLink } from '@gameagenda/core/steam-link';
import { type AgendaEntry, steamId } from '../agenda/types.ts';
import { es } from '../i18n/es.ts';
import { matchesAllPrefixes, tokensOf } from '../lib/text.ts';
import type { CoreGame, QueryState, StatusMessage } from '../search-client/index.ts';
import { canSearchCatalog, PALETTE_LIMIT } from '../search-client/index.ts';

/** Enlace pegado (RF-04) y lo que el catálogo sabe de su `appid`. */
export interface PastedLink {
  readonly link: SteamLink;
  /** ¿Es todo el texto? Entonces no hay fila manual: apuntar la URL a mano no tiene sentido. */
  readonly whole: boolean;
  /** `undefined`: aún buscándolo; `null`: no está en el catálogo local (provisional). */
  readonly game: CoreGame | null | undefined;
}

export type PaletteOption =
  | {
      readonly kind: 'game' | 'suggestion';
      readonly key: string;
      readonly game: CoreGame;
      readonly entry: AgendaEntry | undefined;
    }
  /** Estado `none`: resultado de Mi lista. */
  | { readonly kind: 'entry'; readonly key: string; readonly entry: AgendaEntry }
  /** Enlace de Steam pegado: apunta `steam:<appid>`, provisional si no está en el catálogo. */
  | {
      readonly kind: 'link';
      readonly key: 'link';
      readonly appid: number;
      readonly title: string;
      readonly provisional: boolean;
      /** Aún se busca en el catálogo: el título puede cambiar. */
      readonly resolving: boolean;
      readonly year: number | null;
      readonly entry: AgendaEntry | undefined;
    }
  | { readonly kind: 'catalog'; readonly key: 'catalog' }
  | { readonly kind: 'manual'; readonly key: 'manual'; readonly title: string };

/** Enlace de Steam en el texto de la paleta, si lo hay. */
export function linkInText(text: string): Pick<PastedLink, 'link' | 'whole'> | null {
  const whole = parseSteamLink(text);
  if (whole) return { link: whole, whole: true };
  const found = findSteamLink(text);
  return found ? { link: found, whole: false } : null;
}

/** Título del juego provisional: el del *slug* o «Juego de Steam <appid>» (ver §9.2). */
export function provisionalTitle(link: SteamLink): string {
  return link.title ?? es.palette.steamGame(link.appid);
}

function linkOption(
  pasted: PastedLink,
  status: StatusMessage,
  entriesById: ReadonlyMap<string, AgendaEntry>,
): PaletteOption {
  const { appid } = pasted.link;
  const entry = entriesById.get(steamId(appid));
  // Sin catálogo cargado, el juego queda provisional (lo resolverá el catálogo al llegar).
  const game = canSearchCatalog(status.state) ? pasted.game : null;
  return {
    kind: 'link',
    key: 'link',
    appid,
    title: entry?.title ?? (game ? displayName(game) : provisionalTitle(pasted.link)),
    provisional: !entry && !game,
    resolving: !entry && game === undefined,
    year: game?.year ?? null,
    entry,
  };
}

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
  pasted: PastedLink | null = null,
): PaletteModel {
  const text = query.text.trim();
  if (text === '') return EMPTY;
  if (pasted) {
    // El enlace va primero y es lo que apunta Intro (`Ctrl+K` `Ctrl+V` `Intro`, ver §9.2).
    const link = linkOption(pasted, status, entriesById);
    if (pasted.whole) {
      return {
        options: [link],
        defaultIndex: 0,
        onlySuggestions: false,
        hasResults: true,
        noItems: false,
      };
    }
    const rest = buildPaletteModel(query, status, entriesById);
    const options = [link, ...rest.options.filter((o) => o.key !== `g:${pasted.link.appid}`)];
    return { ...rest, options, defaultIndex: 0, onlySuggestions: false, noItems: false };
  }
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
