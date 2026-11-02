/// <reference lib="webworker" />
// Service Worker propio (ver §5.2 y §6.1): precaché del *build*, que `vite-plugin-pwa` inyecta en
// `self.__WB_MANIFEST`. Tras la primera visita la app abre sin red. No guarda el catálogo (lo hace
// el Worker de búsqueda en Cache Storage) y las portadas llegan en M2.
export {};

interface PrecacheEntry {
  readonly url: string;
  readonly revision: string | null;
}

declare const self: ServiceWorkerGlobalScope & {
  readonly __WB_MANIFEST: readonly (PrecacheEntry | string)[];
};

const PREFIX = 'ga-shell-';
const entries = self.__WB_MANIFEST.map((entry) =>
  typeof entry === 'string' ? { url: entry, revision: null } : entry,
);
const urls = new Set(entries.map((entry) => new URL(entry.url, self.registration.scope).href));
const shellUrl = new URL('index.html', self.registration.scope).href;

/** FNV-1a de la lista: una caché por versión del *build*. */
function versionOf(list: readonly PrecacheEntry[]): string {
  let hash = 2166136261;
  for (const { url, revision } of list) {
    for (const char of `${url}@${revision ?? ''}`) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
  }
  return (hash >>> 0).toString(36);
}

const CACHE = `${PREFIX}${versionOf(entries)}`;

/**
 * Una respuesta que ha seguido una redirección no vale para una navegación: Chrome la rechaza con
 * `net::ERR_FAILED`. Workers Static Assets redirige `/index.html` a `/` (307), así que se guarda
 * una copia sin la marca de redirigida, con el mismo cuerpo y las mismas cabeceras.
 */
async function storable(response: Response): Promise<Response> {
  if (!response.redirected) return response;
  return new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(
        [...urls].map(async (url) => {
          // `reload`: nunca una copia vieja de la caché HTTP.
          const response = await fetch(url, { cache: 'reload' });
          if (!response.ok) throw new Error(`Precaché: ${url} respondió ${response.status}`);
          await cache.put(url, await storable(response));
        }),
      );
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(PREFIX) && name !== CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/**
 * La página pide el relevo cuando lleva un rato oculta y sin nada a medias (`pwa/update-policy.ts`;
 * §5.2). Solo si ninguna otra ventana de la app está a la vista: esa seguiría con el código
 * anterior, y su precaché se borra al activar esta versión.
 */
self.addEventListener('message', (event) => {
  if ((event.data as { type?: unknown } | null)?.type !== 'SKIP_WAITING') return;
  const { source } = event;
  const asker = source && 'id' in source ? source.id : null;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (windows.every((client) => client.id === asker || client.visibilityState === 'hidden')) {
        await self.skipWaiting();
      }
    })(),
  );
});

async function fromCache(url: string, request: Request): Promise<Response> {
  const cached = await (await caches.open(CACHE)).match(url);
  return cached ?? fetch(request);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const href = url.origin + url.pathname;
  if (request.mode === 'navigate') {
    // SPA: cualquier ruta de la app se sirve con el `index.html` precacheado.
    event.respondWith(fromCache(urls.has(href) && href !== shellUrl ? href : shellUrl, request));
    return;
  }
  if (urls.has(href)) event.respondWith(fromCache(href, request));
});
