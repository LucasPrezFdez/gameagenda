// Acciones de usuario (§3.3, §9.2): funciones puras que, dada la entrada actual y una HLC,
// devuelven las operaciones a escribir (todas con esa HLC; §7.4) y la entrada resultante.

import { hlcToIso, isHlc } from '../sync/hlc.ts';
import { merge } from '../sync/merge.ts';
import { canon, type JsonValue, type NewOpId, type Op } from '../sync/op.ts';
import { isFullDate, isValidDay } from './day.ts';
import { isEntryId, isManualEntryId, steamEntryId } from './ids.ts';
import {
  DAY_FIELDS,
  type Day,
  DEFAULT_STATUS,
  type Entry,
  type Field,
  flagField,
  isField,
  isFlagName,
  isLive,
  isPlatform,
  isSkeleton,
  isStatus,
  isUserField,
  KNOWN_FLAGS,
  NOTE_MAX_LENGTH,
  type Platform,
  readField,
  type Status,
} from './model.ts';
import { keyBetween, rankBetween } from './rank.ts';

export interface ActionContext {
  /** HLC nueva de la acción (`clock.next()`): todas sus operaciones la comparten. */
  hlc: string;
  /** Fecha local de hoy, `AAAA-MM-DD`, para las fechas automáticas. */
  today: string;
  /** uuidv7 para los `opId`. */
  newOpId: NewOpId;
}

/** Lo necesario para deshacer: la entrada antes de la acción y los campos que escribió. */
export interface UndoChange {
  id: string;
  before: Entry | undefined;
  fields: readonly Field[];
}

export interface UndoStep {
  changes: readonly UndoChange[];
}

export interface ActionResult {
  /** La entrada resultante (en «Vincular», la de Steam). */
  entry: Entry;
  /** Todas las entradas que cambian (dos en «Vincular»): van a `entries`. */
  entries: Entry[];
  /** Operaciones para la `outbox`, en la misma transacción. */
  ops: Op[];
  /** Para `undo()`: se guarda en la pila de Deshacer. */
  undo: UndoStep;
}

type Values = Array<[Field, JsonValue]>;

function checkContext(ctx: ActionContext, ...entries: Array<Entry | undefined>): void {
  if (!isHlc(ctx.hlc)) throw new TypeError(`acción: HLC no válida: ${ctx.hlc}`);
  if (!isFullDate(ctx.today)) throw new TypeError(`acción: fecha de hoy no válida: ${ctx.today}`);
  for (const e of entries) {
    if (e !== undefined && ctx.hlc <= e.lastHlc) {
      // La web tiene que llamar a clock.receive() tras fusionar operaciones ajenas.
      throw new RangeError(`acción: la HLC ${ctx.hlc} no es posterior a la de ${e.id}`);
    }
  }
}

function checkNote(note: unknown): void {
  if (typeof note !== 'string') throw new TypeError('acción: la nota tiene que ser texto');
  if (note.length > NOTE_MAX_LENGTH) {
    throw new RangeError(`acción: la nota supera ${NOTE_MAX_LENGTH} caracteres`);
  }
}

function checkPlatform(platform: unknown): void {
  if (platform !== null && !isPlatform(platform)) {
    throw new TypeError(`acción: plataforma no válida: ${String(platform)}`);
  }
}

function checkDay(day: unknown): void {
  if (day !== null && !isValidDay(day)) {
    throw new TypeError(`acción: fecha no válida: ${String(day)}`);
  }
}

function checkTitle(title: unknown): void {
  if (typeof title !== 'string' || title.trim() === '') {
    throw new TypeError('acción: el título no puede estar vacío');
  }
}

function toOps(id: string, values: Values, ctx: ActionContext): Op[] {
  return values.map(([field, value]) => ({
    opId: ctx.newOpId(),
    entryId: id,
    field,
    value,
    hlc: ctx.hlc,
  }));
}

