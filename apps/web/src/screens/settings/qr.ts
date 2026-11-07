// QR de «Emparejar otro dispositivo» (M4; §11.4): el enlace `<origen>/emparejar#<código>` como un
// trazado SVG. Codifica `uqr` 0.1.3 (MIT, sin dependencias; un port del generador de Nayuki) y
// aquí solo se convierte la matriz en un `<path>`, sin `innerHTML`. Va en su propio *chunk*: se
// descarga al pedir un código, no al abrir Ajustes.
import { encode } from 'uqr';

/** Módulos claros alrededor (la «zona tranquila» que pide la norma ISO/IEC 18004). */
export const QUIET_ZONE = 4;

export interface QrDrawing {
  /** Módulos por lado, sin la zona tranquila. */
  readonly size: number;
  /** Esquina y lado del fondo claro, con la zona tranquila: `-4` y `size + 8`. */
  readonly offset: number;
  readonly side: number;
  /** `viewBox` con la zona tranquila: `-4 -4 (size + 8) (size + 8)`. */
  readonly viewBox: string;
  /** Los módulos oscuros, como rectángulos de una fila de alto. */
  readonly path: string;
}

/**
 * Corrección de errores M (hasta un 15 % de daño): el enlace de producción (≈82 bytes) cabe en la
 * versión 5, de 37 × 37 módulos, que una cámara lee bien a unos 4 px por módulo.
 */
export function qrDrawing(text: string): QrDrawing {
  const { size, data } = encode(text, { ecc: 'M', border: 0 });
  let path = '';
  for (let y = 0; y < size; y++) {
    const row = data[y] ?? [];
    let x = 0;
    while (x < size) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < size && row[x]) x += 1;
      path += `M${start} ${y}h${x - start}v1h${start - x}z`;
    }
  }
  const side = size + 2 * QUIET_ZONE;
  const offset = -QUIET_ZONE;
  return { size, offset, side, viewBox: `${offset} ${offset} ${side} ${side}`, path };
}
