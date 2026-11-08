import { createHlcClock } from '@gameagenda/core/sync';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it, vi } from 'vitest';
import type { CoreGame, SearchClient, StatusMessage } from '../search-client/index.ts';
import { createAgenda } from './agenda.ts';
import { ASK_AGAIN_MS, startCatalogRefresh } from './catalog-refresh.ts';
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
        { kind: 'later', retryAfterMs: 60_000, scope: 'all' },
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

describe('`resolve`, solo si se puede (M4: con la sincronización activada)', () => {
  it('sin poder, no pregunta; al poder, pregunta lo que esperaba', async () => {
    const agenda = createAgenda({
      clock: createHlcClock({ now: Date.now, node: 'abcd1234' }),
      newId: uuidv7,
      storage: null,
    });
    const search = fakeSearch([hades]);
    const resolve = vi.fn<ResolveName>(async () => ({ kind: 'name', name: 'Con nombre' }));
    let can = false;
    const listeners = new Set<() => void>();
    const stop = startCatalogRefresh(search.client, agenda, {
      resolve,
      settleMs: 0,
      isOnline: () => true,
      events: null,
      canResolve: () => can,
      subscribeCanResolve(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });
    agenda.capture({ id: 'steam:3999990', title: 'Mi Juego Indie', provisional: true });
    search.setStatus({ state: 'full', version: '20261028.1' });
    await vi.waitFor(() => expect(search.lookup).toHaveBeenCalled());
    // Cambia el estado sin poder todavía (p. ej., otra ronda): nada.
    for (const listener of listeners) listener();
    await new Promise((resolveTick) => setTimeout(resolveTick, 10));
    expect(resolve).not.toHaveBeenCalled();
    can = true;
    for (const listener of listeners) listener();
    await vi.waitFor(() => expect(agenda.get('steam:3999990')?.title).toBe('Con nombre'));
    expect(resolve).toHaveBeenCalledTimes(1);
    stop();
    expect(listeners.size).toBe(0);
  });
});

describe('`resolve`: los arreglos de la revisión del 08-11-2026', () => {
  function agendaWith(...appids: number[]) {
    const agenda = createAgenda({
      clock: createHlcClock({ now: Date.now, node: 'abcd1234' }),
      newId: uuidv7,
      storage: null,
    });
    for (const appid of appids) {
      agenda.capture({ id: `steam:${appid}`, title: `Juego de Steam ${appid}`, provisional: true });
    }
    return agenda;
  }

  it('un juego que falla él solo no bloquea a los demás', async () => {
    const agenda = agendaWith(3999990, 3999991);
    const search = fakeSearch([hades]);
    const resolve = vi.fn<ResolveName>(async (appid) =>
      appid === 3999990
        ? { kind: 'later', retryAfterMs: 60_000, scope: 'one' }
        : { kind: 'name', name: 'El segundo' },
    );
    const stop = startCatalogRefresh(search.client, agenda, { resolve, events: null });
    search.setStatus({ state: 'full', version: '20261028.1' });
    await vi.waitFor(() => expect(agenda.get('steam:3999991')?.title).toBe('El segundo'));
    expect(resolve.mock.calls.map(([a]) => a)).toEqual([3999990, 3999991]);
    stop();
  });

  it('lo que se apunta mientras se pregunta también se pregunta', async () => {
    const agenda = agendaWith(3999990);
    const search = fakeSearch([hades]);
    let release: () => void = () => undefined;
    const first = new Promise<void>((resolveFirst) => {
      release = resolveFirst;
    });
    const resolve = vi.fn<ResolveName>(async (appid) => {
      if (appid === 3999990) await first;
      return { kind: 'unknown' };
    });
    const stop = startCatalogRefresh(search.client, agenda, {
      resolve,
      settleMs: 0,
      events: null,
    });
    search.setStatus({ state: 'full', version: '20261028.1' });
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
    agenda.capture({ id: 'steam:3999991', title: 'Otro', provisional: true });
    await vi.waitFor(() => expect(search.lookup).toHaveBeenCalledTimes(2));
    release();
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
    expect(resolve.mock.calls.map(([a]) => a)).toEqual([3999990, 3999991]);
    stop();
  });

  it('recuerda 7 días a quién preguntó, también entre sesiones', async () => {
    let saved = new Map<number, number>();
    const memory = {
      load: async () => new Map(saved),
      save: (asked: ReadonlyMap<number, number>) => {
        saved = new Map(asked);
      },
    };
    let clock = Date.UTC(2026, 10, 8, 12);
    const session = () => {
      const agenda = agendaWith(3999990);
      const search = fakeSearch([hades]);
      const resolve = vi.fn<ResolveName>(async () => ({ kind: 'unknown' }));
      const stop = startCatalogRefresh(search.client, agenda, {
        resolve,
        memory,
        now: () => clock,
        events: null,
      });
      search.setStatus({ state: 'full', version: '20261028.1' });
      return { resolve, search, stop };
    };
    const a = session();
    await vi.waitFor(() => expect(a.resolve).toHaveBeenCalledTimes(1));
    a.stop();
    expect([...saved.keys()]).toEqual([3999990]);
    // Al día siguiente no pregunta; a los 7 días, sí.
    clock += 86_400_000;
    const b = session();
    await vi.waitFor(() => expect(b.search.lookup).toHaveBeenCalled());
    await new Promise((tick) => setTimeout(tick, 10));
    expect(b.resolve).not.toHaveBeenCalled();
    b.stop();
    clock += ASK_AGAIN_MS;
    const c = session();
    await vi.waitFor(() => expect(c.resolve).toHaveBeenCalledTimes(1));
    c.stop();
  });

  it('un cambio que no hace crecer la agenda no la vuelve a recorrer', async () => {
    const agenda = agendaWith();
    agenda.capture({ id: 'steam:1145350', title: 'Hades II' });
    const search = fakeSearch([hades]);
    const stop = startCatalogRefresh(search.client, agenda, { settleMs: 0, events: null });
    search.setStatus({ state: 'full', version: '20261028.1' });
    await vi.waitFor(() => expect(search.lookup).toHaveBeenCalledTimes(1));
    agenda.setStatus('steam:1145350', 'playing');
    agenda.setFlag('steam:1145350', 'owned', true);
    await new Promise((tick) => setTimeout(tick, 20));
    expect(search.lookup).toHaveBeenCalledTimes(1);
    agenda.capture({ id: 'steam:504230', title: 'Celeste' });
    await vi.waitFor(() => expect(search.lookup).toHaveBeenCalledTimes(2));
    stop();
  });
});
