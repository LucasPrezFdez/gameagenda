import { manualEntryId } from '@gameagenda/core/entries';
import { createHlcClock } from '@gameagenda/core/sync';
import { v7 as uuidv7 } from 'uuid';
import { afterEach, describe, expect, it } from 'vitest';
import { createDexieAgendaStorage } from '../db/agenda-storage.ts';
import { META_KEYS } from '../db/database.ts';
import { createAgenda } from './agenda.ts';
import { byId, newBrowser, openTab, type TestTab, TODAY, values } from './test-support.ts';
import { compareRank } from './types.ts';

const open: TestTab[] = [];
async function tab(browser = newBrowser()) {
  const t = await openTab(browser);
  open.push(t);
  return t;
}

afterEach(async () => {
  for (const t of open.splice(0)) await t.close();
});

function ordered(t: TestTab): string[] {
  return [...t.agenda.getSnapshot()].sort(compareRank).map((entry) => entry.id);
}

describe('agenda sobre Dexie', () => {
  it('responde al instante: pinta desde memoria y guarda después', async () => {
    const t = await tab();
    const result = t.agenda.capture({ id: 'steam:1145350', title: 'Hades II' });
    // Síncrono: la interfaz no espera a IndexedDB.
    expect(result.effect).toEqual({
      kind: 'captured',
      title: 'Hades II',
      status: 'want_to_play',
      provisional: false,
    });
    expect(t.agenda.getSnapshot().map((e) => e.id)).toEqual(['steam:1145350']);
    expect(await t.db.entries.count()).toBe(0);

    await t.agenda.whenIdle();
    const stored = await t.db.entries.get('steam:1145350');
    expect(stored).toEqual(t.agenda.get('steam:1145350'));
    const ops = await t.db.outbox.toArray();
    expect(ops.length).toBeGreaterThan(0);
    expect(new Set(ops.map((op) => op.hlc))).toEqual(new Set([stored?.lastHlc]));
    expect((await t.db.meta.get(META_KEYS.hlcClock))?.value).toMatchObject({ offset: 0 });
  });

  it('persiste tras reabrir: mismas entradas, mismas HLC y el reloj sigue por delante', async () => {
    const browser = newBrowser();
    const first = await openTab(browser);
    const { agenda } = first;
    agenda.capture({ id: 'steam:1', title: 'Uno' });
    agenda.capture({ id: 'steam:2', title: 'Dos' });
    agenda.capture({ id: 'steam:3', title: 'Tres' });
    expect(agenda.move('steam:3', 'top').effect).toMatchObject({ position: 1, total: 3 });
    agenda.setStatus('steam:1', 'playing');
    agenda.setFlag('steam:2', 'platinum', true);
    agenda.update('steam:3', { note: 'Con amigos', platform: 'steam_deck' });
    agenda.remove('steam:2');
    const before = byId(agenda.allEntries());
    await first.close();

    const second = await tab(browser);
    expect(byId(second.agenda.allEntries())).toEqual(before);
    expect(second.agenda.getSnapshot().map((e) => [e.id, second.agenda.get(e.id)?.view])).toEqual([
      ['steam:1', 'playing'],
      ['steam:3', 'want_to_play'],
    ]);
    // «Al principio» dejó a Tres delante de Dos (que sigue como lápida, con su `rank`).
    const rank = (id: string) => second.agenda.get(id)?.rank ?? '';
    expect(rank('steam:3') < rank('steam:2')).toBe(true);
    // Una acción nueva tiene una HLC posterior a todo lo guardado.
    second.agenda.setStatus('steam:3', 'on_hold');
    const lastHlc = second.agenda.get('steam:3')?.lastHlc ?? '';
    expect(before.every((entry) => entry.lastHlc < lastHlc)).toBe(true);
  });

  it('Deshacer devuelve el estado exacto, también tras guardar y reabrir', async () => {
    const browser = newBrowser();
    const t = await openTab(browser);
    const { agenda } = t;
    agenda.capture({ id: 'steam:1', title: 'Hades' });
    agenda.capture({ id: 'steam:2', title: 'Celeste' });
    const steps: Array<() => ReturnType<typeof agenda.setStatus>> = [
      () => agenda.setStatus('steam:1', 'playing'),
      () => agenda.setFlag('steam:1', 'platinum', true),
      () => agenda.setFlag('steam:2', 'owned', true),
      () => agenda.setFlag('steam:2', 'next', true),
      () => agenda.update('steam:1', { note: 'Nota', completedAt: '2019' }),
      () => agenda.move('steam:2', 'top'),
      () => agenda.remove('steam:1'),
      () => agenda.capture({ id: 'steam:3', title: 'Terraria' }, { flags: { platinum: true } }),
    ];
    for (const step of steps) {
      const snapshot = agenda.allEntries().map(values);
      const result = step();
      expect(result.undo).not.toBeNull();
      result.undo?.();
      // Lo que se ve (estado, marcas, fechas, orden…) vuelve a ser exactamente lo de antes.
      const now = new Map(agenda.allEntries().map((e) => [e.id, values(e)]));
      for (const entry of snapshot) {
        if (entry === undefined) continue;
        expect(now.get(entry.id)).toEqual(entry);
      }
      await agenda.whenIdle();
    }
    expect(agenda.get('steam:3')?.deletedAt).not.toBeNull();
    const before = byId(agenda.allEntries());
    await t.close();
    const reopened = await tab(browser);
    expect(byId(reopened.agenda.allEntries())).toEqual(before);
  });

  it('Platinado pasa a Completado con fechas y un solo Deshacer lo revierte', async () => {
    const t = await tab();
    t.agenda.capture({ id: 'steam:1', title: 'Hades' });
    const result = t.agenda.setFlag('steam:1', 'platinum', true);
    expect(result.effect).toMatchObject({ kind: 'flag', autoCompleted: true });
    expect(t.agenda.get('steam:1')).toMatchObject({
      status: 'completed',
      completedAt: '2026-10-29',
      platinumAt: '2026-10-29',
    });
    result.undo?.();
    expect(t.agenda.get('steam:1')).toMatchObject({
      status: 'want_to_play',
      completedAt: null,
      platinumAt: null,
      flags: { platinum: false },
    });
  });

  it('apunta al final de Quiero jugar, nunca duplica y vuelve a apuntar desde cero', async () => {
    const t = await tab();
    for (const n of [1, 2, 3]) t.agenda.capture({ id: `steam:${n}`, title: `J${n}` });
    expect(t.agenda.capture({ id: 'steam:2', title: 'J2' }).effect.kind).toBe('alreadyInList');
    expect(ordered(t)).toEqual(['steam:1', 'steam:2', 'steam:3']);
    t.agenda.setFlag('steam:2', 'owned', true);
    t.agenda.remove('steam:2');
    t.agenda.capture({ id: 'steam:2', title: 'J2' });
    expect(ordered(t)).toEqual(['steam:1', 'steam:3', 'steam:2']);
    expect(t.agenda.get('steam:2')?.flags.owned).toBe(false);
  });

  it('el orden manual usa la `rank` como texto, no `localeCompare`', async () => {
    const t = await tab();
    for (let n = 1; n <= 40; n++) t.agenda.capture({ id: `steam:${n}`, title: `J${n}` });
    t.agenda.move('steam:40', 'top');
    t.agenda.move('steam:1', 'bottom');
    t.agenda.move('steam:20', 'up');
    const order = ordered(t);
    expect(order[0]).toBe('steam:40');
    expect(order.at(-1)).toBe('steam:1');
    expect(order.indexOf('steam:20')).toBe(order.indexOf('steam:19') - 1);
  });

  it('vincula un juego manual con Steam y Deshacer lo separa', async () => {
    const t = await tab();
    const manual = manualEntryId(uuidv7());
    t.agenda.capture({ id: manual, title: 'Hades 2' });
    t.agenda.update(manual, { note: 'Regalo' });
    t.agenda.setStatus(manual, 'playing');
    const result = t.agenda.link(manual, { id: 'steam:1145350', title: 'Hades II' });
    expect(result.effect).toEqual({ kind: 'linked', title: 'Hades II' });
    expect(t.agenda.get(manual)).toMatchObject({ mergedInto: 'steam:1145350' });
    expect(t.agenda.get('steam:1145350')).toMatchObject({
      title: 'Hades II',
      status: 'playing',
      note: 'Regalo',
    });
    expect(t.agenda.getSnapshot().map((e) => e.id)).toEqual(['steam:1145350']);
    result.undo?.();
    expect(t.agenda.getSnapshot().map((e) => e.id)).toEqual([manual]);
  });

  it('un provisional se resuelve con el catálogo sin cambiar de id ni dejar Deshacer', async () => {
    const t = await tab();
    const result = t.agenda.capture({ id: 'steam:1145350', title: 'Hades 2', provisional: true });
    expect(result.effect).toMatchObject({ kind: 'captured', provisional: true });
    t.agenda.refreshFromCatalog([
      { id: 'steam:1145350', title: 'Hades II' },
      { id: 'steam:404', title: 'No apuntado' },
    ]);
    expect(t.agenda.getSnapshot().map((e) => [e.id, e.title])).toEqual([
      ['steam:1145350', 'Hades II'],
    ]);
  });

  it('«Borrar todos mis datos» vacía las cuatro tablas y anula los Deshacer', async () => {
    const t = await tab();
    const captured = t.agenda.capture({ id: 'steam:1', title: 'Hades' });
    const changed = t.agenda.setStatus('steam:1', 'playing');
    await t.agenda.whenIdle();
    await t.db.settings.put({ key: 'theme', value: 'dark' });
    await t.agenda.deleteAll();
    expect(t.agenda.getSnapshot()).toEqual([]);
    for (const table of [t.db.entries, t.db.outbox, t.db.settings, t.db.meta]) {
      expect(await table.count()).toBe(0);
    }
    changed.undo?.();
    captured.undo?.();
    await t.agenda.whenIdle();
    expect(t.agenda.allEntries()).toEqual([]);
    expect(await t.db.entries.count()).toBe(0);
  });
});

