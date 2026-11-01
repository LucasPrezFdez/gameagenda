import { describe, expect, it } from 'vitest';
import { shouldFlipMenu } from './MenuButton.tsx';

// Botón de 144 px y menú de 208 px (13rem), como el de «Orden» de Mi lista.
const WIDTH = 208;
const at = (left: number) => ({ left, right: left + 144 });

describe('shouldFlipMenu', () => {
  it('no da la vuelta si el menú cabe', () => {
    expect(shouldFlipMenu('start', at(16), WIDTH, 1100)).toBe(false);
    expect(shouldFlipMenu('end', at(940), WIDTH, 1100)).toBe(false);
  });

  it('da la vuelta a un menú `start` que se sale por la derecha (la ventana de escritorio)', () => {
    // Botón pegado al borde derecho de 1 100 px: con `start`, el menú acaba en 1 148.
    expect(shouldFlipMenu('start', at(940), WIDTH, 1100)).toBe(true);
  });

  it('da la vuelta a un menú `end` que se sale por la izquierda (la cabecera salta de línea)', () => {
    expect(shouldFlipMenu('end', at(16), WIDTH, 320)).toBe(true);
  });

  it('si se sale por los dos lados, se queda en el que se sale menos', () => {
    // Pantalla más estrecha que el menú: con `start` se sale 140 px; con `end`, 160.
    expect(shouldFlipMenu('start', { left: 40, right: 140 }, 300, 200)).toBe(false);
    expect(shouldFlipMenu('end', { left: 40, right: 140 }, 300, 200)).toBe(true);
    // Igual por los dos lados: se queda el pedido.
    expect(shouldFlipMenu('end', { left: 50, right: 150 }, 300, 200)).toBe(false);
  });
});
