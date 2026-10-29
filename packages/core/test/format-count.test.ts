import { describe, expect, it } from 'vitest';
import { formatCount, THOUSANDS_SEPARATOR as S } from '../src/index.ts';

describe('formatCount', () => {
  it('no separa hasta 4 cifras', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(230)).toBe('230');
    expect(formatCount(2000)).toBe('2000');
    expect(formatCount(9999)).toBe('9999');
  });

  it('separa con espacio fino irrompible a partir de 5 cifras', () => {
    expect(formatCount(10000)).toBe(`10${S}000`);
    expect(formatCount(196665)).toBe(`196${S}665`);
    expect(formatCount(1234567)).toBe(`1${S}234${S}567`);
  });

  it('conserva el signo', () => {
    expect(formatCount(-196665)).toBe(`-196${S}665`);
    expect(formatCount(-2000)).toBe('-2000');
  });

  it('rechaza lo que no es un entero seguro', () => {
    expect(() => formatCount(1.5)).toThrow(RangeError);
    expect(() => formatCount(Number.NaN)).toThrow(RangeError);
  });
});
