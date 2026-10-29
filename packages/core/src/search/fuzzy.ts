// Nivel 4 (§8.4 y §8.7): difuso con uFuzzy 1.0.19 (`intraMode: 1`) sobre las claves base, en
// bloques de 20 000 nombres y cancelable. uFuzzy se carga con `import()` diferido, en su chunk.

import { isAscii, normalize } from '../normalize/index.ts';
import { hiddenAdult, type KeyData, rowOfAppid, searchItem } from './keys.ts';
import {
  type FuzzyMatcher,
  type SearchItem,
  type SuggestOptions,
  type SuggestTask,
  Tier,
} from './types.ts';

/** Nombres por bloque del nivel 4. */
export const FUZZY_BLOCK = 20_000;
/** Sugerencias que muestra la paleta. */
export const SUGGEST_LIMIT = 3;
/** El nivel 4 se ofrece si los niveles 0–2 dan menos de esto. */
const SUGGEST_BELOW = 5;
/** Caracteres mínimos de la consulta normalizada (latinos). */
const SUGGEST_MIN_LENGTH = 4;

/** Carga uFuzzy (en su propio chunk) con las opciones medidas. */
export async function loadFuzzy(): Promise<FuzzyMatcher> {
  const { default: UFuzzy } = await import('@leeoniya/ufuzzy');
  return new UFuzzy({ intraMode: 1, interLft: 1 });
}

/**
 * `true` si la consulta admite el nivel 4: los niveles 0–2 dieron <5 filas y la clave tiene
 * ≥4 caracteres, todos latinos (la pausa de 150 ms sin teclear la decide la paleta).
 */
export function canSuggest(q: string, strong: number): boolean {
  if (strong >= SUGGEST_BELOW) return false;
  const qn = normalize(q);
  return qn.length >= SUGGEST_MIN_LENGTH && isAscii(qn);
}

/**
 * Añade las sugerencias al final de la lista que ve el usuario: hasta `limit` filas, las de los
 * niveles 0–3 primero y las sugerencias detrás (§8.10).
 */
export function withSuggestions(
  items: readonly SearchItem[],
  suggestions: readonly SearchItem[],
  limit = 8,
): SearchItem[] {
  const more = suggestions.slice(0, limit);
  return [...items.slice(0, Math.max(0, limit - more.length)), ...more];
}

// Bloques de claves base por catálogo, creados la primera vez que hacen falta.
const blocksOf = new WeakMap<KeyData, string[][]>();

function fuzzyBlocks(keys: KeyData): string[][] {
  let blocks = blocksOf.get(keys);
  if (!blocks) {
    blocks = [];
    for (let i = 0; i < keys.n; i += FUZZY_BLOCK) {
      blocks.push(keys.kBase.slice(i, Math.min(keys.n, i + FUZZY_BLOCK)) as string[]);
    }
    blocksOf.set(keys, blocks);
  }
  return blocks;
}

export function suggestTask(
  keys: KeyData,
  q: string,
  fuzzy: FuzzyMatcher,
  options: SuggestOptions,
): SuggestTask {
  const qn = normalize(q);
  const limit = options.limit ?? SUGGEST_LIMIT;
  const showAdult = options.showAdult ?? false;
  const exclude = new Set<number>();
  for (const a of options.exclude ?? []) {
    const g = rowOfAppid(keys, a);
    if (g >= 0) exclude.add(g);
  }
  const items: SearchItem[] = [];
  let block = 0;
  let done = qn.length < SUGGEST_MIN_LENGTH || !isAscii(qn) || limit <= 0;
  return {
    items,
    step(): boolean {
      if (done) return true;
      const blocks = fuzzyBlocks(keys);
      const hay = blocks[block];
      if (!hay) {
        done = true;
        return true;
      }
      const base = block * FUZZY_BLOCK;
      // uFuzzy devuelve los índices en orden, así que el resultado sale en orden de filas.
      for (const i of fuzzy.filter(hay, qn) ?? []) {
        const g = base + i;
        if (exclude.has(g) || hiddenAdult(keys, g, showAdult)) continue;
        items.push(searchItem(keys, g, Tier.fuzzy));
        if (items.length >= limit) {
          done = true;
          break;
        }
      }
      block++;
      if (block >= blocks.length) done = true;
      return done;
    },
  };
}
