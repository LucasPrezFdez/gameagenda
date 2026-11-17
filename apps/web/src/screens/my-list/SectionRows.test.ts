import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { visibleRange } from './SectionRows.tsx';

// Filas de 76 px (`--row-h`) en una ventana de 800 px, como en el escritorio.
const ROW = 76;
const VIEW = 800;
/** Las filas de más por encima y por debajo (`OVERSCAN` en SectionRows.tsx). */
const OVERSCAN = 12;

describe('visibleRange', () => {
  it('sin filas no pinta ninguna', () => {
    expect(visibleRange(0, VIEW, ROW, 0)).toEqual({ start: 0, end: -1 });
  });

  it('con la lista arriba, lo que cabe en la ventana y las de más por debajo', () => {
    // 800 / 76 = 10,5: las filas 0 a 10 tocan la ventana; con las de más, hasta la 23.
    expect(visibleRange(0, VIEW, ROW, 1000)).toEqual({ start: 0, end: 11 + OVERSCAN });
  });

  it('desplazada, las que tocan la ventana con las de más a los dos lados', () => {
    // 100 filas por encima de la ventana: tocan de la 100 a la 110.
    expect(visibleRange(-100 * ROW, VIEW, ROW, 1000)).toEqual({
      start: 100 - OVERSCAN,
      end: 111 + OVERSCAN,
    });
  });

  it('con pocas filas, todas', () => {
    expect(visibleRange(0, VIEW, ROW, 5)).toEqual({ start: 0, end: 4 });
  });

  it('con la lista por debajo de la ventana, solo la primera (para medir el alto de una fila)', () => {
    expect(visibleRange(2000, VIEW, ROW, 1000)).toEqual({ start: 0, end: 0 });
  });

  it('con la lista ya pasada, solo la última', () => {
    expect(visibleRange(-1000 * ROW - 5000, VIEW, ROW, 1000)).toEqual({ start: 999, end: 999 });
  });

  it('pinta siempre al menos una fila, dentro de la sección, y todas las que tocan la ventana', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6000 }),
        fc.integer({ min: 48, max: 160 }),
        fc.integer({ min: 200, max: 2400 }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        (count, row, viewport, where) => {
          // De la lista muy por debajo de la ventana a ya pasada, en cualquier punto intermedio.
          const listTop = Math.round(where * (count * row + viewport));
          const { start, end } = visibleRange(listTop, viewport, row, count);
          expect(start).toBeGreaterThanOrEqual(0);
          expect(end).toBeGreaterThanOrEqual(start);
          expect(end).toBeLessThanOrEqual(count - 1);
          for (let index = 0; index < count; index += 1) {
            const top = listTop + index * row;
            const touches = top < viewport && top + row > 0;
            if (touches) {
              expect(index).toBeGreaterThanOrEqual(start);
              expect(index).toBeLessThanOrEqual(end);
            }
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
