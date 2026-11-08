import { createHlcClock } from '@gameagenda/core/sync';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it, vi } from 'vitest';
import type { CoreGame, SearchClient, StatusMessage } from '../search-client/index.ts';
import { createAgenda } from './agenda.ts';
import { startCatalogRefresh } from './catalog-refresh.ts';
import type { ResolveName } from './resolve-client.ts';

function fakeSearch(catalog: readonly CoreGame[]) {
  let status: StatusMessage = {
    type: 'status',
    state: 'none',
    version: null,
    count: 0,
    progress: 0,
    error: null,
    catalog: null,
  };
  const listeners = new Set<() => void>();
  const lookup = vi.fn(async (appids: readonly number[]) => {
    const found = catalog.filter((game) => appids.includes(game.appid));
    return { found, missing: appids.filter((a) => !found.some((g) => g.appid === a)) };
  });
  const client = {
    getStatus: () => status,
    subscribeStatus(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    lookup,
  } as unknown as SearchClient;
  return {
    client,
    lookup,
    setStatus(next: Partial<StatusMessage>) {
      status = { ...status, ...next };
      for (const listener of listeners) listener();
    },
  };
}

const hades: CoreGame = { appid: 1145350, name: 'Hades II', nameEs: null, year: 2025, flags: 0 };

describe('provisionales y catálogo (RF-04, §7.3)', () => {
  it('al cargarse o cambiar la versión del catálogo, resuelve los provisionales', async () => {
    const agenda = createAgenda({
      clock: createHlcClock({ now: Date.now, node: 'abcd1234' }),
      newId: uuidv7,
      storage: null,
    });
    agenda.capture({ id: 'steam:1145350', title: 'Hades 2', provisional: true });
    agenda.capture({ id: 'steam:3999990', title: 'Mi Juego Indie', provisional: true });
    const search = fakeSearch([hades]);
    const stop = startCatalogRefresh(search.client, agenda);
    expect(search.lookup).not.toHaveBeenCalled();

    search.setStatus({ state: 'scan', version: '20261028.1' });
    await vi.waitFor(() => expect(agenda.get('steam:1145350')?.title).toBe('Hades II'));
    expect(search.lookup).toHaveBeenCalledWith([1145350, 3999990]);
    expect(agenda.get('steam:3999990')?.title).toBe('Mi Juego Indie');

    // La misma versión no vuelve a buscar; otra, sí.
    search.setStatus({ state: 'full' });
    expect(search.lookup).toHaveBeenCalledTimes(1);
    search.setStatus({ version: '20261029.1' });
    expect(search.lookup).toHaveBeenCalledTimes(2);
    stop();
  });

  it('en `boot` mira, y vuelve a mirar en `scan` con la misma versión (M3)', async () => {
    const agenda = createAgenda({
      clock: createHlcClock({ now: Date.now, node: 'abcd1234' }),
      newId: uuidv7,
      storage: null,
    });
    agenda.capture({ id: 'steam:3999990', title: 'Mi Juego Indie', provisional: true });
    const search = fakeSearch([hades]);
    const stop = startCatalogRefresh(search.client, agenda);
    search.setStatus({ state: 'boot', version: '20261028.1' });
    expect(search.lookup).toHaveBeenCalledTimes(1);
    // Un enlace pegado en `boot` de un juego que no está entre los más populares.
    agenda.capture({ id: 'steam:1145350', title: 'Hades 2', provisional: true });
    search.setStatus({ state: 'scan' });
    await vi.waitFor(() => expect(agenda.get('steam:1145350')?.title).toBe('Hades II'));
    expect(search.lookup).toHaveBeenCalledTimes(2);
    search.setStatus({ state: 'full' });
    expect(search.lookup).toHaveBeenCalledTimes(2);
    stop();
  });
});

describe('lo que no está en el catálogo pregunta a `resolve` (M4; CA4.5)', () => {
  function setup(resolve: ResolveName, online = { value: true }) {
    const agenda = createAgenda({
      clock: createHlcClock({ now: Date.now, node: 'abcd1234' }),
      newId: uuidv7,
      storage: null,
    });
    const search = fakeSearch([hades]);
    const target = new EventTarget();
    const stop = startCatalogRefresh(search.client, agenda, {
      resolve,
      settleMs: 0,
      isOnline: () => online.value,
      events: target as unknown as Window,
    });
    return { agenda, search, stop, target };
  }

  it('al llegar a `scan`, y con lo que se apunta después; una vez por juego', async () => {
    const resolve = vi.fn<ResolveName>(async (appid) =>
      appid === 3999990
        ? { kind: 'name', name: 'Mi Juego Indie: Edición final' }
        : { kind: 'unknown' },
    );
    const { agenda, search, stop } = setup(resolve);
    agenda.capture({ id: 'steam:3999990', title: 'Mi Juego Indie', provisional: true });
    // En `boot` no: puede estar en el núcleo.
    search.setStatus({ state: 'boot', version: '20261028.1' });
    await Promise.resolve();
    expect(resolve).not.toHaveBeenCalled();
    search.setStatus({ state: 'scan' });
    await vi.waitFor(() =>
      expect(agenda.get('steam:3999990')?.title).toBe('Mi Juego Indie: Edición final'),
    );
    // Lo apuntado después, también: lo del catálogo se queda con su nombre, sin preguntar.
    agenda.capture({ id: 'steam:3999991', title: 'Juego de Steam 3999991', provisional: true });
    agenda.capture({ id: 'steam:1145350', title: 'Hades 2', provisional: true });
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(agenda.get('steam:1145350')?.title).toBe('Hades II'));
    expect(resolve.mock.calls.map(([appid]) => appid)).toEqual([3999990, 3999991]);
    expect(agenda.get('steam:3999991')?.title).toBe('Juego de Steam 3999991');
    // Otra versión del catálogo no vuelve a preguntar en la misma sesión.
    search.setStatus({ version: '20261029.1' });
    await vi.waitFor(() => expect(search.lookup).toHaveBeenCalledTimes(4));
    expect(resolve).toHaveBeenCalledTimes(2);
    stop();
  });

  it('sin red espera a `online`; con un fallo, se para y lo vuelve a intentar', async () => {
    vi.useFakeTimers();
    try {
      const online = { value: false };
      const answers: Array<Awaited<ReturnType<ResolveName>>> = [
        { kind: 'later', retryAfterMs: 60_000 },
        { kind: 'name', name: 'Ya tiene nombre' },
      ];
      const resolve = vi.fn<ResolveName>(async () => answers.shift() ?? { kind: 'unknown' });
      const { agenda, search, stop, target } = setup(resolve, online);
      agenda.capture({ id: 'steam:3999990', title: 'Mi Juego Indie', provisional: true });
      search.setStatus({ state: 'full', version: '20261028.1' });
      await vi.advanceTimersByTimeAsync(10);
      expect(resolve).not.toHaveBeenCalled();
      online.value = true;
      target.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(10);
      expect(resolve).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(59_000);
      expect(resolve).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(resolve).toHaveBeenCalledTimes(2);
      expect(agenda.get('steam:3999990')?.title).toBe('Ya tiene nombre');
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('lo quitado de la lista antes de preguntar ya no se pregunta', async () => {
    const resolve = vi.fn<ResolveName>(async () => ({ kind: 'unknown' }));
    const { agenda, search, stop } = setup(resolve, { value: false });
    agenda.capture({ id: 'steam:3999990', title: 'Mi Juego Indie', provisional: true });
    search.setStatus({ state: 'full', version: '20261028.1' });
    await vi.waitFor(() => expect(search.lookup).toHaveBeenCalled());
    agenda.remove('steam:3999990');
    stop();
    expect(resolve).not.toHaveBeenCalled();
  });
});
