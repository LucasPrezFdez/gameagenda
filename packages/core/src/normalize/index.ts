// Normalización y claves de búsqueda (§8.1, §8.2 y §8.5 de prototipe.md).
// Una sola función para el índice, la consulta, el pipeline y las pruebas.

// Paso 1: ™ ℠ ® © y todas las formas de apóstrofo (' ‘ ’ ‛ ʼ ʻ ` ´ ′ ＇), antes de NFKD.
const RE_STRIP = /[™℠®©'‘’‛ʼʻ`´′＇]/g;
// Paso 3: bloques de marcas combinantes latinas; no toca kana, hangul ni escrituras índicas.
const RE_MARKS = /[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]/g;
const LIGATURES: Readonly<Record<string, string>> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ı: 'i',
};
const RE_LIGATURES = /[ßæœøłđðþı]/g;
const RE_SEPARATORS = /[^\p{L}\p{N}\p{M}]+/gu;

const replaceLigature = (c: string): string => LIGATURES[c] ?? c;

/**
 * Ruta general de `normalize()`, sin la vía rápida ASCII. Se exporta para comprobar en las
 * pruebas que las dos rutas dan lo mismo.
 */
export function normalizeUnicode(s: string): string {
  return (
    s
      .replace(RE_STRIP, '')
      .normalize('NFKD')
      // NFKD puede producir apóstrofos (ŉ → ʼn, ″ → ′′): se quitan también aquí.
      .replace(RE_STRIP, '')
      .replace(RE_MARKS, '')
      .normalize('NFC')
      .toLowerCase()
      .replace(RE_LIGATURES, replaceLigature)
      .replace(/&/g, ' and ')
      .replace(RE_SEPARATORS, ' ')
      .trim()
  );
}

/**
 * Clave normalizada de un nombre o de una consulta: sin marcas, apóstrofos ni diacríticos, en
 * minúsculas, `&` → `and` y cualquier otro signo → un espacio (§8.1).
 */
export function normalize(s: string): string {
  const n = s.length;
  for (let i = 0; i < n; i++) if (s.charCodeAt(i) > 127) return normalizeUnicode(s);
  // Vía rápida ASCII (92 % de los nombres): mismo resultado que normalizeUnicode().
  let out = '';
  let pending = false;
  for (let i = 0; i < n; i++) {
    let c = s.charCodeAt(i);
    if (c >= 65 && c <= 90) c += 32;
    if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) {
      if (pending && out.length > 0) out += ' ';
      pending = false;
      out += String.fromCharCode(c);
    } else if (c === 39 || c === 96) {
      // apóstrofo: se elimina
    } else if (c === 38) {
      if (out.length > 0) out += ' ';
      out += 'and';
      pending = true;
    } else {
      pending = true;
    }
  }
  return out;
}

/** Clave compacta: la normalizada sin espacios («eldenring», «halflife»). */
export function compact(normalized: string): string {
  return normalized.replaceAll(' ', '');
}

/** Artículos iniciales que se prueban con y sin ellos (§8.2). */
export const ARTICLES: ReadonlySet<string> = new Set(['the', 'a', 'an', 'el', 'la', 'los', 'las']);

/** Longitud del artículo inicial con su espacio (0 si no hay o si es la única palabra). */
export function articleLength(normalized: string): number {
  const i = normalized.indexOf(' ');
  return i > 0 && i <= 3 && ARTICLES.has(normalized.slice(0, i)) ? i + 1 : 0;
}

/** Clave sin el artículo inicial («the witcher 3» → «witcher 3»); igual si no lo hay. */
export function stripArticle(normalized: string): string {
  const len = articleLength(normalized);
  return len > 0 ? normalized.slice(len) : normalized;
}

/** `true` si todas las unidades UTF-16 son ASCII. */
export function isAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) return false;
  return true;
}

const RE_CJK = /[\p{scx=Han}\p{scx=Hira}\p{scx=Kana}\p{scx=Hang}]/u;

/** `true` si el texto tiene algún carácter han, kana o hangul. */
export function hasCjk(s: string): boolean {
  return RE_CJK.test(s);
}

/**
 * Tokens de una clave normalizada: sus palabras, salvo las tiras CJK, kana y hangul, que se
 * parten en bigramas solapados más el último carácter (en la consulta, solo bigramas).
 */
