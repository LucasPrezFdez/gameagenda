// App de escritorio para Windows (§17.3 de prototipe.md; ADR-010). La web no importa Tauri ni le
// habla (CA3.8): al pulsar `Ctrl+Mayús+Espacio`, la parte nativa pone la ventana delante y ejecuta
// en la página `window.dispatchEvent(new Event('gameagenda:capture'))`. Aquí se atiende ese evento
// fijo: la paleta se abre con el foco sobre Mi lista, como `/apuntar`, sin recargar la página.
// Cualquier *script* de la página podría lanzarlo, pero solo abre la paleta.
import type { Route } from '../router/routes.ts';

/** El mismo nombre que `CAPTURE_SCRIPT` en `apps/desktop/src-tauri/src/main.rs`. */
export const DESKTOP_CAPTURE_EVENT = 'gameagenda:capture';

/**
 * En Mi lista (o ya en `/apuntar`) la paleta se abre ahí mismo y se conservan los filtros de la
 * URL; desde otra pantalla se va a `/apuntar`, que la abre sobre Mi lista.
 */
export function desktopCaptureTarget(route: Route): 'here' | '/apuntar' {
  return route.name === 'list' || route.name === 'capture' ? 'here' : '/apuntar';
}

/** Escucha el evento del atajo; `onCapture` recibe su `timeStamp`. Devuelve la función que para. */
export function onDesktopCapture(
  target: EventTarget,
  onCapture: (timeStamp: number) => void,
): () => void {
  const listener = (event: Event): void => onCapture(event.timeStamp);
  target.addEventListener(DESKTOP_CAPTURE_EVENT, listener);
  return () => target.removeEventListener(DESKTOP_CAPTURE_EVENT, listener);
}
