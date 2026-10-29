// Motor de búsqueda simplificado para el cliente falso: imita los niveles y el orden de la
// §8.4 sobre unas decenas de juegos, sin índice. El motor real vive en `packages/core`.
import { normalizeLite } from '../../lib/text.ts';
import { type CoreGame, GAME_FLAGS, type SearchItem, type SearchTier } from '../protocol.ts';
import type { SampleGame } from './sample-catalog.ts';

const ARTICLES = new Set(['the', 'a', 'an', 'el', 'la', 'los', 'las']);
const SUBSTRING_MAX = 3;
const SUGGEST_MAX = 3;

interface IndexedGame {
  readonly game: SampleGame;
  readonly row: number;
  /** Claves normalizadas: nombre base, nombre en español y ambas sin artículo. */
  readonly keys: readonly string[];
  readonly words: readonly string[];
  readonly compact: readonly string[];
}

export interface FakeIndex {
  readonly games: readonly IndexedGame[];
  readonly aliases: ReadonlyMap<string, readonly number[]>;
}

function withoutArticle(key: string): string | null {
  const [first, ...rest] = key.split(' ');
  return first !== undefined && ARTICLES.has(first) && rest.length > 0 ? rest.join(' ') : null;
}

export function buildFakeIndex(
  games: readonly SampleGame[],
  aliases: Readonly<Record<string, readonly number[]>>,
): FakeIndex {
  const indexed = games.map((game, row) => {
    const base = [normalizeLite(game.name)];
    if (game.nameEs !== null) base.push(normalizeLite(game.nameEs));
    const keys = new Set(base);
    for (const key of base) {
      const bare = withoutArticle(key);
      if (bare !== null) keys.add(bare);
    }
    const all = [...keys];
    return {
      game,
      row,
      keys: all,
      words: [...new Set(all.flatMap((key) => key.split(' ')))],
      compact: all.map((key) => key.replaceAll(' ', '')),
    };
  });
  return { games: indexed, aliases: new Map(Object.entries(aliases)) };
}

export function toCoreGame(game: SampleGame): CoreGame {
  return {
    appid: game.appid,
    name: game.name,
    nameEs: game.nameEs,
    year: game.year,
    flags: game.flags,
  };
}

function visible(game: SampleGame, showAdult: boolean): boolean {
  return showAdult || (game.flags & GAME_FLAGS.adult) === 0;
}

function isRetired(game: SampleGame): boolean {
  return (game.flags & GAME_FLAGS.retired) !== 0;
}

function queryVariants(key: string): string[] {
  const bare = withoutArticle(key);
  return bare === null ? [key] : [key, bare];
}

function tierOf(
  entry: IndexedGame,
  variants: readonly string[],
  compactQ: string,
): SearchTier | null {
  if (variants.some((v) => entry.keys.includes(v))) return 0;
  if (variants.some((v) => entry.keys.some((key) => key.startsWith(v)))) return 1;
  const prefixMatch = variants.some((v) =>
    v.split(' ').every((token) => entry.words.some((word) => word.startsWith(token))),
  );
  if (prefixMatch) return 2;
  if (compactQ.length >= 3 && entry.compact.some((key) => key.includes(compactQ))) return 3;
  return null;
}

interface Ranked {
  readonly entry: IndexedGame;
  readonly tier: SearchTier;
}

