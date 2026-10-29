/// <reference lib="webworker" />
// Worker de búsqueda (ver §5.2 y §8): ciclo de vida del catálogo, índice y *ranking*. Lo crea
// `createAppSearchClient()` con `new Worker(new URL(…), { type: 'module' })`; uFuzzy va en su
// propio *chunk* diferido (§6.2). No toca datos del usuario ni importa Dexie.
import './zod-jitless.ts';
import { loadFuzzy } from '@gameagenda/core/search';
import type { TestControlMessage, UiToWorkerMessage } from '../search-client/protocol.ts';
import { createCatalogStore } from './catalog-store.ts';
import { createWorkerTestHooks } from './e2e-hooks.ts';
import { createSearchHost } from './host.ts';

declare const self: DedicatedWorkerGlobalScope;

/** Carpeta del catálogo: `VITE_CATALOG_URL` o, por defecto, el de desarrollo (§13.3). */
function catalogBaseUrl(): string {
  const configured = import.meta.env.VITE_CATALOG_URL || '/catalog-dev/';
  const base = configured.endsWith('/') ? configured : `${configured}/`;
  return new URL(base, `${self.location.origin}/`).href;
}

// Cesión del turno entre bloques: un `MessageChannel` no sufre el mínimo de 4 ms de `setTimeout`.
const tasks: Array<() => void> = [];
const channel = new MessageChannel();
channel.port1.onmessage = () => tasks.shift()?.();

const testHooks = import.meta.env.MODE === 'e2e' ? createWorkerTestHooks() : null;

const host = createSearchHost({
  post: (message) => self.postMessage(message),
  now: () => performance.now(),
  schedule(task) {
    tasks.push(task);
    channel.port2.postMessage(null);
  },
  store: createCatalogStore({
    fetch: (input, init) => fetch(input, init),
    caches: 'caches' in self ? self.caches : null,
    subtle: crypto.subtle,
    baseUrl: catalogBaseUrl(),
    appVersion: __APP_VERSION__,
  }),
  loadFuzzy,
  testHooks,
});

self.addEventListener('message', (event: MessageEvent<UiToWorkerMessage | TestControlMessage>) => {
  const message = event.data;
  if (message.type === 'test') {
    if (testHooks) {
      testHooks.control(message);
      host.resume();
    }
    return;
  }
  host.handle(message);
});

self.addEventListener('online', () => host.online());
