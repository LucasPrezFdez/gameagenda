// Enlace del QR de emparejamiento (M4; §11.4): `/emparejar#<código>`. Al arrancar, antes de pintar
// y de tocar la red, la app guarda el código en memoria y cambia la entrada del historial por la de
// Ajustes › Sincronización, sin fragmento: el código no se queda en la barra de direcciones, en el
// historial ni en las pestañas recientes. Canjearlo es un POST después de pulsar «Emparejar este
// dispositivo» (`SyncPanel.tsx`), nunca solo al abrir el enlace: una vista previa de enlaces lo
// gastaría. Sin Zod ni DOM: va en el *chunk* inicial y se prueba con Vitest.
import { PAIR_PATH, pairingCodeFromHash, settingsPath } from './routes.ts';

let pending: string | null = null;

export interface LocationLike {
  readonly pathname: string;
  readonly hash: string;
}

export interface HistoryLike {
  readonly state: unknown;
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

/** Guarda el código de un enlace de emparejamiento hasta que lo recoja Ajustes. */
export function stashPairingCode(code: string | null): void {
  pending = code;
}

/** El código guardado, sin gastarlo (para leerlo al pintar: React puede pintar dos veces). */
export function peekPendingPairingCode(): string | null {
  return pending;
}

/** El código del último enlace abierto, una sola vez (después, `null`). */
export function takePendingPairingCode(): string | null {
  const code = pending;
  pending = null;
  return code;
}

/**
 * Si la página se ha abierto en `/emparejar…`, guarda el código del fragmento y cambia la entrada
 * del historial por `/ajustes/sincronizacion` (conserva su `state`). Devuelve si lo ha hecho.
 */
export function takePairingLink(location: LocationLike, history: HistoryLike): boolean {
  const path =
    location.pathname.length > 1 ? location.pathname.replace(/\/+$/, '') : location.pathname;
  if (path !== PAIR_PATH) return false;
  stashPairingCode(pairingCodeFromHash(location.hash));
  history.replaceState(history.state, '', settingsPath('sync'));
  return true;
}