/** Escribe `values` con la HLC de la acción y fusiona; `null` si no hay nada que escribir. */
function single(
  prev: Entry | undefined,
  id: string,
  values: Values,
  ctx: ActionContext,
): ActionResult | null {
  if (values.length === 0) return null;
  const ops = toOps(id, values, ctx);
  const { entry, derived } = merge(prev, ops, ctx.newOpId);
  return {
    entry,
    entries: [entry],
    ops: [...ops, ...derived],
    undo: { changes: [{ id, before: prev, fields: values.map(([f]) => f) }] },
  };
}

/** Todos los campos de usuario de un alta, más `title` y `cover`. */
export interface NewEntryFields {
  id: string;
  title: string;
  cover: string | null;
  status: Status;
  flags: Readonly<Record<string, boolean>>;
  rank: string;
  note: string;
  platform: Platform | null;
  addedAt: Day;
  startedAt: Day;
  completedAt: Day;
  platinumAt: Day;
  ownedAt: Day;
}

function newEntryValues(prev: Entry | undefined, f: NewEntryFields): Values {
  if (!isEntryId(f.id)) throw new TypeError(`acción: id no válido: ${f.id}`);
  if (prev !== undefined && prev.id !== f.id) throw new RangeError('acción: id distinto');
  checkTitle(f.title);
  if (f.cover !== null && typeof f.cover !== 'string') throw new TypeError('acción: portada');
  if (!isStatus(f.status)) throw new TypeError(`acción: estado no válido: ${String(f.status)}`);
  checkNote(f.note);
  checkPlatform(f.platform);
  for (const d of DAY_FIELDS) checkDay(f[d]);
  keyBetween(f.rank, null); // valida la clave
  // Cada marca a false (también las propias que tuviera la lápida) salvo las indicadas.
  const flags: Record<string, boolean> = {};
  for (const name of KNOWN_FLAGS) flags[name] = false;
  for (const name of Object.keys(prev?.flags ?? {})) flags[name] = false;
  for (const [name, value] of Object.entries(f.flags)) {
    if (!isFlagName(name) || typeof value !== 'boolean') {
      throw new TypeError(`acción: marca no válida: ${name}`);
    }
    flags[name] = value;
  }
  const values: Values = [
    ['status', f.status],
    ...Object.entries(flags).map(([name, value]): [Field, JsonValue] => [flagField(name), value]),
    ['rank', f.rank],
    ['note', f.note],
    ['platform', f.platform],
    ...DAY_FIELDS.map((d): [Field, JsonValue] => [d, f[d]]),
    ['title', f.title],
    ['cover', f.cover],
    ['deletedAt', null],
  ];
  if (prev !== undefined && prev.mergedInto !== null) values.push(['mergedInto', null]);
  return values;
}

export interface AddInput {
  id: string;
  title: string;
  cover?: string | null;
  /** Por defecto, Quiero jugar. */
  status?: Status;
  /** Marcas que se activan al apuntar (las demás, a false). */
  flags?: Readonly<Record<string, boolean>>;
  platform?: Platform | null;
  note?: string;
}

export interface AddContext extends ActionContext {
  /** La mayor `rank` de Quiero jugar (`null` si está vacía): lo nuevo va al final. */
  lastRank: string | null;
}

/**
 * Apuntar (RF-02, RF-06): en Quiero jugar al final o con otro estado o marcas, con las
 * reglas de la §3.3 y la fecha de hoy. Sobre una lápida, la apunta de nuevo «desde cero»
 * (valores por defecto de todos los campos de usuario). `null` si ya está apuntada: nunca
 * se duplica.
 */
export function addEntry(
  prev: Entry | undefined,
  input: AddInput,
  ctx: AddContext,
): ActionResult | null {
  checkContext(ctx, prev);
  if (isLive(prev)) return null;
  const flags = { ...(input.flags ?? {}) };
  const platinum = flags.platinum === true;
  const status: Status = platinum ? 'completed' : (input.status ?? DEFAULT_STATUS);
  const today = ctx.today;
  const values = newEntryValues(prev, {
    id: input.id,
    title: input.title,
    cover: input.cover ?? null,
    status,
    flags,
    rank: keyBetween(ctx.lastRank, null),
    note: input.note ?? '',
    platform: input.platform ?? null,
    addedAt: today,
    startedAt: status === 'playing' ? today : null,
    completedAt: status === 'completed' ? today : null,
    platinumAt: platinum ? today : null,
    ownedAt: null,
  });
  return single(prev, input.id, values, ctx);
}

