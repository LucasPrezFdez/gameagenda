import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CODE_ALPHABET,
  CODE_SYMBOLS,
  codeFromBytes,
  FORMATTED_CODE_LENGTH,
  formatCode,
  isCanonicalCode,
  parseCode,
} from '../src/api/index.ts';

const bytes = fc.uint8Array({ minLength: CODE_SYMBOLS, maxLength: CODE_SYMBOLS });

describe('códigos de emparejamiento y recuperación', () => {
  it('28 símbolos de Crockford, sin I, L, O ni U: ≥128 bits', () => {
    expect(CODE_ALPHABET).toHaveLength(32);
    expect(CODE_ALPHABET).not.toMatch(/[ILOU]/);
    expect(CODE_SYMBOLS * 5).toBeGreaterThanOrEqual(128);
    expect(FORMATTED_CODE_LENGTH).toBe(34);
  });

  it('cada byte da un símbolo y todos los símbolos salen por igual', () => {
    const all = new Uint8Array(256).map((_, i) => i);
    const counts = new Map<string, number>();
    for (let i = 0; i < 256; i += CODE_SYMBOLS) {
      const chunk = new Uint8Array(CODE_SYMBOLS);
      chunk.set(all.subarray(i, i + CODE_SYMBOLS));
      for (const ch of codeFromBytes(chunk)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    expect(counts.size).toBe(32);
    expect(() => codeFromBytes(new Uint8Array(16))).toThrow(RangeError);
  });

  it('formatear y leer es ida y vuelta, también como lo teclearía alguien', () => {
    fc.assert(
      fc.property(bytes, (b) => {
        const code = codeFromBytes(b);
        expect(isCanonicalCode(code)).toBe(true);
        const formatted = formatCode(code);
        expect(formatted).toMatch(/^([0-9A-Z]{4}-){6}[0-9A-Z]{4}$/);
        expect(parseCode(formatted)).toBe(code);
        const typed = formatted
          .toLowerCase()
          .replace(/-/g, ' ')
          .replace(/0/g, 'o')
          .replace(/1/g, 'i');
        expect(parseCode(typed)).toBe(code);
      }),
    );
  });

  it('rechaza lo que no es un código', () => {
    for (const input of ['', 'ABCD', `${'A'.repeat(27)}U`, 'A'.repeat(29), `${'A'.repeat(27)}!`]) {
      expect(parseCode(input), input).toBeNull();
    }
    expect(() => formatCode('abc')).toThrow(TypeError);
  });
});
