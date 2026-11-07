// Mi lista vacía mientras vuelve la agenda sincronizada (M4; CA4.3): con IndexedDB borrada y la
// cookie de dispositivo viva, la agenda baja sola del servidor. El estado vacío lo dice en vez de
// «Tu agenda está vacía». Todos sus textos ocupan la misma celda (`MyListScreen.tsx`), así que
// cambiar de uno a otro no mueve el botón de debajo (§9.5, regla 3).
import type { SyncState } from '../../sync/types.ts';

export type EmptyText = 'empty' | 'restoring' | 'restoringOffline' | 'restoringFailed';

/** Los textos que se turnan en el estado vacío de una agenda sincronizada. */
export const SYNCED_EMPTY_TEXTS: readonly EmptyText[] = [
  'empty',
  'restoring',
  'restoringOffline',
  'restoringFailed',
];

/** ¿Puede estar llegando la agenda? Solo con la sincronización activada (o su indicio). */
export function syncedEmptyState(state: SyncState): boolean {
  return state.status === 'paired' || state.status === 'restoring';
}

/**
 * Qué dice Mi lista vacía. Antes de leer el estado guardado (unos ms tras pintar), `paired`
 * significa que hay indicio de emparejamiento: lo más probable con la lista vacía es que se esté
 * restaurando, y si no, el texto cambia sin mover nada.
 */
export function emptyTextOf(state: SyncState): EmptyText {
  const restoring = state.status === 'restoring' || (!state.ready && state.status === 'paired');
  if (!restoring) return 'empty';
  if (state.activity === 'offline') return 'restoringOffline';
  if (state.activity === 'error' || state.activity === 'disabled') return 'restoringFailed';
  return 'restoring';
}
