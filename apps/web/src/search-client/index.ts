import { createSearchClient, type SearchClient } from './client.ts';
import { createFakeSearchTransport, type FakeSearchOptions } from './fake/fake-worker.ts';

export * from './client.ts';
export type * from './protocol.ts';
export { GAME_FLAGS, workerTransport } from './protocol.ts';

declare global {
  /** Ajustes del cliente falso para desarrollo y E2E (`page.addInitScript`). */
  var __GA_FAKE_SEARCH__: FakeSearchOptions | undefined;
}

/**
 * Cliente de búsqueda de la app. Hasta que exista el Worker real usa el cliente falso; después:
 * `workerTransport(new Worker(new URL('../search-worker/index.ts', import.meta.url),
 * { type: 'module' }))`.
 */
export function createAppSearchClient(): SearchClient {
  return createSearchClient(createFakeSearchTransport(globalThis.__GA_FAKE_SEARCH__));
}
