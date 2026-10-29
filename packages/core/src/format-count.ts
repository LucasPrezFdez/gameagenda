/** Espacio fino irrompible (U+202F): separador de millares de la interfaz. */
export const THOUSANDS_SEPARATOR = ' ';

/**
 * Formatea un entero para la interfaz: sin separador hasta 4 cifras («2000») y con
 * espacio fino irrompible a partir de 5 («196 665»).
 */
export function formatCount(n: number): string {
  if (!Number.isSafeInteger(n)) throw new RangeError(`formatCount: ${n} no es un entero seguro`);
  const digits = String(Math.abs(n));
  const sign = n < 0 ? '-' : '';
  if (digits.length < 5) return sign + digits;
  return sign + digits.replace(/\B(?=(\d{3})+$)/g, THOUSANDS_SEPARATOR);
}
