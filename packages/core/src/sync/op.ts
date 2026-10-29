// Operación de la `outbox` (§7.4): `{ opId, entryId, field, value, hlc }`.

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface Op {
  /** uuidv7. */
  opId: string;
  entryId: string;
  /** `'status'`, `'rank'`, `'flags.owned'`… (ver `Field` en entries). */
  field: string;
  value: JsonValue;
  hlc: string;
}

/** Generador de `opId` (uuidv7): core no tiene aleatorios propios. */
export type NewOpId = () => string;

/** JSON canónico (claves ordenadas) para desempatar dos valores con la misma HLC. */
export function canon(value: unknown): string {
  if (value === undefined) return '';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canon(obj[k])}`).join(',')}}`;
}

/** ¿Gana `a` a `b` por LWW? Mayor HLC y, a igual HLC, mayor `canon(value)`. */
export function beats(
  a: { hlc: string; value: unknown },
  b: { hlc: string; value: unknown } | undefined,
): boolean {
  if (b === undefined) return true;
  return a.hlc > b.hlc || (a.hlc === b.hlc && canon(a.value) > canon(b.value));
}
