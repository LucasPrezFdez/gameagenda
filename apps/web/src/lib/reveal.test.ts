import { describe, expect, it } from 'vitest';
import { REVEAL_MARGIN_PX, revealDelta } from './reveal.ts';

describe('revealDelta', () => {
  const strip = { left: 16, right: 374 };

  it('lo que ya se ve entero no mueve la tira', () => {
    expect(revealDelta(strip, { left: 16, right: 120 })).toBe(0);
    expect(revealDelta(strip, { left: 300, right: 374 })).toBe(0);
  });

  it('a la derecha, lo justo y el margen; a la izquierda, al revés', () => {
    expect(revealDelta(strip, { left: 600, right: 680 })).toBe(680 - 374 + REVEAL_MARGIN_PX);
    expect(revealDelta(strip, { left: 350, right: 400 })).toBe(400 - 374 + REVEAL_MARGIN_PX);
    expect(revealDelta(strip, { left: -200, right: -100 })).toBe(-200 - 16 - REVEAL_MARGIN_PX);
  });
});
