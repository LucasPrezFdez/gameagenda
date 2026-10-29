// Texto del filtro de Mi lista y de la búsqueda en Mi lista (estado `none`), con la misma
// normalización que el índice y la consulta: `normalize()` de `@gameagenda/core` (ver §8.1).
import { normalize } from '@gameagenda/core/normalize';

/**
 * @deprecated Alias de `normalize()` para el cliente falso de búsqueda mientras exista; el código
 * nuevo usa `normalize()` de `@gameagenda/core/normalize`.
 */
export const normalizeLite: (value: string) => string = normalize;

/** Tokens de la clave normalizada. */
export function tokensOf(value: string): string[] {
  const key = normalize(value);
  return key === '' ? [] : key.split(' ');
}

/** ¿Cada token de la consulta es prefijo de alguna palabra del título? */
export function matchesAllPrefixes(titleTokens: readonly string[], query: readonly string[]) {
  return query.every((q) => titleTokens.some((t) => t.startsWith(q)));
}