describe('dos pestañas', () => {
  it('lo que apunta una pestaña aparece en la otra', async () => {
    const browser = newBrowser();
    const a = await tab(browser);
    const b = await tab(browser);
    a.agenda.capture({ id: 'steam:1', title: 'Hades' });
    await a.agenda.whenIdle();
    await b.agenda.whenIdle();
    expect(b.agenda.getSnapshot().map((e) => e.id)).toEqual(['steam:1']);

    b.agenda.setStatus('steam:1', 'playing');
    await b.agenda.whenIdle();
    await a.agenda.whenIdle();
    expect(a.agenda.get('steam:1')?.status).toBe('playing');
    // El reloj de A ha recibido la HLC de B: su siguiente acción va detrás.
    a.agenda.setFlag('steam:1', 'owned', true);
    expect(a.agenda.get('steam:1')?.flags.owned).toBe(true);
  });

  it('dos cambios a la vez en la misma entrada se fusionan campo a campo', async () => {
    const browser = newBrowser();
    const a = await tab(browser);
    a.agenda.capture({ id: 'steam:1', title: 'Hades' });
    await a.agenda.whenIdle();
    const b = await tab(browser);

    // Cada pestaña parte de la misma entrada y cambia un campo distinto antes de ver la otra.
    a.agenda.setFlag('steam:1', 'owned', true);
    b.agenda.setStatus('steam:1', 'playing');
    await Promise.all([a.agenda.whenIdle(), b.agenda.whenIdle()]);
    await Promise.all([a.agenda.whenIdle(), b.agenda.whenIdle()]);

    const stored = await a.db.entries.get('steam:1');
    expect(stored).toMatchObject({ status: 'playing', flags: { owned: true } });
    expect(a.agenda.get('steam:1')).toEqual(stored);
    expect(b.agenda.get('steam:1')).toEqual(stored);
  });

  it('«Borrar todos mis datos» en una pestaña vacía la otra', async () => {
    const browser = newBrowser();
    const a = await tab(browser);
    const b = await tab(browser);
    a.agenda.capture({ id: 'steam:1', title: 'Hades' });
    await a.agenda.whenIdle();
    await b.agenda.whenIdle();
    expect(b.agenda.getSnapshot()).toHaveLength(1);
    await a.agenda.deleteAll();
    await b.agenda.whenIdle();
    expect(b.agenda.getSnapshot()).toEqual([]);
  });
});

