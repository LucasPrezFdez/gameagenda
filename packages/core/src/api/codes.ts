// Códigos de emparejamiento y de recuperación (§11.4; ADR-011): 28 símbolos de la base32 de
// Crockford (5 bits cada uno, 140 bits en total, ≥128), que se leen y se teclean sin confundir
// letras: no hay I, L, O ni U, y al leerlos O cuenta como 0 e I y L como 1. Se muestran en 7 grupos
// de 4 con guiones. core no tiene aleatorios propios: quien genera el código pasa los bytes.

export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Símbolos de un código (sin guiones). */
export const CODE_SYMBOLS = 28;
export const CODE_GROUP = 4;
/** Longitud con guiones: `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`. */
export const FORMATTED_CODE_LENGTH = CODE_SYMBOLS + CODE_SYMBOLS / CODE_GROUP - 1;

const CANONICAL_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_SYMBOLS}}$`);

/**
 * Código canónico (28 símbolos, sin guiones) a partir de 28 bytes aleatorios: cada byte da sus 5
 * bits bajos. 256 es múltiplo de 32, así que no hay sesgo.
 */
export function codeFromBytes(bytes: Uint8Array): string {
  if (bytes.length !== CODE_SYMBOLS) {
    throw new RangeError(`codeFromBytes: hacen falta ${CODE_SYMBOLS} bytes, no ${bytes.length}`);
  }
  let out = '';
  for (const b of bytes) out += CODE_ALPHABET.charAt(b & 31);
  return out;
}

export function isCanonicalCode(value: string): boolean {
  return CANONICAL_PATTERN.test(value);
}

/** `ABCD…` → `ABCD-EFGH-…`. */
export function formatCode(canonical: string): string {
  if (!isCanonicalCode(canonical)) throw new TypeError('formatCode: código no válido');
  const groups: string[] = [];
  for (let i = 0; i < canonical.length; i += CODE_GROUP) {
    groups.push(canonical.slice(i, i + CODE_GROUP));
  }
  return groups.join('-');
}

/**
 * Lo que teclea o pega el usuario → código canónico, o `null` si no lo es. Admite minúsculas,
 * espacios y guiones en cualquier sitio, y lee O como 0 e I y L como 1.
 */
export function parseCode(input: string): string | null {
  const compact = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  return isCanonicalCode(compact) ? compact : null;
}