/**
 * Alta con exactamente estos valores, sin fechas automáticas ni Platinado ⇒ Completado
 * (importar CSV). `null` si ya está apuntada.
 */
export function addEntryExact(
  prev: Entry | undefined,
  fields: NewEntryFields,
  ctx: ActionContext,
): ActionResult | null {
  checkContext(ctx, prev);
  if (isLive(prev)) return null;
  return single(prev, fields.id, newEntryValues(prev, fields), ctx);
}

/** Cambiar estado: `startedAt` y `completedAt` se fijan la primera vez y no se sobrescriben. */
export function setStatus(
  prev: Entry | undefined,
  status: Status,
  ctx: ActionContext,
): ActionResult | null {
  checkContext(ctx, prev);
  if (!isStatus(status)) throw new TypeError(`setStatus: estado no válido: ${String(status)}`);
  if (!isLive(prev) || prev.status === status) return null;
  const values: Values = [['status', status]];
  if (status === 'playing' && prev.startedAt === null) values.push(['startedAt', ctx.today]);
  if (status === 'completed' && prev.completedAt === null) values.push(['completedAt', ctx.today]);
  return single(prev, prev.id, values, ctx);
}

/**
 * Activar o quitar una marca. Marcar Platinado escribe siempre `status = 'completed'` con la
 * misma HLC (aunque ya lo fuera), fija `completedAt` si estaba vacía y `platinumAt`; quitarlo
 * vacía `platinumAt` y no cambia el estado.
 */
export function setFlag(
  prev: Entry | undefined,
  flag: string,
  value: boolean,
  ctx: ActionContext,
): ActionResult | null {
  checkContext(ctx, prev);
  if (!isFlagName(flag)) throw new TypeError(`setFlag: marca no válida: ${flag}`);
  if (!isLive(prev) || (prev.flags[flag] ?? false) === value) return null;
  const values: Values = [[flagField(flag), value]];
  if (flag === 'platinum') {
    if (value) {
      values.push(['status', 'completed']);
      if (prev.completedAt === null) values.push(['completedAt', ctx.today]);
      values.push(['platinumAt', ctx.today]);
    } else if (prev.platinumAt !== null) {
      values.push(['platinumAt', null]);
    }
  }
  return single(prev, prev.id, values, ctx);
}

/** Alternar una marca (acción de un toque). */
export function toggleFlag(
  prev: Entry | undefined,
  flag: string,
  ctx: ActionContext,
): ActionResult | null {
  return setFlag(prev, flag, !(prev?.flags[flag] ?? false), ctx);
}

export interface EntryPatch {
  note?: string;
  platform?: Platform | null;
  addedAt?: Day;
  startedAt?: Day;
  completedAt?: Day;
  platinumAt?: Day;
  ownedAt?: Day;
}

const PATCH_FIELDS = ['note', 'platform', ...DAY_FIELDS] as const;

/** Editar en la ficha la nota, «Juego en» y las fechas (RF-21). Solo escribe lo que cambia. */
export function editEntry(
  prev: Entry | undefined,
  patch: EntryPatch,
  ctx: ActionContext,
): ActionResult | null {
  checkContext(ctx, prev);
  if (patch.note !== undefined) checkNote(patch.note);
  if (patch.platform !== undefined) checkPlatform(patch.platform);
  for (const d of DAY_FIELDS) if (patch[d] !== undefined) checkDay(patch[d]);
  if (!isLive(prev)) return null;
  const values: Values = [];
  for (const field of PATCH_FIELDS) {
    const value = patch[field];
    if (value !== undefined && value !== prev[field]) values.push([field, value]);
  }
  return single(prev, prev.id, values, ctx);
}

/**
 * Mover en el orden manual: `above` y `below` son las `rank` de los vecinos de destino
 * (ver `moveNeighbors`); la clave nueva cae entre ellos, sin renumerar.
 */
