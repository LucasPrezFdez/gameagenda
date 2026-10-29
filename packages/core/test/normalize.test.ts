import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  articleLength,
  compact,
  generateAcronyms,
  normalize,
  normalizeUnicode,
  numberExtra,
  stripArticle,
  tokenize,
} from '../src/normalize/index.ts';
import vectors from './normalize.vectors.json' with { type: 'json' };

// Apóstrofos y marcas que la §8.1 elimina; diacríticos que quita (bloques de marcas latinas).
const APOSTROPHES = ["'", '‘', '’', '‛', 'ʼ', 'ʻ', '`', '´', '′', '＇'];
const SIGNS = ['™', '℠', '®', '©'];
const RE_REMOVED = /['‘’‛ʼʻ`´′＇™℠®©]/u;
const RE_MARKS = /[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]/u;

// Texto con mucho de lo que la normalización trata: apóstrofos, marcas, mayúsculas, ligaduras,
// signos, espacios, CJK y caracteres de todo Unicode.
const SPECIALS = [
  ...APOSTROPHES,
  ...SIGNS,
  'A',
  'z',
  'Q',
  '0',
  '9',
  ' ',
  '  ',
  '\t',
  '-',
  ':',
  '.',
  '&',
  '_',
  '/',
  'ß',
  'Æ',
  'œ',
  'Ø',
  'Ł',
  'đ',
  'ð',
  'Þ',
  'ı',
  'İ',
  'É',
  'é',
  'é',
  'Ō',
  'ñ',
  'Ⅻ',
  'ﬁ',
  'Ｆ',
  'ŉ',
  '″',
  'Σ',
  'ς',
  '三',
  '国',
  'ガ',
  'ガ',
  '가',
  '가',
  '😀',
  ' ',
  '　',
];
const text = fc.oneof(
  fc.string({ unit: fc.constantFrom(...SPECIALS), maxLength: 30 }),
  fc.string({ unit: 'binary', maxLength: 30 }),
  fc.string({ unit: 'grapheme', maxLength: 30 }),
);
const RUNS = { numRuns: 2000 };

describe('normalize: vectores compartidos', () => {
  it.each(vectors.normalize)('$input → «$normalized» ($note)', (v) => {
    expect(normalize(v.input)).toBe(v.normalized);
    // La ruta general da lo mismo que la vía rápida ASCII.
    expect(normalizeUnicode(v.input)).toBe(v.normalized);
    expect(tokenize(v.normalized)).toEqual(v.tokens);
    expect(tokenize(v.normalized, true)).toEqual(v.queryTokens);
    const words = v.normalized.split(' ').filter(Boolean);
    expect(words.slice(1).map(numberExtra).filter(Boolean)).toEqual(v.extras);
    expect(stripArticle(v.normalized)).toBe(v.withoutArticle);
    expect(compact(v.normalized)).toBe(v.compact);
  });

  it.each(vectors.acronyms)('siglas de $name', (v) => {
    expect(generateAcronyms(v.name)).toEqual(v.acronyms);
  });

  it('cubre la tabla de la §8.1', () => {
    const table: Record<string, string> = {
      'HELLDIVERS™ 2': 'helldivers 2',
      "Baldur's Gate 3": 'baldurs gate 3',
      'Assassin’s Creed® Unity': 'assassins creed unity',
      'Counter-Strike 2': 'counter strike 2',
      'NieR:Automata™': 'nier automata',
      'ŌKAMI HD': 'okami hd',
      'Déjà Vu': 'deja vu',
      Señorita: 'senorita',
      Straße: 'strasse',
      'Æon Flux': 'aeon flux',
      Łódź: 'lodz',
      'Ratchet & Clank: Rift Apart': 'ratchet and clank rift apart',
      ＦＵＬＬＷＩＤＴＨ: 'fullwidth',
      'Ⅻ Legends': 'xii legends',
      'S.T.A.L.K.E.R. 2': 's t a l k e r 2',
      三国志14: '三国志14',
      '가디언 테일즈': '가디언 테일즈',
    };
    const inVectors = new Map(vectors.normalize.map((v) => [v.input, v.normalized]));
    for (const [input, expected] of Object.entries(table)) {
      expect(inVectors.get(input), input).toBe(expected);
    }
  });
});

describe('normalize: claves', () => {
  it('artículo inicial solo si le sigue otra palabra', () => {
    expect(articleLength('the witcher 3')).toBe(4);
    expect(articleLength('los sims 4')).toBe(4);
    expect(articleLength('the')).toBe(0);
    expect(articleLength('theme park')).toBe(0);
    expect(stripArticle('a hat in time')).toBe('hat in time');
  });

  it('romanos 1–20 ↔ arábigos, solo palabras canónicas', () => {
    expect(numberExtra('v')).toBe('5');
    expect(numberExtra('xx')).toBe('20');
    expect(numberExtra('xxi')).toBeNull();
    expect(numberExtra('20')).toBe('xx');
    expect(numberExtra('05')).toBeNull();
    expect(numberExtra('21')).toBeNull();
    expect(numberExtra('vi')).toBe('6');
    expect(numberExtra('vim')).toBeNull();
  });

  it('CJK: bigramas y último carácter en el índice; solo bigramas en la consulta', () => {
    expect(tokenize('三国志')).toEqual(['三国', '国志', '志']);
    expect(tokenize('三国志', true)).toEqual(['三国', '国志']);
    expect(tokenize('三国志14 x')).toEqual(['三国', '国志', '志', '14', 'x']);
    expect(tokenize('三')).toEqual(['三']);
  });
});

describe('normalize: propiedades (§12.2)', () => {
  it('es idempotente', () => {
    fc.assert(
      fc.property(text, (s) => normalize(normalize(s)) === normalize(s)),
      RUNS,
    );
  });

  it('no deja mayúsculas, diacríticos, apóstrofos, ™ ℠ ® © ni espacios sobrantes', () => {
    fc.assert(
      fc.property(text, (s) => {
        const n = normalize(s);
        expect(n).toBe(n.toLowerCase());
        expect(RE_MARKS.test(n.normalize('NFD'))).toBe(false);
        expect(RE_REMOVED.test(n)).toBe(false);
        expect(n).toBe(n.trim());
        expect(n.includes('  ')).toBe(false);
        expect(/[^\S ]/u.test(n)).toBe(false);
      }),
      RUNS,
    );
  });

  it('quitar apóstrofos de la entrada no la cambia', () => {
    fc.assert(
      fc.property(text, (s) => {
        let stripped = s;
        for (const a of APOSTROPHES) stripped = stripped.replaceAll(a, '');
        return normalize(stripped) === normalize(s);
      }),
      RUNS,
    );
  });

  it('la vía rápida ASCII coincide con la ruta general', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary-ascii', maxLength: 40 }), (s) => {
        return normalize(s) === normalizeUnicode(s);
      }),
      RUNS,
    );
  });
});
