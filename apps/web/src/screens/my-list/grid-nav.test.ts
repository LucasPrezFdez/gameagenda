import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { gridStep } from './grid-nav.ts';

// Dos secciones con 4 columnas: la primera con 6 tarjetas (filas de 4 y 2) y la segunda con 3.
//   0 1 2 3
//   4 5
//   ---------
//   6 7 8
const LENGTHS = [6, 3];

describe('gridStep', () => {
  it('↓ baja a la misma columna de la fila siguiente', () => {
    expect(gridStep(LENGTHS, 4, 1, 1)).toBe(5);
  });

  it('↓ a una fila más corta va a su última tarjeta', () => {
    expect(gridStep(LENGTHS, 4, 3, 1)).toBe(5);
  });

  it('↓ desde la última fila pasa a la siguiente sección, en su columna', () => {
    expect(gridStep(LENGTHS, 4, 5, 1)).toBe(7);
    expect(gridStep(LENGTHS, 4, 4, 1)).toBe(6);
  });

  it('↓ en la última fila de todas no se mueve', () => {
    expect(gridStep(LENGTHS, 4, 8, 1)).toBe(8);
  });

  it('↑ sube a la misma columna, también a la última fila de la sección de arriba', () => {
    expect(gridStep(LENGTHS, 4, 5, -1)).toBe(1);
    expect(gridStep(LENGTHS, 4, 7, -1)).toBe(5);
    // La columna 2 no existe en la fila de arriba (4 5): la última de esa fila.
    expect(gridStep(LENGTHS, 4, 8, -1)).toBe(5);
  });

  it('↑ en la primera fila de todas no se mueve', () => {
    expect(gridStep(LENGTHS, 4, 2, -1)).toBe(2);
  });

  it('se salta las secciones plegadas o vacías', () => {
    // Quiero jugar (2), En pausa plegada (0) y Completado (2), con 3 columnas.
    expect(gridStep([2, 0, 2], 3, 1, 1)).toBe(3);
    expect(gridStep([2, 0, 2], 3, 3, -1)).toBe(1);
  });

  it('con una columna es la lista: ↓ es la siguiente y ↑ la anterior', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 8 }), { minLength: 1, maxLength: 6 }),
        (lengths) => {
          const total = lengths.reduce((a, b) => a + b, 0);
          for (let index = 0; index < total; index += 1) {
            expect(gridStep(lengths, 1, index, 1)).toBe(Math.min(total - 1, index + 1));
            expect(gridStep(lengths, 1, index, -1)).toBe(Math.max(0, index - 1));
          }
        },
      ),
    );
  });

  it('siempre cae en una tarjeta que existe, y ↓ nunca sube ni ↑ baja', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 30 }), { minLength: 1, maxLength: 7 }),
        fc.integer({ min: 1, max: 14 }),
        (lengths, columns) => {
          const total = lengths.reduce((a, b) => a + b, 0);
          for (let index = 0; index < total; index += 1) {
            const down = gridStep(lengths, columns, index, 1);
            const up = gridStep(lengths, columns, index, -1);
            expect(down).toBeGreaterThanOrEqual(index);
            expect(down).toBeLessThan(total);
            expect(up).toBeLessThanOrEqual(index);
            expect(up).toBeGreaterThanOrEqual(0);
          }
        },
      ),
    );
  });
});
