import { encode } from 'uqr';
import { describe, expect, it } from 'vitest';
import { pairingUrl } from '../../router/routes.ts';
import { QUIET_ZONE, qrDrawing } from './qr.ts';

const CODE = 'GXEN-Q32V-ABCD-EFGH-JKMN-PQRS-TVWX';
const URL_TEXT = pairingUrl('https://ga-web.gameagenda.workers.dev', CODE);

/** Las celdas oscuras que pinta el trazado, como `"x,y"`. */
function cellsOf(path: string): Set<string> {
  const cells = new Set<string>();
  for (const [, x, y, w] of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let i = 0; i < Number(w); i++) cells.add(`${Number(x) + i},${y}`);
  }
  return cells;
}

/** Los 15 bits de formato de la primera copia (alrededor del patrón de arriba a la izquierda). */
function formatBits(data: boolean[][]): number {
  const at = (x: number, y: number) => (data[y]?.[x] ? 1 : 0);
  const bits: number[] = [];
  for (let i = 0; i <= 5; i++) bits.push(at(8, i));
  bits.push(at(8, 7), at(8, 8), at(7, 8));
  for (let i = 9; i < 15; i++) bits.push(at(14 - i, 8));
  return bits.reduce((acc, bit, i) => acc | (bit << i), 0);
}

function finderAt(data: boolean[][], left: number, top: number): boolean {
  for (let dy = 0; dy < 7; dy++) {
    for (let dx = 0; dx < 7; dx++) {
      const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
      // Anillo exterior oscuro, luego claro y el centro de 3 × 3 oscuro.
      if (Boolean(data[top + dy]?.[left + dx]) !== (ring !== 2)) return false;
    }
  }
  return true;
}

describe('qrDrawing (M4)', () => {
  it('el enlace de producción cabe en la versión 5 (37 × 37) con corrección M', () => {
    const drawing = qrDrawing(URL_TEXT);
    expect(URL_TEXT).toHaveLength(82);
    expect(drawing.size).toBe(37);
    expect(drawing.viewBox).toBe(`-${QUIET_ZONE} -${QUIET_ZONE} 45 45`);
    expect(drawing).toMatchObject({ offset: -QUIET_ZONE, side: 37 + 2 * QUIET_ZONE });
  });

  it('el trazado pinta exactamente los módulos oscuros de la matriz', () => {
    const drawing = qrDrawing(URL_TEXT);
    const { data, size } = encode(URL_TEXT, { ecc: 'M', border: 0 });
    const expected = new Set<string>();
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) if (data[y]?.[x]) expected.add(`${x},${y}`);
    }
    expect(cellsOf(drawing.path)).toEqual(expected);
  });

  it('la matriz tiene los tres patrones de posición y las líneas de sincronismo', () => {
    const { data, size } = encode(URL_TEXT, { ecc: 'M', border: 0 });
    expect(finderAt(data, 0, 0)).toBe(true);
    expect(finderAt(data, size - 7, 0)).toBe(true);
    expect(finderAt(data, 0, size - 7)).toBe(true);
    for (let i = 8; i < size - 8; i++) {
      expect(data[6]?.[i]).toBe(i % 2 === 0);
      expect(data[i]?.[6]).toBe(i % 2 === 0);
    }
  });

  it('los bits de formato dicen corrección M y son un código BCH(15,5) válido', () => {
    const { data } = encode(URL_TEXT, { ecc: 'M', border: 0 });
    const raw = formatBits(data) ^ 0x5412;
    const payload = raw >>> 10;
    // M es 00 en los dos bits de nivel (L 01, Q 11, H 10).
    expect(payload >>> 3).toBe(0);
    let rem = payload;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    expect(((payload << 10) | (rem & 0x3ff)) >>> 0).toBe(raw);
  });

  it('es determinista y distinto para cada código', () => {
    expect(qrDrawing(URL_TEXT).path).toBe(qrDrawing(URL_TEXT).path);
    const other = pairingUrl('https://ga-web.gameagenda.workers.dev', CODE.replace('G', 'H'));
    expect(qrDrawing(other).path).not.toBe(qrDrawing(URL_TEXT).path);
  });
});
