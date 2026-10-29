import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isRankKey, keyBetween, moveNeighbors, rankBetween } from '../src/entries/index.ts';

describe('keyBetween', () => {
  // Vectores de la implementación de referencia (base 62).
  const vectors: Array<[string | null, string | null, string]> = [
    [null, null, 'a0'],
    [null, 'a0', 'Zz'],
    [null, 'Zz', 'Zy'],
    ['a0', null, 'a1'],
    ['a1', null, 'a2'],
    ['a0', 'a1', 'a0V'],
    ['a1', 'a2', 'a1V'],
    ['a0V', 'a1', 'a0l'],
    ['Zz', 'a0', 'ZzV'],
    ['Zz', 'a1', 'a0'],
    [null, 'Y00', 'Xzzz'],
    ['bzz', null, 'c000'],
    ['a0', 'a0V', 'a0G'],
    ['a0', 'a0G', 'a08'],
    ['b125', 'b129', 'b127'],
    ['a0', 'a1V', 'a1'],
    ['Zz', 'a01', 'a0'],
    [null, 'a0V', 'a0'],
    [null, 'b999', 'b99'],
    [null, 'A000000000000000000000000001', 'A000000000000000000000000000V'],
    ['zzzzzzzzzzzzzzzzzzzzzzzzzzy', null, 'zzzzzzzzzzzzzzzzzzzzzzzzzzz'],
    ['zzzzzzzzzzzzzzzzzzzzzzzzzzz', null, 'zzzzzzzzzzzzzzzzzzzzzzzzzzzV'],
  ];

  it.each(vectors)('entre %s y %s → %s', (a, b, expected) => {
    const k = keyBetween(a, b);
    expect(k).toBe(expected);
    if (a !== null) expect(a < k).toBe(true);
    if (b !== null) expect(k < b).toBe(true);
  });

  it('rechaza claves no válidas o desordenadas', () => {
    expect(() => keyBetween(null, 'A00000000000000000000000000')).toThrow(RangeError);
    expect(() => keyBetween('a00', null)).toThrow(RangeError);
    expect(() => keyBetween('a00', 'a1')).toThrow(RangeError);
    expect(() => keyBetween('0', '1')).toThrow(RangeError);
    expect(() => keyBetween('a1', 'a0')).toThrow(RangeError);
    expect(() => keyBetween('a1', 'a1')).toThrow(RangeError);
    expect(() => keyBetween('a-', null)).toThrow(RangeError);
  });

  it('lo nuevo va al final sin renumerar: cada clave es mayor que la anterior', () => {
    let last: string | null = null;
    for (let i = 0; i < 5000; i++) {
      const k = keyBetween(last, null);
      if (last !== null) expect(last < k).toBe(true);
      last = k;
    }
    expect(last?.length).toBeLessThanOrEqual(4);
  });

  it('propiedad: insertar en cualquier posición mantiene el orden como texto', () => {
    fc.assert(
      fc.property(fc.array(fc.nat(), { maxLength: 60 }), (positions) => {
        const keys: string[] = [];
        for (const p of positions) {
          const i = keys.length === 0 ? 0 : p % (keys.length + 1);
          const k = keyBetween(keys[i - 1] ?? null, keys[i] ?? null);
          expect(isRankKey(k)).toBe(true);
          keys.splice(i, 0, k);
        }
        for (let i = 1; i < keys.length; i++) {
          expect((keys[i - 1] as string) < (keys[i] as string)).toBe(true);
        }
      }),
      { numRuns: 1000 },
    );
  });
});

describe('isRankKey', () => {
  it('valida claves', () => {
    for (const k of ['a0', 'Zz', 'a0V', 'b00', 'c000', 'A000000000000000000000000000V']) {
      expect(isRankKey(k)).toBe(true);
    }
    for (const k of ['', 'a', 'a00', 'b0', 'A00000000000000000000000000', '0', 'a0 ', 'a-', 7]) {
      expect(isRankKey(k)).toBe(false);
    }
  });
});

describe('mover en el orden manual', () => {
  const ranks = ['a0', 'a1', 'a2', 'a3'];

  it('subir, bajar, al principio y al final dan los vecinos de destino', () => {
    expect(moveNeighbors(ranks, 2, 1)).toEqual({ above: 'a0', below: 'a1' });
    expect(moveNeighbors(ranks, 1, 2)).toEqual({ above: 'a2', below: 'a3' });
    expect(moveNeighbors(ranks, 3, 0)).toEqual({ above: null, below: 'a0' });
    expect(moveNeighbors(ranks, 0, 3)).toEqual({ above: 'a3', below: null });
  });

  it('la clave nueva cae entre los vecinos', () => {
    const { above, below } = moveNeighbors(ranks, 3, 1);
    const k = rankBetween(above, below);
    expect(k > 'a0' && k < 'a1').toBe(true);
  });

  it('con vecinos empatados devuelve la misma clave', () => {
    expect(rankBetween('a1', 'a1')).toBe('a1');
  });

  it('rechaza posiciones fuera de rango', () => {
    expect(() => moveNeighbors(ranks, 4, 0)).toThrow(RangeError);
    expect(() => moveNeighbors(ranks, 0, -1)).toThrow(RangeError);
  });
});
