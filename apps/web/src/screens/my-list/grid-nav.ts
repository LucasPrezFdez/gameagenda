// ↑ y ↓ en la cuadrícula de Mi lista (DECISIONES §10.53). Las tarjetas van por secciones, cada una
// con sus filas; ← y → (y `J` y `K`) siguen el orden de la lista, así que solo ↑ y ↓ necesitan
// saber dónde cae cada tarjeta. Como en un explorador de ficheros: ↓ baja a la misma columna de la
// fila siguiente o, si esa fila es más corta, a su última tarjeta; desde la última fila de una
// sección, pasa a la primera fila de la siguiente. ↑, al revés.

/**
 * La tarjeta a la que va ↑ (`-1`) o ↓ (`1`) desde `index`, contando las tarjetas a la vista de
 * todas las secciones seguidas. `lengths`: las tarjetas a la vista de cada sección, en orden (una
 * sección plegada cuenta 0). Si no hay adónde ir, la misma.
 */
export function gridStep(
  lengths: readonly number[],
  columns: number,
  index: number,
  direction: 1 | -1,
): number {
  const perRow = Math.max(1, columns);
  let start = 0;
  let section = -1;
  for (const [position, length] of lengths.entries()) {
    if (index < start + length) {
      section = position;
      break;
    }
    start += length;
  }
  const length = lengths[section];
  if (section < 0 || length === undefined) return index;
  const offset = index - start;
  const row = Math.floor(offset / perRow);
  const column = offset % perRow;
  const lastRow = Math.floor((length - 1) / perRow);

  if (direction === 1) {
    if (row < lastRow) return start + Math.min(length - 1, (row + 1) * perRow + column);
    // La primera fila de la siguiente sección con tarjetas.
    let next = start + length;
    for (let position = section + 1; position < lengths.length; position += 1) {
      const size = lengths[position] ?? 0;
      if (size > 0) return next + Math.min(size - 1, column);
      next += size;
    }
    return index;
  }

  if (row > 0) return start + (row - 1) * perRow + column;
  // La última fila de la anterior sección con tarjetas.
  let end = start;
  for (let position = section - 1; position >= 0; position -= 1) {
    const size = lengths[position] ?? 0;
    end -= size;
    if (size > 0) {
      const last = Math.floor((size - 1) / perRow) * perRow;
      return end + Math.min(size - 1, last + column);
    }
  }
  return index;
}