describe('agenda sin almacén', () => {
  it('funciona solo en memoria si IndexedDB no está disponible', () => {
    const agenda = createAgenda({
      clock: createHlcClock({ now: Date.now, node: 'abcd1234' }),
      newId: uuidv7,
      storage: null,
    });
    agenda.capture({ id: 'steam:1', title: 'Hades' });
    expect(agenda.setStatus('steam:1', 'playing').effect).toMatchObject({ kind: 'status' });
    expect(agenda.getSnapshot()[0]?.status).toBe('playing');
  });
});

describe('guardado fallido', () => {
  it('«Reintentar» guarda lo que falló, en su orden, sin esperar a otro cambio', async () => {
    const t = await tab();
    const storage = createDexieAgendaStorage(t.db, uuidv7);
    let broken = true;
    const errors: unknown[] = [];
    const agenda = createAgenda({
      clock: createHlcClock({ now: Date.now, node: 'abcd1234' }),
      newId: uuidv7,
      storage: {
        ...storage,
        write: (batch) =>
          broken ? Promise.reject(new Error('disco lleno')) : storage.write(batch),
      },
      now: () => TODAY,
      onStorageError: (error) => errors.push(error),
      afterPaint: () => Promise.resolve(),
    });
    agenda.capture({ id: 'steam:1', title: 'Hades' });
    agenda.setStatus('steam:1', 'playing');
    await agenda.whenIdle();
    // Cada guardado que falla avisa (main.tsx muestra como mucho un aviso cada 30 s).
    expect(errors).toHaveLength(2);
    expect(await t.db.entries.count()).toBe(0);

    broken = false;
    await agenda.retryStorage();
    expect(errors).toHaveLength(2);
    expect(await t.db.entries.get('steam:1')).toEqual(agenda.get('steam:1'));
    expect((await t.db.entries.get('steam:1'))?.status).toBe('playing');
    agenda.dispose();
  });
});
