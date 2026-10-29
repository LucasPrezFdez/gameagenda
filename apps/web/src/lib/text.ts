// Normalización mínima para el filtro de Mi lista, la búsqueda en Mi lista (estado `none`)
// y el cliente falso. Provisional: se sustituye por `normalize()` de `@gameagenda/core`
// (ver §8.1), que ya define el orden completo de los pasos y sus vectores de prueba.

const MARKS = /[™℠®©]/g;
const APOSTROPHES = /['’‘‛ʼʻ`´′＇]/g;
const DIACRITICS = /[̀-ͯ]/g;
const NON_WORD = /[^\p{L}\p{N}]+/gu;

export function normalizeLite(value: string): string {
  return value
    .replace(MARKS, '')
    .replace(APOSTROPHES, '')
    .normalize('NFKD')
    .replace(DIACRITICS, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(NON_WORD, ' ')
    .trim();
}

/** Tokens de la clave normalizada. */
export function tokensOf(value: string): string[] {
  const key = normalizeLite(value);
  return key === '' ? [] : key.split(' ');
}

/** ¿Cada token de la consulta es prefijo de alguna palabra del título? */
export function matchesAllPrefixes(titleTokens: readonly string[], query: readonly string[]) {
  return query.every((q) => titleTokens.some((t) => t.startsWith(q)));
}
