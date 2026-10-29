// Contrato entre la interfaz y la agenda (ver §3.3 y §7.2). Hoy lo cumple una agenda en memoria;
// en la siguiente fase, la de Dexie con las reglas de `@gameagenda/core/entries`.

export const STATUSES = ['want_to_play', 'playing', 'on_hold', 'completed', 'dropped'] as const;
export type Status = (typeof STATUSES)[number];

/** Orden de las marcas en la interfaz: Comprado, Platinado, Próximo. */
export const FLAGS = ['owned', 'platinum', 'next'] as const;
export type Flag = (typeof FLAGS)[number];
export type Flags = Readonly<Partial<Record<Flag, boolean>>>;

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

/** Fecha local `AAAA`, `AAAA-MM` o `AAAA-MM-DD`. */
export type Day = string | null;

export const DATE_FIELDS = [
  'addedAt',
  'startedAt',
  'completedAt',
  'platinumAt',
  'ownedAt',
] as const;
export type DateField = (typeof DATE_FIELDS)[number];

/** Vista derivada (ver §7.2): el estado o `next` («A continuación»). */
export type EntryView = Status | 'next';

/** Lo que la interfaz pinta de una entrada (sin HLC por campo ni lápidas). */
export interface AgendaEntry {
  /** `steam:<appid>` o `manual:<uuidv7>` (ver §7.3). */
  readonly id: string;
  readonly title: string;
  readonly status: Status;
  readonly flags: Flags;
  /** Orden manual dentro de su vista: se compara como texto. */
  readonly rank: string;
  readonly note: string;
  readonly platform: Platform | null;
  readonly addedAt: Day;
  readonly startedAt: Day;
  readonly completedAt: Day;
  readonly platinumAt: Day;
  readonly ownedAt: Day;
  /** La mayor HLC de la entrada: las filas solo se repintan si cambia. */
  readonly lastHlc: string;
}

/** Juego que se apunta: `steam:<appid>` del catálogo o un juego manual. */
export interface CaptureTarget {
  readonly id: string;
  readonly title: string;
}

export interface CaptureOptions {
  readonly status?: Status;
  readonly flags?: Flags;
}

export type MoveTarget = 'up' | 'down' | 'top' | 'bottom';
export type EditableField = 'note' | 'platform' | DateField;
export type EntryPatch = Partial<Pick<AgendaEntry, EditableField>>;

/** Qué ha cambiado, para que la interfaz escriba el aviso (ver §9.9). */
export type AgendaEffect =
  | { readonly kind: 'captured'; readonly title: string; readonly status: Status }
  | { readonly kind: 'alreadyInList'; readonly title: string; readonly status: Status }
  | {
      readonly kind: 'status';
      readonly title: string;
      readonly from: Status;
      readonly to: Status;
    }
  | {
      readonly kind: 'flag';
      readonly title: string;
      readonly flag: Flag;
      readonly value: boolean;
      /** Platinado ⇒ Completado (ver §3.3). */
      readonly autoCompleted: boolean;
    }
  | {
      readonly kind: 'moved';
      readonly title: string;
      readonly position: number;
      readonly total: number;
    }
  | { readonly kind: 'updated'; readonly title: string; readonly field: EditableField }
  | { readonly kind: 'removed'; readonly title: string }
  | { readonly kind: 'linked'; readonly title: string }
  | { readonly kind: 'noop' };

export interface AgendaResult {
  readonly effect: AgendaEffect;
  /** Deshace el cambio y sus efectos automáticos; `null` si no ha cambiado nada. */
  readonly undo: (() => void) | null;
}

/** Acciones que la paleta, Mi lista, el Catálogo y la ficha piden a la agenda. */
export interface AgendaActions {
  /** Apunta al final de su vista (Quiero jugar por defecto); nunca duplica. */
  capture(target: CaptureTarget, options?: CaptureOptions): AgendaResult;
  setStatus(id: string, status: Status): AgendaResult;
  setFlag(id: string, flag: Flag, value: boolean): AgendaResult;
  /** Orden manual dentro de la vista de la entrada (ver RF-13). */
  move(id: string, to: MoveTarget): AgendaResult;
  update(id: string, patch: EntryPatch): AgendaResult;
  /** «Quitar de mi lista»: deja una lápida (ver §7.4). */
  remove(id: string): AgendaResult;
  /** Vincula un juego manual con su juego de Steam (ver §7.3). */
  link(manualId: string, target: CaptureTarget): AgendaResult;
  /** «Borrar todos mis datos» (ya confirmado con BORRAR). */
  deleteAll(): void;
}

export interface AgendaStore extends AgendaActions {
  subscribe(listener: () => void): () => void;
  /** Entradas vivas; la referencia no cambia mientras no cambie nada. */
  getSnapshot(): readonly AgendaEntry[];
}

/** `view` de la §7.2: Próximo solo actúa en Quiero jugar y En pausa. */
export function viewOf(entry: Pick<AgendaEntry, 'status' | 'flags'>): EntryView {
  const pinnable = entry.status === 'want_to_play' || entry.status === 'on_hold';
  return entry.flags.next === true && pinnable ? 'next' : entry.status;
}

export function steamId(appid: number): string {
  return `steam:${appid}`;
}

export function appidOf(id: string): number | null {
  const match = /^steam:([1-9][0-9]{0,9})$/.exec(id);
  return match?.[1] === undefined ? null : Number(match[1]);
}