/** Niveles 0–3 en el orden de la §8.4. */
export function rankFake(index: FakeIndex, q: string, showAdult: boolean): Ranked[] {
  const key = normalizeLite(q);
  if (key === '') return [];
  const variants = queryVariants(key);
  const compactQ = key.replaceAll(' ', '');
  const aliased = new Set(index.aliases.get(compactQ) ?? []);

  const exact: Ranked[] = [];
  const prefix: Ranked[] = [];
  const substring: Ranked[] = [];
  for (const entry of index.games) {
    if (!visible(entry.game, showAdult)) continue;
    const tier = aliased.has(entry.game.appid) ? 0 : tierOf(entry, variants, compactQ);
    if (tier === 0) exact.push({ entry, tier });
    else if (tier === 1 || tier === 2) prefix.push({ entry, tier });
    else if (tier === 3) substring.push({ entry, tier });
  }
  const score = (r: Ranked) => r.entry.game.pop + (r.tier === 1 ? 6 : 0);
  const byRetiredThenRow = (a: Ranked, b: Ranked) =>
    Number(isRetired(a.entry.game)) - Number(isRetired(b.entry.game)) || a.entry.row - b.entry.row;
  exact.sort(byRetiredThenRow);
  prefix.sort(
    (a, b) =>
      Number(isRetired(a.entry.game)) - Number(isRetired(b.entry.game)) ||
      score(b) - score(a) ||
      a.entry.row - b.entry.row,
  );
  substring.sort(byRetiredThenRow);
  return [...exact, ...prefix, ...substring];
}

function toItem({ entry, tier }: Ranked): SearchItem {
  return { ...toCoreGame(entry.game), tier };
}

export function searchFake(
  index: FakeIndex,
  q: string,
  limit: number,
  showAdult: boolean,
): { items: SearchItem[]; strong: number } {
  const ranked = rankFake(index, q, showAdult);
  const strongRows = ranked.filter((r) => r.tier <= 2);
  const items = strongRows.slice(0, limit);
  if (items.length < limit) {
    const room = Math.min(limit - items.length, SUBSTRING_MAX);
    items.push(...ranked.filter((r) => r.tier === 3).slice(0, room));
  }
  return { items: items.map(toItem), strong: Math.min(strongRows.length, limit) };
}

function bigrams(value: string): Map<string, number> {
  const grams = new Map<string, number>();
  for (let i = 0; i < value.length - 1; i += 1) {
    const gram = value.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

function dice(a: string, b: string): number {
  const ga = bigrams(a);
  const gb = bigrams(b);
  let shared = 0;
  for (const [gram, count] of ga) shared += Math.min(count, gb.get(gram) ?? 0);
  const total = Math.max(a.length - 1, 0) + Math.max(b.length - 1, 0);
  return total === 0 ? 0 : (2 * shared) / total;
}

/** Nivel 4 («¿Quizás buscabas…?»): parecido por bigramas, como sustituto de uFuzzy. */
export function suggestFake(index: FakeIndex, q: string, showAdult: boolean): SearchItem[] {
  const compactQ = normalizeLite(q).replaceAll(' ', '');
  if (compactQ.length < 4) return [];
  const already = new Set(rankFake(index, q, showAdult).map((r) => r.entry.game.appid));
  return index.games
    .filter((entry) => visible(entry.game, showAdult) && !already.has(entry.game.appid))
    .map((entry) => ({
      entry,
      similarity: Math.max(
        ...entry.compact.map((key) => dice(compactQ, key.slice(0, compactQ.length + 2))),
      ),
    }))
    .filter((s) => s.similarity >= 0.5)
    .sort((a, b) => b.similarity - a.similarity || a.entry.row - b.entry.row)
    .slice(0, SUGGEST_MAX)
    .map((s) => ({ ...toCoreGame(s.entry.game), tier: 4 }));
}

/** Filas del Catálogo para un filtro de texto: niveles 0–3 en orden de filas (popularidad). */
export function browseFake(index: FakeIndex, q: string, showAdult: boolean): CoreGame[] {
  if (normalizeLite(q) === '') {
    return index.games.filter((e) => visible(e.game, showAdult)).map((e) => toCoreGame(e.game));
  }
  const matched = new Set(rankFake(index, q, showAdult).map((r) => r.entry.row));
  return index.games.filter((e) => matched.has(e.row)).map((e) => toCoreGame(e.game));
}

export function findFake(index: FakeIndex, appid: number): SampleGame | undefined {
  return index.games.find((e) => e.game.appid === appid)?.game;
}

/** `appid` con la misma clave exacta que el título, sin alias (ver «Vincular», §7.3). */
export function matchExactFake(index: FakeIndex, title: string): number[] {
  const key = normalizeLite(title);
  if (key === '') return [];
  return index.games.filter((e) => e.keys.includes(key)).map((e) => e.game.appid);
}
