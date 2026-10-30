import { createHlcClock } from '@gameagenda/core/sync';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it, vi } from 'vitest';
import type { CoreGame, SearchClient, StatusMessage } from '../search-client/index.ts';
import { createAgenda } from './agenda.ts';
import { startCatalogRefresh } from './catalog-refresh.ts';

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
});
