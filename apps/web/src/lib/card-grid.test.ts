import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CARD_GAP, CARD_MIN, cardWidth, gridColumns, MAX_COLUMNS } from './card-grid.ts';

describe('gridColumns', () => {
  it('sin ancho medido, el mínimo', () => {
    expect(gridColumns(0, 3)).toBe(3);
    expect(gridColumns(Number.NaN, 2)).toBe(2);
  });

  it('en el móvil, nunca menos del mínimo de cada pantalla', () => {
    // 320 px de ventana y 16 de margen a cada lado: 288 px.
    expect(gridColumns(288, 3)).toBe(3);
    expect(gridColumns(288, 2)).toBe(2);
  });

  it('las de siempre hasta 1 440 px, y más con la columna llena', () => {
    // La ventana de la app de escritorio (1 100 px) con la barra lateral abierta: 788 px.
    expect(gridColumns(788, 3)).toBe(4);
    expect(gridColumns(1440, 3)).toBe(8);
    // 2 560 px con la barra lateral (248) y el margen: unos 2 240.
    expect(gridColumns(2240, 3)).toBe(13);
  });

  it('las tarjetas nunca bajan de `CARD_MIN` salvo con el mínimo de columnas', () => {
    fc.assert(
      fc.property(fc.integer({ min: 400, max: 2600 }), (width) => {
        const columns = gridColumns(width, 2);
        expect(columns).toBeLessThanOrEqual(MAX_COLUMNS);
        if (columns > 2 && columns < MAX_COLUMNS) {
          expect(cardWidth(width, columns)).toBeGreaterThanOrEqual(CARD_MIN);
          // Con una más ya no cabrían.
          expect(cardWidth(width, columns + 1)).toBeLessThan(CARD_MIN);
        }
      }),
    );
  });
});

describe('cardWidth', () => {
  it('reparte el ancho entre las columnas, con su hueco', () => {
    expect(cardWidth(1440, 8)).toBe(Math.floor((1440 - 7 * CARD_GAP) / 8));
    // Las tarjetas y los huecos nunca pasan del ancho.
    fc.assert(
      fc.property(fc.integer({ min: 200, max: 4000 }), fc.integer({ min: 1, max: 16 }), (w, c) => {
        expect(cardWidth(w, c) * c + CARD_GAP * (c - 1)).toBeLessThanOrEqual(w);
      }),
    );
  });
});