export function moveEntry(
  prev: Entry | undefined,
  above: string | null,
  below: string | null,
  ctx: ActionContext,
): ActionResult | null {
  checkContext(ctx, prev);
  if (!isLive(prev)) return null;
  const rank = rankBetween(above, below);
  if (rank === prev.rank) return null;
  return single(prev, prev.id, [['rank', rank]], ctx);
}

/** «Quitar de mi lista»: lápida con el instante de la HLC; conserva el resto. */
export function removeEntry(prev: Entry | undefined, ctx: ActionContext): ActionResult | null {
  checkContext(ctx, prev);
  if (!isLive(prev)) return null;
  return single(prev, prev.id, [['deletedAt', hlcToIso(ctx.hlc)]], ctx);
}

/** Copia del catálogo (título y portada) para pintar sin él. */
export interface CatalogCopy {
  title: string;
  cover: string | null;
}

/**
 * Actualiza `title` y `cover` desde el catálogo: resuelve un juego provisional (sin cambiar
 * de id) o recoge un cambio de nombre.
 */
export function refreshCatalogCopy(
  prev: Entry | undefined,
  catalog: CatalogCopy,
  ctx: ActionContext,
): ActionResult | null {
  checkContext(ctx, prev);
  checkTitle(catalog.title);
  if (!isLive(prev)) return null;
  const values: Values = [];
  if (prev.title !== catalog.title) values.push(['title', catalog.title]);
  if (prev.cover !== catalog.cover) values.push(['cover', catalog.cover]);
  return single(prev, prev.id, values, ctx);
}

/**
 * Alta de un juego provisional (RF-04): `steam:<appid>` con el título del *slug* o, si no lo
 * hay, el que dé la web (p. ej. «Juego de Steam 730»). Se pasa a `addEntry`.
 */
export function provisionalInput(
  link: { appid: number; title: string | null },
  fallbackTitle: (appid: number) => string,
): AddInput {
  return {
    id: steamEntryId(link.appid),
    title: link.title ?? fallbackTitle(link.appid),
    cover: null,
  };
}

/**
 * «Vincular» solo se propone ante una única coincidencia exacta tras normalizar (§7.3):
 * recibe los `appid` de `matchExact` y devuelve el único, o `null`.
 */
export function linkCandidate(appids: readonly number[]): number | null {
  const unique = new Set(appids);
  if (unique.size !== 1) return null;
  const [appid] = unique;
  return appid ?? null;
}

const NOTE_SEPARATOR = '\n\n';

