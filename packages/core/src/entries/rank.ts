// `rank`: clave fraccionaria en base 62 que ordena como texto (§7.2). Algoritmo de David
// Greenspan («Implementing Fractional Indexing»), como en `fractional-indexing` (CC0).

/** Dígitos en orden ASCII: así la clave se compara como texto, también en IndexedDB. */
export const BASE62_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ZERO = '0';
const LAST = 'z';
/** El menor entero no se usa como clave: así siempre cabe otra delante. */
const SMALLEST_INTEGER = `A${ZERO.repeat(26)}`;
const KEY_CHARS = /^[0-9A-Za-z]+$/;

function digitAt(s: string, i: number): number {
  return BASE62_DIGITS.indexOf(s.charAt(i));
}

function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new RangeError(`rank: ${a} >= ${b}`);
  if (a.endsWith(ZERO) || b?.endsWith(ZERO)) throw new RangeError('rank: cero final');
  if (b !== null) {
    // Quita el prefijo común (rellenando `a` con ceros).
    let n = 0;
    while ((a.charAt(n) || ZERO) === b.charAt(n)) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? digitAt(a, 0) : 0;
  const digitB = b !== null ? digitAt(b, 0) : BASE62_DIGITS.length;
  if (digitB - digitA > 1) return BASE62_DIGITS.charAt(Math.round(0.5 * (digitA + digitB)));
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return BASE62_DIGITS.charAt(digitA) + midpoint(a.slice(1), null);
}

function integerLength(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2;
  if (head >= 'A' && head <= 'Z') return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2;
  throw new RangeError(`rank: cabecera no válida: ${head}`);
}

function integerPart(key: string): string {
  const length = integerLength(key.charAt(0));
  if (length > key.length) throw new RangeError(`rank: clave no válida: ${key}`);
  return key.slice(0, length);
}

function validateKey(key: string): void {
  if (!KEY_CHARS.test(key) || key === SMALLEST_INTEGER) {
    throw new RangeError(`rank: clave no válida: ${key}`);
  }
  const int = integerPart(key);
  if (key.slice(int.length).endsWith(ZERO)) throw new RangeError(`rank: clave no válida: ${key}`);
}

function incrementInteger(x: string): string | null {
  const head = x.charAt(0);
  const digits = x.slice(1).split('');
  let carry = true;
  for (let i = digits.length - 1; carry && i >= 0; i--) {
    const d = digitAt(x, i + 1) + 1;
    if (d === BASE62_DIGITS.length) {
      digits[i] = ZERO;
    } else {
      digits[i] = BASE62_DIGITS.charAt(d);
      carry = false;
    }
  }
  if (!carry) return head + digits.join('');
  if (head === 'Z') return `a${ZERO}`;
  if (head === 'z') return null;
  const h = String.fromCharCode(head.charCodeAt(0) + 1);
  if (h > 'a') digits.push(ZERO);
  else digits.pop();
  return h + digits.join('');
}

function decrementInteger(x: string): string | null {
  const head = x.charAt(0);
  const digits = x.slice(1).split('');
  let borrow = true;
  for (let i = digits.length - 1; borrow && i >= 0; i--) {
    const d = digitAt(x, i + 1) - 1;
    if (d === -1) {
      digits[i] = LAST;
    } else {
      digits[i] = BASE62_DIGITS.charAt(d);
      borrow = false;
    }
  }
  if (!borrow) return head + digits.join('');
  if (head === 'a') return `Z${LAST}`;
  if (head === 'A') return null;
  const h = String.fromCharCode(head.charCodeAt(0) - 1);
  if (h < 'Z') digits.push(LAST);
  else digits.pop();
  return h + digits.join('');
}

export function isRankKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    validateKey(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clave estrictamente entre `a` y `b` (`null` = sin límite). `keyBetween(último, null)` pone
 * lo nuevo al final y `keyBetween(null, primero)`, al principio.
 */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null) validateKey(a);
  if (b !== null) validateKey(b);
  if (a !== null && b !== null && a >= b) throw new RangeError(`rank: ${a} >= ${b}`);
  if (a === null) {
    if (b === null) return `a${ZERO}`;
    const ib = integerPart(b);
    const fb = b.slice(ib.length);
    if (ib === SMALLEST_INTEGER) return ib + midpoint('', fb);
    if (ib < b) return ib;
    const res = decrementInteger(ib);
    if (res === null) throw new RangeError('rank: no se puede decrementar más');
    return res;
  }
  const ia = integerPart(a);
  const fa = a.slice(ia.length);
  if (b === null) {
    const i = incrementInteger(ia);
    return i === null ? ia + midpoint(fa, null) : i;
  }
  const ib = integerPart(b);
  const fb = b.slice(ib.length);
  if (ia === ib) return ia + midpoint(fa, fb);
  const i = incrementInteger(ia);
  if (i === null) throw new RangeError('rank: no se puede incrementar más');
  if (i < b) return i;
  return ia + midpoint(fa, null);
}

/**
 * Clave para colocar una entrada entre `above` (la de encima, menor) y `below` (la de
 * debajo, mayor). Si los dos vecinos empatan (altas simultáneas en dos dispositivos), no
 * cabe ninguna clave entre ellos: devuelve la misma y el orden lo decide el `id`.
 */
export function rankBetween(above: string | null, below: string | null): string {
  if (above !== null && above === below) {
    validateKey(above);
    return above;
  }
  return keyBetween(above, below);
}

/**
 * Vecinos de destino al mover el elemento `from` a la posición `to` de una lista ordenada por
 * `rank` (subir: `to = from - 1`; bajar: `from + 1`; al principio: 0; al final: `length - 1`).
 */
export function moveNeighbors(
  ranks: readonly string[],
  from: number,
  to: number,
): { above: string | null; below: string | null } {
  if (!Number.isInteger(from) || from < 0 || from >= ranks.length) {
    throw new RangeError(`moveNeighbors: origen fuera de rango: ${from}`);
  }
  if (!Number.isInteger(to) || to < 0 || to >= ranks.length) {
    throw new RangeError(`moveNeighbors: destino fuera de rango: ${to}`);
  }
  const rest = ranks.filter((_, i) => i !== from);
  return { above: rest[to - 1] ?? null, below: rest[to] ?? null };
}
