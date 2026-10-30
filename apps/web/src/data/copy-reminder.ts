// Aviso para exportar tras 30 días sin copia (RNF-08, §9.6). Cuenta desde la última exportación
// (JSON o CSV) o, si nunca se ha exportado, desde que hubo algo en Mi lista; «Ahora no» lo aplaza
// 7 días. Es de este dispositivo: vive en `meta.copyReminder` y no va en la copia. En M4 contará
// también la sincronización.

const DAY_MS = 86_400_000;
export const REMIND_AFTER_MS = 30 * DAY_MS;
export const SNOOZE_MS = 7 * DAY_MS;

export interface CopyReminderState {
  /** Última exportación (ms desde 1970), o `null` si nunca se ha exportado. */
  readonly lastCopy: number | null;
  /** Desde cuándo se cuenta si nunca se ha exportado: la primera vez que hubo entradas. */
  readonly since: number;
  /** Tras «Ahora no», no se avisa hasta este momento. */
  readonly snoozedUntil: number | null;
}

export interface CopyReminderDue {
  /** Días enteros desde la última copia (o desde que se cuenta). */
  readonly days: number;
  /** Si alguna vez se ha exportado. */
  readonly copied: boolean;
}

const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** `meta.copyReminder` solo si tiene la forma esperada; si no, se vuelve a contar desde ahora. */
export function parseCopyReminder(value: unknown): CopyReminderState | null {
  if (typeof value !== 'object' || value === null) return null;
  const { lastCopy, since, snoozedUntil } = value as Record<string, unknown>;
  const timeOrNull = (v: unknown) => (v === null ? null : isTime(v) ? v : undefined);
  const last = timeOrNull(lastCopy);
  const snoozed = timeOrNull(snoozedUntil);
  if (!isTime(since) || last === undefined || snoozed === undefined) return null;
  return { lastCopy: last, since, snoozedUntil: snoozed };
}

/** El aviso, si toca: hay entradas, pasaron 30 días desde la última copia y no está aplazado. */
export function copyReminderDue(
  state: CopyReminderState | null,
  now: number,
  hasEntries: boolean,
): CopyReminderDue | null {
  if (!hasEntries || state === null) return null;
  const from = state.lastCopy ?? state.since;
  if (now - from < REMIND_AFTER_MS) return null;
  if (state.snoozedUntil !== null && now < state.snoozedUntil) return null;
  return { days: Math.floor((now - from) / DAY_MS), copied: state.lastCopy !== null };
}

export interface CopyReminderStore {
  getSnapshot(): CopyReminderState | null;
  subscribe(listener: () => void): () => void;
  /** Empieza a contar si aún no se cuenta (al haber entradas por primera vez). */
  start(now: number): void;
  /** Se acaba de exportar una copia. */
  copied(now: number): void;
  /** «Ahora no». */
  snooze(now: number): void;
  /** Lo guardado por otra pestaña, o `null` tras «Borrar todos mis datos». No se guarda. */
  replace(state: CopyReminderState | null): void;
}

export function createCopyReminderStore(
  initial: CopyReminderState | null,
  save: (state: CopyReminderState) => void = () => undefined,
): CopyReminderStore {
  let state = initial;
  const listeners = new Set<() => void>();

  function set(next: CopyReminderState | null, persist: boolean): void {
    state = next;
    if (persist && next !== null) save(next);
    for (const listener of listeners) listener();
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start(now) {
      if (state === null) set({ lastCopy: null, since: now, snoozedUntil: null }, true);
    },
    copied(now) {
      set({ lastCopy: now, since: state?.since ?? now, snoozedUntil: null }, true);
    },
    snooze(now) {
      if (state !== null) set({ ...state, snoozedUntil: now + SNOOZE_MS }, true);
    },
    replace(next) {
      set(next, false);
    },
  };
}
