import { manualEntryId } from '@gameagenda/core/entries';
import { IDBKeyRange } from 'fake-indexeddb';
import { v7 as uuidv7 } from 'uuid';
import { afterEach, describe, expect, it } from 'vitest';
import { byId, newBrowser, openTab, type TestTab, values } from '../agenda/test-support.ts';
import { META_KEYS, openDatabase } from '../db/database.ts';
import { createDexieSettingsStorage } from '../db/settings-storage.ts';
import { createSettingsStore, parseSettings } from '../settings/settings-store.ts';
import {
  buildCsvExport,
  buildJsonExport,
  type DataServices,
  deleteAllData,
  importText,
} from './data-actions.ts';

const open: TestTab[] = [];
async function services(browser = newBrowser()) {
  const tab = await openTab(browser);
  open.push(tab);
  const storage = createDexieSettingsStorage(tab.db, (error) => {
    throw error;
  });
  const settings = createSettingsStore(parseSettings(tab.state.settings), storage);
  const data: DataServices = { agenda: tab.agenda, settings, appVersion: '0.0.0-test' };
  return { tab, data, settings, storage };
}

afterEach(async () => {
  for (const tab of open.splice(0)) await tab.close();
});

/** Una agenda con un poco de todo: estados, marcas, fechas, nota, orden, lápida y vínculo. */
function fill({ agenda }: DataServices): void {
  agenda.capture({ id: 'steam:1145350', title: 'Hades II' });
  agenda.capture({ id: 'steam:504230', title: 'Celeste' }, { status: 'playing' });
  agenda.capture({ id: 'steam:105600', title: 'Terraria' });
  agenda.capture({ id: 'steam:367520', title: 'Hollow Knight' });
  agenda.setFlag('steam:504230', 'platinum', true);
  agenda.setFlag('steam:105600', 'owned', true);
  agenda.setFlag('steam:105600', 'next', true);
  agenda.update('steam:1145350', { note: 'Con «comillas»; y\nsaltos', ownedAt: '2025-09' });
  agenda.move('steam:367520', 'top');
  agenda.remove('steam:367520');
  const manual = manualEntryId(uuidv7());
  agenda.capture({ id: manual, title: '=Juego raro' });
  agenda.capture({ id: manualEntryId(uuidv7()), title: 'Hades 2' });
  agenda.link(manual, { id: 'steam:9999990', title: 'Juego raro' });
}

