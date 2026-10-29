// Registro del Service Worker desde la app con `workbox-window` (`injectRegister: false`, ver
// §6.1): nada de `<script>` en línea, que la CSP no admite (ver §11.3).
import { logError } from '../errors/error-log.ts';

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  // Tras la carga, para no competir con el primer pintado; `workbox-window` va en su *chunk*.
  window.addEventListener(
    'load',
    () => {
      import('workbox-window')
        .then(({ Workbox }) => new Workbox('/sw.js').register())
        .catch((error: unknown) => logError('window', error));
    },
    { once: true },
  );
}