/** Concatena dos notas sin pasar del máximo ni partir un par sustituto. */
function joinNotes(a: string, b: string): string {
  let joined = `${a}${NOTE_SEPARATOR}${b}`;
  if (joined.length <= NOTE_MAX_LENGTH) return joined;
  joined = joined.slice(0, NOTE_MAX_LENGTH);
  const last = joined.charCodeAt(joined.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? joined.slice(0, -1) : joined;
}

function sameOp(a: Op, b: Op): boolean {
  return (
    a.entryId === b.entryId &&
    a.field === b.field &&
    a.hlc === b.hlc &&
    canon(a.value) === canon(b.value)
  );
}

/**
 * Vincular el manual M con T = `steam:<appid>` (§7.3). T recibe los campos de usuario de M
 * con su valor y su HLC originales (LWW decide campo a campo) y, con la HLC de la acción,
 * `deletedAt = null`, `title` y `cover` del catálogo y, si ambas notas tienen texto (y no son
 * iguales), su concatenación (la de T primero). M recibe `deletedAt` y `mergedInto = T`.
 * `target` es la entrada actual de T, si existe (también lápida o esqueleto).
 */
export function linkManual(
  manual: Entry | undefined,
  target: Entry | undefined,
  appid: number,
  catalog: CatalogCopy,
  ctx: ActionContext,
): ActionResult | null {
  const targetId = steamEntryId(appid);
  checkContext(ctx, manual, target);
  checkTitle(catalog.title);
  if (target !== undefined && target.id !== targetId) {
    throw new RangeError(`linkManual: la entrada de destino no es ${targetId}`);
  }
  if (!isLive(manual) || !isManualEntryId(manual.id)) return null;

  const copied: Op[] = [];
  for (const [field, hlc] of Object.entries(manual.hlc)) {
    if (!isField(field) || !isUserField(field)) continue;
    copied.push({
      opId: ctx.newOpId(),
      entryId: targetId,
      field,
      value: readField(manual, field),
      hlc,
    });
  }
  const own: Values = [
    ['deletedAt', null],
    ['title', catalog.title],
    ['cover', catalog.cover],
  ];
  const targetNote = target?.note ?? '';
  if (targetNote !== '' && manual.note !== '' && targetNote !== manual.note) {
    own.push(['note', joinNotes(targetNote, manual.note)]);
  }
  const ownOps = toOps(targetId, own, ctx);
  const t = merge(target, [...copied, ...ownOps], ctx.newOpId);

  const manualOps = toOps(
    manual.id,
    [
      ['deletedAt', hlcToIso(ctx.hlc)],
      ['mergedInto', targetId],
    ],
    ctx,
  );
  const m = merge(manual, manualOps, ctx.newOpId);
  // El reenvío de M repite lo ya copiado; si quedara algo, se aplica también a T.
  const extra = m.derived.filter((d) => !copied.some((c) => sameOp(c, d)));
  const extraForTarget = extra.filter((d) => d.entryId === targetId);
  const finalTarget =
    extraForTarget.length > 0 ? merge(t.entry, extraForTarget, ctx.newOpId) : undefined;

  return {
    entry: finalTarget?.entry ?? t.entry,
    entries: [finalTarget?.entry ?? t.entry, m.entry],
    ops: [
      ...copied,
      ...ownOps,
      ...t.derived,
      ...manualOps,
      ...extra,
      ...(finalTarget?.derived ?? []),
    ],
    undo: {
      changes: [
        {
          id: targetId,
          before: target,
          fields: [...copied, ...ownOps].map((o) => o.field as Field),
        },
        { id: manual.id, before: manual, fields: ['deletedAt', 'mergedInto'] },
      ],
    },
  };
}

/** Valores que devuelven una entrada a su estado anterior. */
function undoValues(change: UndoChange, cur: Entry | undefined, ctx: ActionContext): Values {
  const { before } = change;
  if (before === undefined || isSkeleton(before)) {
    // No estaba apuntada: deshacer el alta la quita.
    return isLive(cur) ? [['deletedAt', hlcToIso(ctx.hlc)]] : [];
  }
  const values: Values = [];
  for (const field of new Set(change.fields)) {
    const value = readField(before, field);
    if (cur === undefined || canon(readField(cur, field)) !== canon(value)) {
      values.push([field, value]);
    }
  }
  // Reescribir Platinado sin el estado lo haría pasar a Completado por relojes.
  const remarks = values.some(([f, v]) => f === 'flags.platinum' && v === true);
  if (remarks && !values.some(([f]) => f === 'status')) values.push(['status', before.status]);
  return values;
}

/**
 * Deshacer (RF-10): otra acción, con su propia HLC, que restaura el estado exacto anterior
 * (con sus efectos automáticos: fechas y Completado por Platinado). Deshacer un «Quitar»
 * solo escribe `deletedAt = null`; deshacer un alta deja una lápida. `current` da la entrada
 * actual de cada id de `step.changes`. Su `undo` sirve para rehacer.
 */
export function undo(
  step: UndoStep,
  current: (id: string) => Entry | undefined,
  ctx: ActionContext,
): ActionResult | null {
  checkContext(ctx, ...step.changes.map((c) => current(c.id)));
  const entries: Entry[] = [];
  const ops: Op[] = [];
  const changes: UndoChange[] = [];
  for (const change of step.changes) {
    const cur = current(change.id);
    const result = single(cur, change.id, undoValues(change, cur, ctx), ctx);
    if (result === null) continue;
    entries.push(result.entry);
    ops.push(...result.ops);
    changes.push(...result.undo.changes);
  }
  const [entry] = entries;
  if (entry === undefined) return null;
  return { entry, entries, ops, undo: { changes } };
}
