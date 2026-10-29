// Modelo de la entrada de la agenda (§3.3 y §7.2 de prototipe.md).

/** Estados, en el orden de la §3.3. `want_to_play` es el de por defecto. */
export const STATUSES = ['want_to_play', 'playing', 'on_hold', 'completed', 'dropped'] as const;
export type Status = (typeof STATUSES)[number];
export const DEFAULT_STATUS: Status = 'want_to_play';

/** Marcas conocidas; `flags` es un registro abierto para las propias de Fase 2. */
export const KNOWN_FLAGS = ['platinum', 'owned', 'next'] as const;
export type KnownFlag = (typeof KNOWN_FLAGS)[number];
export const FLAG_NAME_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

/** «Juego en»: lista cerrada (D-05). */
export const PLATFORMS = [
  'pc',
  'steam_deck',
  'ps5',
  'ps4',
  'xbox_series',
  'xbox_one',
  'switch_2',
  'switch',
  'mobile',
  'other',
] as const;
export type Platform = (typeof PLATFORMS)[number];

/** Longitud máxima de la nota, en unidades UTF-16 (como `maxlength`). */
export const NOTE_MAX_LENGTH = 2000;

/** Fecha local `AAAA`, `AAAA-MM` o `AAAA-MM-DD`, o vacía. */
export type Day = string | null;

/** Vista de Mi lista: el estado o `'next'` («A continuación»). */
export type View = Status | 'next';

export interface Entry {
  id: string;
  status: Status;
  flags: Record<string, boolean>;
  rank: string;
  note: string;
  platform: Platform | null;
  addedAt: Day;
  startedAt: Day;
  completedAt: Day;
  platinumAt: Day;
  ownedAt: Day;
  title: string;
  cover: string | null;
  deletedAt: string | null;
  mergedInto: string | null;
  /** HLC por campo: `'status'`, `'flags.owned'`… */
  hlc: Record<string, string>;
  /** Derivado: no existe en lápidas ni esqueletos. */
  view?: View;
  /** Derivado: la mayor HLC (`''` si no hay ninguna). */
  lastHlc: string;
}

/** Entrada sin los campos derivados (`view`, `lastHlc`): lo que se exporta. */
export type EntryFields = Omit<Entry, 'view' | 'lastHlc'>;

export const DAY_FIELDS = ['addedAt', 'startedAt', 'completedAt', 'platinumAt', 'ownedAt'] as const;
export type DayField = (typeof DAY_FIELDS)[number];

/** Campos que no son marcas, tal como se escriben en `Op.field` y en `hlc`. */
export const SCALAR_FIELDS = [
  'status',
  'rank',
  'note',
  'platform',
  ...DAY_FIELDS,
  'title',
  'cover',
  'deletedAt',
  'mergedInto',
] as const;
export type ScalarField = (typeof SCALAR_FIELDS)[number];
export type FlagField = `flags.${string}`;
export type Field = ScalarField | FlagField;

const SCALAR_FIELD_SET: ReadonlySet<string> = new Set(SCALAR_FIELDS);
/** Campos de usuario (§7.3): todos salvo `title`, `cover`, `deletedAt` y `mergedInto`. */
const USER_SCALAR_FIELDS: ReadonlySet<string> = new Set([
  'status',
  'rank',
  'note',
  'platform',
  ...DAY_FIELDS,
]);
const FLAG_PREFIX = 'flags.';

export function isStatus(value: unknown): value is Status {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

export function isPlatform(value: unknown): value is Platform {
  return typeof value === 'string' && (PLATFORMS as readonly string[]).includes(value);
}

export function isFlagName(value: unknown): value is string {
  return typeof value === 'string' && FLAG_NAME_PATTERN.test(value);
}

export function flagField(name: string): FlagField {
  if (!isFlagName(name)) throw new TypeError(`flagField: nombre de marca no válido: ${name}`);
  return `flags.${name}`;
}

/** Nombre de la marca de un campo `flags.<nombre>`, o `null` si no lo es. */
export function flagNameOf(field: string): string | null {
  if (!field.startsWith(FLAG_PREFIX)) return null;
  const name = field.slice(FLAG_PREFIX.length);
  return isFlagName(name) ? name : null;
}

export function isField(field: unknown): field is Field {
  return typeof field === 'string' && (SCALAR_FIELD_SET.has(field) || flagNameOf(field) !== null);
}

export function isUserField(field: string): boolean {
  return USER_SCALAR_FIELDS.has(field) || flagNameOf(field) !== null;
}

/** Valor actual de un campo; una marca ausente vale `false`. */
export function readField(e: EntryFields, field: Field): string | boolean | null {
  const flag = flagNameOf(field);
  if (flag !== null) return e.flags[flag] ?? false;
  return e[field as ScalarField];
}

/** Escribe un campo sin comprobar el valor (lo validan Zod o las acciones). Muta `e`. */
export function writeField(e: EntryFields, field: Field, value: unknown): void {
  const flag = flagNameOf(field);
  if (flag !== null) {
    e.flags[flag] = value === true;
    return;
  }
  (e as unknown as Record<string, unknown>)[field] = value;
}

/**
 * Esqueleto: lo que crea una operación de una entrada desconocida (§7.4). Sus valores son
 * de relleno, sin HLC, y la entrada es invisible mientras le falten `status` o `title`.
 */
export function skeleton(id: string): Entry {
  return {
    id,
    status: DEFAULT_STATUS,
    flags: {},
    rank: '',
    note: '',
    platform: null,
    addedAt: null,
    startedAt: null,
    completedAt: null,
    platinumAt: null,
    ownedAt: null,
    title: '',
    cover: null,
    deletedAt: null,
    mergedInto: null,
    hlc: {},
    lastHlc: '',
  };
}

export function isSkeleton(e: EntryFields): boolean {
  return e.hlc.status === undefined || e.hlc.title === undefined;
}

/** Visible en Mi lista: ni esqueleto ni lápida. */
export function isLive(e: EntryFields | undefined): e is EntryFields {
  return e !== undefined && !isSkeleton(e) && e.deletedAt === null;
}

/**
 * `'next'` si Próximo está activo y el estado es Quiero jugar o En pausa; si no, el estado.
 * `undefined` en lápidas y esqueletos, para que IndexedDB no los indexe.
 */
export function viewOf(e: EntryFields): View | undefined {
  if (!isLive(e)) return undefined;
  if (e.flags.next === true && (e.status === 'want_to_play' || e.status === 'on_hold')) {
    return 'next';
  }
  return e.status;
}
