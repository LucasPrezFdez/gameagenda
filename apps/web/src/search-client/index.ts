import { measureSinceNavigation } from '../perf/measures.ts';
import { createSearchClient, type SearchClient } from './client.ts';
import { withTestHooks } from './e2e-hooks.ts';
import { workerTransport } from './protocol.ts';

export * from './client.ts';
export type * from './protocol.ts';
export { GAME_FLAGS, workerTransport } from './protocol.ts';

/** `search:ready` (primer `status` distinto de `none`) y `search:full` (ver §12.4). */
function measureAvailability(client: SearchClient): void {
  let ready = false;
  const stop = client.subscribeStatus(() => {
    const { state } = client.getStatus();
    if (!ready && state !== 'none') {
      ready = true;
      measureSinceNavigation('search:ready');
    }
    if (state === 'full') {
      measureSinceNavigation('search:full');
      stop();
    }
  });
}

/** Cliente de búsqueda de la app sobre el Worker de búsqueda (ver §8.7). */
export function createAppSearchClient(): SearchClient {
  const worker = new Worker(new URL('../search-worker/index.ts', import.meta.url), {
    type: 'module',
    name: 'gameagenda-search',
  });
  const transport =
    import.meta.env.MODE === 'e2e'
      ? withTestHooks(worker, workerTransport(worker))
      : workerTransport(worker);
  const client = createSearchClient(transport);
  measureAvailability(client);
  return client;
}
