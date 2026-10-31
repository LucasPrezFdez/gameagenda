// Detalles del catálogo en la interfaz: el almacén de la app, conectado al estado del Worker de
// búsqueda (`CatalogInfo`), y los *hooks* de las portadas, la ficha y Próximos.
import {
  createContext,
  type ReactNode,
  type RefObject,
  use,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import { useServices } from '../app/services.tsx';
import { catalogBaseUrl } from '../search-client/catalog-url.ts';
import type { CatalogInfo } from '../search-client/protocol.ts';
import type { UiSettings } from '../settings/settings-store.ts';
import { createDetailsStore, type DetailsState, type DetailsStore } from './details-store.ts';
import { withDetailsTestHooks } from './e2e-hooks.ts';

const DetailsContext = createContext<DetailsStore | null>(null);
const UNAVAILABLE: DetailsState = { kind: 'unavailable' };
const noop = () => undefined;

/** Cede el hilo: `scheduler.yield()` donde existe; si no, una tarea nueva. */
function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof scheduler?.yield === 'function') return scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function createAppDetailsStore(): DetailsStore {
  return createDetailsStore({
    loadSource: async () => {
      const { createDetailsSource } = await import('./details-source.ts');
      return createDetailsSource({
        fetch: (input, init) => fetch(input, init),
        caches: typeof caches === 'undefined' ? null : caches,
        subtle: crypto.subtle,
        baseUrl: catalogBaseUrl(window.location.origin),
        yieldToMain,
      });
    },
  });
}

/** En el *build* de los E2E, el catálogo con lo que fije la prueba (`e2e-hooks.ts`). */
const adaptCatalog: (info: CatalogInfo | null) => CatalogInfo | null =
  import.meta.env.MODE === 'e2e' ? withDetailsTestHooks : (info) => info;

export function DetailsProvider({ children }: { children: ReactNode }) {
  const { search } = useServices();
  const [store] = useState(createAppDetailsStore);
  useEffect(() => {
    const sync = (): void => {
      const status = search.getStatus();
      store.setCatalog(
        adaptCatalog(status.catalog),
        status.catalog === null && status.error !== null,
      );
    };
    sync();
    return search.subscribeStatus(sync);
  }, [search, store]);
  return <DetailsContext value={store}>{children}</DetailsContext>;
}

export function useDetailsStore(): DetailsStore {
  const store = use(DetailsContext);
  if (!store) throw new Error('Falta DetailsProvider');
  return store;
}

/** Detalles de `appid`; con `load`, los pide (si no, solo enseña lo que ya haya). */
export function useGameDetails(appid: number | null, load = true): DetailsState {
  const store = useDetailsStore();
  const subscribe = useCallback(
    (listener: () => void) => (appid === null ? noop : store.subscribe(appid, listener)),
    [store, appid],
  );
  const state = useSyncExternalStore(subscribe, () =>
    appid === null ? UNAVAILABLE : store.get(appid),
  );
  useEffect(() => {
    if (load && appid !== null) store.request([appid]);
  }, [store, appid, load]);
  return state;
}

/** Versión del almacén: cambia con cualquier detalle nuevo (para listas de muchos juegos). */
export function useDetailsVersion(): number {
  const store = useDetailsStore();
  return useSyncExternalStore(store.subscribeAll, store.getVersion);
}

export function useDetailsAvailability() {
  const store = useDetailsStore();
  return useSyncExternalStore(store.subscribeAll, store.getAvailability);
}

/**
 * Portadas (§9.5, regla 5; §11.2): `off` con «Cargar portadas» apagado, el *kill switch*
 * `covers` o sin detalles; `pending` mientras no ha salido el aviso de primera capa; `on`.
 */
export type CoverMode = 'off' | 'pending' | 'on';

function coverModeOf(settings: UiSettings): CoverMode {
  if (!settings.loadCovers) return 'off';
  return settings.coverNotice === 'unseen' ? 'pending' : 'on';
}

export function useCoverMode(): CoverMode {
  const { settings } = useServices();
  const store = useDetailsStore();
  // Valores primitivos: los cambios de otros ajustes (p. ej., el filtro de la lista) no repintan.
  const local = useSyncExternalStore(settings.subscribe, () => coverModeOf(settings.getSnapshot()));
  const remote = useSyncExternalStore(store.subscribeAll, store.coversAvailable);
  return remote ? local : 'off';
}

/** El catálogo con el que trabajan los detalles (con sus *kill switches*). */
export function useDetailsCatalog(): CatalogInfo | null {
  const store = useDetailsStore();
  return useSyncExternalStore(store.subscribeAll, store.getCatalog);
}

/** ¿Hay portadas en el catálogo en uso (detalles y sin el *kill switch* `covers`)? */
export function useCoversAvailable(): boolean {
  const store = useDetailsStore();
  return useSyncExternalStore(store.subscribeAll, store.coversAvailable);
}

/** ¿Alguna portada espera al aviso de primera capa? */
export function useCoverDemand(): boolean {
  const store = useDetailsStore();
  return useSyncExternalStore(store.subscribeAll, store.hasCoverDemand);
}

// Un único `IntersectionObserver` para todas las portadas de las filas.
const nearCallbacks = new WeakMap<Element, () => void>();
let observer: IntersectionObserver | null = null;

function nearObserver(): IntersectionObserver {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) if (entry.isIntersecting) nearCallbacks.get(entry.target)?.();
    },
    { rootMargin: '600px 0px' },
  );
  return observer;
}

/** `true` en cuanto el elemento queda cerca de la pantalla (y ya no vuelve a `false`). */
export function useNearViewport(ref: RefObject<Element | null>, enabled: boolean): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!enabled || near || !element) return;
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const io = nearObserver();
    nearCallbacks.set(element, () => setNear(true));
    io.observe(element);
    return () => {
      io.unobserve(element);
      nearCallbacks.delete(element);
    };
  }, [ref, enabled, near]);
  return near;
}
