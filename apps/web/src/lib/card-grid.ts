// Cuadrículas de portadas: la del Catálogo (DECISIONES §10.45) y la de Mi lista (§10.53). Cuántas
// columnas caben y cuánto mide cada tarjeta. Sale del ancho en JavaScript, y no de `auto-fill` en
// CSS, porque la virtualización y las flechas necesitan saber cuántas tarjetas hay por fila.

/** Ancho mínimo de la tarjeta y hueco entre tarjetas, en px. */
export const CARD_MIN = 160;
export const CARD_GAP = 12;
/**
 * Con la columna llena (§10.53), a 2 560 px caben 14; el tope solo evita tarjetas diminutas si
 * alguien estira la ventana sobre dos monitores.
 */
export const MAX_COLUMNS = 16;

/** Columnas que caben en `width` px, entre `minColumns` y `MAX_COLUMNS`. */
export function gridColumns(width: number, minColumns: number): number {
  if (!(width > 0)) return minColumns;
  const fit = Math.floor((width + CARD_GAP) / (CARD_MIN + CARD_GAP));
  return Math.max(minColumns, Math.min(MAX_COLUMNS, fit));
}

/** Ancho de cada tarjeta, todas iguales, con `CARD_GAP` entre ellas. */
export function cardWidth(width: number, columns: number): number {
  return Math.max(0, Math.floor((width - CARD_GAP * (columns - 1)) / columns));
}