export function tokenize(normalized: string, isQuery = false): string[] {
  const out: string[] = [];
  if (!normalized) return out;
  const ascii = isAscii(normalized);
  for (const w of normalized.split(' ')) {
    if (!w) continue;
    if (ascii || !RE_CJK.test(w)) {
      out.push(w);
      continue;
    }
    const cps = Array.from(w);
    let i = 0;
    while (i < cps.length) {
      const cjk = RE_CJK.test(cps[i] as string);
      let j = i + 1;
      while (j < cps.length && RE_CJK.test(cps[j] as string) === cjk) j++;
      if (!cjk) out.push(cps.slice(i, j).join(''));
      else if (j - i === 1) out.push(cps[i] as string);
      else {
        for (let k = i; k < j - 1; k++) out.push((cps[k] as string) + (cps[k + 1] as string));
        if (!isQuery) out.push(cps[j - 1] as string);
      }
      i = j;
    }
  }
  return out;
}

const ROMAN = [
  '',
  'i',
  'ii',
  'iii',
  'iv',
  'v',
  'vi',
  'vii',
  'viii',
  'ix',
  'x',
  'xi',
  'xii',
  'xiii',
  'xiv',
  'xv',
  'xvi',
  'xvii',
  'xviii',
  'xix',
  'xx',
] as const;
const ROMAN_VALUE: ReadonlyMap<string, number> = new Map(ROMAN.slice(1).map((r, i) => [r, i + 1]));

/** Valor de un romano del 1 al 20 en minúsculas («xii» → 12), o 0 si no lo es. */
export function romanValue(word: string): number {
  return ROMAN_VALUE.get(word) ?? 0;
}

/**
 * Token extra de un número aislado que no es la primera palabra (§8.2): romano 1–20 → arábigo
 * y arábigo 1–20 → romano; `null` si no corresponde («grand theft auto v» → «5»).
 */
export function numberExtra(word: string): string | null {
  const c = word.charCodeAt(0);
  if ((c === 105 || c === 118 || c === 120) && word.length <= 5) {
    const r = ROMAN_VALUE.get(word);
    return r ? String(r) : null;
  }
  if (c >= 49 && c <= 57 && word.length <= 2) {
    const v = Number(word);
    return v >= 1 && v <= 20 && String(v) === word ? (ROMAN[v] as string) : null;
  }
  return null;
}

/** Pares (palabra, token extra) posibles, para quien necesite recorrerlos todos. */
export const NUMBER_EXTRAS: ReadonlyArray<readonly [word: string, extra: string]> = ROMAN.slice(
  1,
).flatMap((r, i) => [[r, String(i + 1)] as const, [String(i + 1), r] as const]);

// ------------------------------------------------------------------ siglas (§8.5)

const RE_SUBTITLE = /\s*(?::|\s[-–—|]\s)\s*/;
const RE_DIGITS = /^\d+$/;

function acronymOf(normalized: string): string[] {
  const words = normalized.split(' ').filter(Boolean);
  if (words.length < 2) return [];
  let a = '';
  let b = '';
  let letters = 0;
  for (let i = 0; i < words.length; i++) {
    const t = words[i] as string;
    if (RE_DIGITS.test(t)) {
      a += t;
      b += t;
      continue;
    }
    const r = i > 0 ? romanValue(t) : 0;
    if (r) {
      a += t;
      b += String(r);
      continue;
    }
    if (RE_CJK.test(t)) return [];
    a += t[0];
    b += t[0];
    letters++;
  }
  const out: string[] = [];
  for (const x of new Set([a, b])) if (letters >= 2 && x.length >= 3 && x.length <= 10) out.push(x);
  return out;
}

/**
 * Siglas generadas de un nombre (§8.5): iniciales del título completo y del principal (antes de
 * `:` o ` - `), con y sin artículo; los números enteros, los romanos en dos variantes y un corte
 * en el primer número del título principal. Longitud 3–10 con ≥2 letras. El pipeline descarta
 * después las que son un artículo o una palabra común.
 */
export function generateAcronyms(name: string): string[] {
  const set = new Set<string>();
  const full = normalize(name);
  const main = normalize(name.split(RE_SUBTITLE)[0] ?? '');
  for (const n of new Set([full, main, stripArticle(full), stripArticle(main)])) {
    for (const x of acronymOf(n)) set.add(x);
  }
  const mainWords = main.split(' ');
  for (let i = 1; i < mainWords.length; i++) {
    const w = mainWords[i] as string;
    if (RE_DIGITS.test(w) || romanValue(w)) {
      for (const x of acronymOf(mainWords.slice(0, i + 1).join(' '))) set.add(x);
      break;
    }
  }
  return [...set];
}