describe('exportar e importar (CA1.9)', () => {
  it('exportar → borrar → importar deja las entradas idénticas, HLC incluidas', async () => {
    const browser = newBrowser();
    const { tab, data, settings } = await services(browser);
    fill(data);
    settings.update({ theme: 'dark', showAdult: true });
    await tab.agenda.whenIdle();
    const before = byId(tab.agenda.allEntries());
    const json = buildJsonExport(data).content;

    await deleteAllData(data);
    expect(tab.agenda.allEntries()).toEqual([]);
    expect(settings.getSnapshot().theme).toBe('system');
    expect(await tab.db.entries.count()).toBe(0);

    const outcome = await importText(data, 'gameagenda.json', json);
    const live = before.filter((e) => e.deletedAt === null).length;
    expect(outcome).toEqual({
      kind: 'done',
      counts: { added: live, changed: 0, removed: 0, rejected: 0 },
      skipped: 0,
    });
    expect(byId(tab.agenda.allEntries())).toEqual(before);
    expect(settings.getSnapshot()).toMatchObject({ theme: 'dark', showAdult: true });
    // Antes de importar se ha guardado la copia de seguridad (aquí, de la agenda vacía).
    expect((await tab.db.meta.get(META_KEYS.backup))?.value).toMatchObject({ entries: [] });

    // Reimportar no duplica ni cambia nada.
    const again = await importText(data, 'gameagenda.json', json);
    expect(again).toMatchObject({ counts: { added: 0, changed: 0, removed: 0, rejected: 0 } });
    expect(byId(tab.agenda.allEntries())).toEqual(before);

    // Y queda guardado: otra pestaña (o una recarga) lo lee igual de Dexie.
    await tab.close();
    open.splice(0);
    const reopened = await services(browser);
    expect(byId(reopened.tab.agenda.allEntries())).toEqual(before);
    expect(reopened.settings.getSnapshot().theme).toBe('dark');
  });

  it('importar la copia de otro dispositivo une sin duplicar y cuenta los cambios', async () => {
    const { data } = await services();
    fill(data);
    const json = buildJsonExport(data).content;
    const other = await services();
    other.data.agenda.capture({ id: 'steam:1145350', title: 'Hades II' });
    other.data.agenda.capture({ id: 'steam:570', title: 'Dota 2' });
    const outcome = await importText(other.data, 'copia.json', json);
    // Celeste, Terraria, el juego vinculado y el manual; Hades II ya estaba.
    expect(outcome).toMatchObject({ counts: { added: 4, changed: 0, removed: 0, rejected: 0 } });
    const ids = other.data.agenda.getSnapshot().map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(6);
    // Hades II se apuntó después en el otro dispositivo: su alta gana campo a campo (LWW).
    expect(other.data.agenda.get('steam:1145350')?.note).toBe('');
  });

  it('un fichero que no es una copia de GameAgenda no cambia nada', async () => {
    const { tab, data } = await services();
    data.agenda.capture({ id: 'steam:1', title: 'Hades' });
    const before = byId(tab.agenda.allEntries());
    for (const [name, text] of [
      ['otra.json', '{"format":"otra-app","version":1}'],
      ['roto.json', '{"format":'],
      ['hoja.csv', 'nombre;estado\r\nHades;jugando\r\n'],
      ['comillas.csv', 'title\r\n"sin cerrar\r\n'],
    ] as const) {
      expect(await importText(data, name, text)).toEqual({ kind: 'invalid' });
    }
    expect(byId(tab.agenda.allEntries())).toEqual(before);
    expect(await tab.db.meta.get(META_KEYS.backup)).toBeUndefined();
  });

  it('CSV: exportar → borrar → importar recupera lo visible; reimportar no duplica', async () => {
    const { tab, data } = await services();
    fill(data);
    const visible = (entries: ReturnType<typeof tab.agenda.allEntries>) =>
      entries
        .filter((e) => e.deletedAt === null)
        .map((e) => {
          const v = values(e);
          return v && { ...v, rank: undefined, id: e.id.startsWith('manual:') ? 'manual' : e.id };
        })
        .sort((a, b) => (a?.title ?? '').localeCompare(b?.title ?? ''));
    const before = visible(tab.agenda.allEntries());
    const csv = buildCsvExport(data).content;
    expect(csv.startsWith('﻿id;title;status;statusLabel;')).toBe(true);
    expect(csv).toContain(';Quiero jugar;');

    await deleteAllData(data);
    const outcome = await importText(data, 'lista.csv', csv);
    expect(outcome).toMatchObject({
      kind: 'done',
      counts: { added: before.length, rejected: 0 },
      skipped: 0,
    });
    const after = visible(tab.agenda.allEntries());
    expect(after.map((e) => e && { ...e, mergedInto: null })).toEqual(
      before.map((e) => e && { ...e, mergedInto: null }),
    );

    const again = await importText(data, 'lista.csv', csv);
    expect(again).toMatchObject({ counts: { added: 0 }, skipped: before.length });
  });
});

describe('ajustes y registro de errores en Dexie', () => {
  it('los ajustes se guardan por clave y vuelven al valor por defecto borrando la fila', async () => {
    const browser = newBrowser();
    const { tab, settings, storage } = await services(browser);
    settings.update({ theme: 'dark', listSearch: 'vista=jugando' });
    await storage.whenIdle();
    expect(await tab.db.settings.toArray()).toEqual([
      { key: 'listSearch', value: 'vista=jugando' },
      { key: 'theme', value: 'dark' },
    ]);
    settings.update({ theme: 'system' });
    await storage.whenIdle();
    expect(await tab.db.settings.toArray()).toEqual([
      { key: 'listSearch', value: 'vista=jugando' },
    ]);
  });

  it('otra pestaña recibe los ajustes guardados', async () => {
    const browser = newBrowser();
    const a = await services(browser);
    const b = await services(browser);
    b.storage.watch(b.settings);
    a.settings.update({ slashOpensPalette: false });
    await a.storage.whenIdle();
    await expect.poll(() => b.settings.getSnapshot().slashOpensPalette).toBe(false);
  });

  it('valores no válidos se ignoran al leer los ajustes', () => {
    expect(parseSettings({ theme: 'sepia', showAdult: 'sí', slashOpensPalette: false })).toEqual({
      theme: 'system',
      showAdult: false,
      slashOpensPalette: false,
      listSearch: '',
    });
  });

  it('meta.errorLog guarda los 100 últimos errores de todas las pestañas', async () => {
    const { createDexieErrorLogStorage } = await import('../db/error-log-storage.ts');
    const db = openDatabase({ indexedDB: newBrowser(), IDBKeyRange });
    const storage = createDexieErrorLogStorage(db);
    const record = (n: number) => ({
      at: new Date(n).toISOString(),
      source: 'window' as const,
      message: `error ${n}`,
      stack: null,
    });
    await storage.append(Array.from({ length: 60 }, (_, n) => record(n)));
    await storage.append(Array.from({ length: 60 }, (_, n) => record(60 + n)));
    const stored = await storage.load();
    expect(stored).toHaveLength(100);
    expect(stored[0]?.message).toBe('error 20');
    expect(stored.at(-1)?.message).toBe('error 119');
    db.close();
  });
});
