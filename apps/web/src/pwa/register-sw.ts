// Registro del Service Worker desde la app con `workbox-window` (`injectRegister: false`, ver
// §6.1): nada de `<script>` en línea, que la CSP no admite (ver §11.3). Una versión nueva entra
// sola cuando no se nota (`update-policy.ts`; §5.2).
import { logError } from '../errors/error-log.ts';
import { type ApplyResult, createUpdatePolicy } from './update-policy.ts';

export interface ServiceWorkerOptions {
  /** Hay algo a medias que una recarga perdería o que se notaría (`work-in-progress.ts`). */
  readonly isBusy: () => boolean;
}

/** Lo que espera la página a que el Service Worker nuevo tome el relevo tras pedírselo. */
const ACTIVATE_TIMEOUT_MS = 10_000;
/** El mensaje que entiende `sw.ts`. */
const SKIP_WAITING = { type: 'SKIP_WAITING' } as const;

export function registerServiceWorker(options: ServiceWorkerOptions): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  // Tras la carga, para no competir con el primer pintado; `workbox-window` va en su *chunk*.
  window.addEventListener(
    'load',
    () => {
      import('workbox-window')
        .then(({ Workbox }) => new Workbox('/sw.js').register())
        .then((registration) => {
          if (registration) watchUpdates(registration, options);
        })
        .catch((error: unknown) => logError('window', error));
    },
    { once: true },
  );
}

function watchUpdates(
  registration: ServiceWorkerRegistration,
  options: ServiceWorkerOptions,
): void {
  const container = navigator.serviceWorker;
  // En la primera visita, `clients.claim()` cambia el controlador: eso no es una versión nueva.
  let controlled = container.controller !== null;
  /** La página ha pedido el relevo y lo espera. */
  let switching = false;
  /** Otra pestaña ha puesto la versión nueva: esta sigue con el código anterior. */
  let stale = false;

  const policy = createUpdatePolicy({
    isHidden: () => document.visibilityState === 'hidden',
    onVisibilityChange(listener) {
      document.addEventListener('visibilitychange', listener);
      return () => document.removeEventListener('visibilitychange', listener);
    },
    isBusy: options.isBusy,
    apply,
    // Sin red falla, y no es un error de la app.
    check: () => void registration.update().catch(() => undefined),
    now: () => Date.now(),
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  });

  container.addEventListener('controllerchange', () => {
    if (!controlled) {
      controlled = true;
      return;
    }
    if (switching) return;
    stale = true;
    policy.pending();
  });

  // Una versión nueva queda en `installed` (en espera) cuando ya hay otra controlando la página.
  const watch = (worker: ServiceWorker | null): void => {
    if (!worker) return;
    const onState = (): void => {
      if (worker.state === 'installed' && container.controller) policy.pending();
    };
    worker.addEventListener('statechange', onState);
    onState();
  };
  watch(registration.waiting);
  watch(registration.installing);
  registration.addEventListener('updatefound', () => watch(registration.installing));

  async function apply(): Promise<ApplyResult> {
    const waiting = registration.waiting;
    if (!waiting) {
      if (!stale) return 'nothing';
      window.location.reload();
      return 'reloading';
    }
    switching = true;
    const changed = await new Promise<boolean>((resolve) => {
      const onChange = (): void => {
        clearTimeout(timer);
        container.removeEventListener('controllerchange', onChange);
        resolve(true);
      };
      // `sw.ts` no lo hace si otra ventana de la app está a la vista.
      const timer = setTimeout(() => {
        container.removeEventListener('controllerchange', onChange);
        resolve(false);
      }, ACTIVATE_TIMEOUT_MS);
      container.addEventListener('controllerchange', onChange);
      waiting.postMessage(SKIP_WAITING);
    });
    switching = false;
    if (!changed) return 'retry';
    window.location.reload();
    return 'reloading';
  }
}
