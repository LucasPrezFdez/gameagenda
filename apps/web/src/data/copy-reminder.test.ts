import { IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { newBrowser } from '../agenda/test-support.ts';
import { createDexieCopyReminderStorage } from '../db/copy-reminder-storage.ts';
import { META_KEYS, openDatabase } from '../db/database.ts';
import { loadLocalState } from '../db/local-state.ts';
import {
  type CopyReminderState,
  copyReminderDue,
  createCopyReminderStore,
  parseCopyReminder,
  REMIND_AFTER_MS,
  SNOOZE_MS,
} from './copy-reminder.ts';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 30);
const never: CopyReminderState = { lastCopy: null, since: T0, snoozedUntil: null };

describe('aviso de copia (RNF-08)', () => {
  it('no avisa sin entradas, sin cuenta empezada ni antes de 30 días', () => {
    expect(copyReminderDue(never, T0 + 40 * DAY, false)).toBeNull();
    expect(copyReminderDue(null, T0 + 40 * DAY, true)).toBeNull();
    expect(copyReminderDue(never, T0 + REMIND_AFTER_MS - 1, true)).toBeNull();
    // Reloj hacia atrás: tampoco.
    expect(copyReminderDue(never, T0 - DAY, true)).toBeNull();
  });

  it('a los 30 días sin exportar nunca, avisa con los días desde que se cuenta', () => {
    expect(copyReminderDue(never, T0 + REMIND_AFTER_MS, true)).toEqual({
      days: 30,
      copied: false,
    });
  });

  it('exportar vuelve a contar desde la copia, y el aviso dice cuándo fue la última', () => {
    const store = createCopyReminderStore(never);
    store.copied(T0 + 10 * DAY);
    const state = store.getSnapshot();
    expect(state).toEqual({ lastCopy: T0 + 10 * DAY, since: T0, snoozedUntil: null });
    expect(copyReminderDue(state, T0 + 39 * DAY, true)).toBeNull();
    expect(copyReminderDue(state, T0 + 45 * DAY, true)).toEqual({ days: 35, copied: true });
  });

  it('«Ahora no» lo aplaza 7 días; exportar quita el aplazamiento', () => {
    const store = createCopyReminderStore(never);
    const at = T0 + 31 * DAY;
    store.snooze(at);
    expect(store.getSnapshot()?.snoozedUntil).toBe(at + SNOOZE_MS);
    expect(copyReminderDue(store.getSnapshot(), at + SNOOZE_MS - 1, true)).toBeNull();
    expect(copyReminderDue(store.getSnapshot(), at + SNOOZE_MS, true)).toEqual({
      days: 38,
      copied: false,
    });
    store.copied(at + DAY);
    expect(store.getSnapshot()?.snoozedUntil).toBeNull();
  });

  it('empieza a contar una sola vez y guarda cada cambio, salvo lo que llega de fuera', () => {
    const saved: CopyReminderState[] = [];
    const store = createCopyReminderStore(null, (state) => saved.push(state));
    let emitted = 0;
    store.subscribe(() => {
      emitted += 1;
    });
    store.snooze(T0); // sin cuenta empezada no hay nada que aplazar
    store.start(T0);
    store.start(T0 + DAY);
    expect(store.getSnapshot()).toEqual(never);
    store.replace({ ...never, lastCopy: T0 + 2 * DAY });
    store.replace(null);
    expect(saved).toEqual([never]);
    expect(emitted).toBe(3);
  });

  it('lo guardado que no tiene la forma esperada se ignora', () => {
    expect(parseCopyReminder(never)).toEqual(never);
    expect(parseCopyReminder({ lastCopy: T0, since: T0, snoozedUntil: T0 + DAY })).toEqual({
      lastCopy: T0,
      since: T0,
      snoozedUntil: T0 + DAY,
    });
    for (const bad of [
      null,
      'hace un mes',
      { since: -1, lastCopy: null, snoozedUntil: null },
      { since: T0, lastCopy: 'ayer', snoozedUntil: null },
      { since: T0, lastCopy: null },
      { since: T0 + 0.5, lastCopy: null, snoozedUntil: null },
    ]) {
      expect(parseCopyReminder(bad)).toBeNull();
    }
  });
});

describe('aviso de copia en Dexie', () => {
  it('se guarda en meta.copyReminder, se lee al arrancar y llega a otra pestaña', async () => {
    const browser = newBrowser();
    const open = () => openDatabase({ indexedDB: browser, IDBKeyRange });
    const fail = (error: unknown) => {
      throw error;
    };
    const dbA = open();
    const dbB = open();
    const storageA = createDexieCopyReminderStorage(dbA, fail);
    const storageB = createDexieCopyReminderStorage(dbB, fail);
    const a = createCopyReminderStore(null, (state) => storageA.save(state));
    const b = createCopyReminderStore(null, (state) => storageB.save(state));
    const stop = storageB.watch(b);

    a.start(T0);
    a.snooze(T0 + 31 * DAY);
    await storageA.whenIdle();
    const expected = { lastCopy: null, since: T0, snoozedUntil: T0 + 31 * DAY + SNOOZE_MS };
    expect((await dbA.meta.get(META_KEYS.copyReminder))?.value).toEqual(expected);
    await expect.poll(() => b.getSnapshot()).toEqual(expected);
    expect((await loadLocalState(dbB)).copyReminder).toEqual(expected);

    // «Borrar todos mis datos» vacía `meta`: la otra pestaña vuelve a no contar.
    await dbA.meta.clear();
    await expect.poll(() => b.getSnapshot()).toBeNull();
    stop();
    dbA.close();
    dbB.close();
  });
});
