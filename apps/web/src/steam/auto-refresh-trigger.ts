// Cuándo se pone al día Steam vinculado (ADR-014), en el *chunk* inicial: pesa poco y no importa
// nada de Steam. Cuando toca, `run` carga `auto-refresh.ts`, que trae la biblioteca y la aplica.
//
// Toca si se cumple todo esto:
// - la página está a la vista y hay red;
// - el dispositivo sincroniza y ya ha hecho una ronda buena en esta sesión: así lo quitado en otro
//   dispositivo ya ha llegado y la importación no lo vuelve a añadir;
// - «Actualizar sola» está encendido (`meta.account.steamAuto`, encendido por defecto);
// - hace 24 h de la última vez, o 7 días si la última vez la agenda no tenía vínculo (así se entera
//   de que se ha vinculado desde otro dispositivo sin preguntar cada día).
// Se mira al hacer esa ronda y cada vez que la app vuelve a la vista (la de escritorio pasa días en
// la bandeja). La hora se apunta antes de pedir nada: un fallo espera a la próxima vez.

import type { SyncService } from '../sync/types.ts';

/** `STEAM_AUTO_REFRESH_MS` de core (escrito a mano para no arrastrar Zod; una prueba los compara). */
export const AUTO_REFRESH_MS = 24 * 3_600_000;
/** Sin vínculo, se vuelve a mirar a la semana. */
export const UNLINKED_RECHECK_MS = 7 * 24 * 3_600_000;

export interface TriggerEnv {
  readonly doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
  readonly now: () => number;
  readonly isOnline: () => boolean;
  readonly onError?: (error: unknown) => void;
}

function browserEnv(): TriggerEnv {
  return { doc: document, now: Date.now, isOnline: () => navigator.onLine !== false };
}

/** Empieza a mirar; devuelve cómo dejar de hacerlo (pruebas). */
export function startSteamAutoRefresh(
  sync: Pick<SyncService, 'getSnapshot' | 'subscribe' | 'localAccount' | 'updateLocalAccount'>,
  run: () => Promise<unknown>,
  env: TriggerEnv = browserEnv(),
): () => void {
  const startedAt = env.now();
  let running = false;
  // Hasta cuándo no hace falta ni mirar `meta.account` (el estado cambia a menudo al sincronizar).
  // Al volver a la vista se mira igual: «Actualizar sola» puede haber cambiado en otra pestaña.
  let notBefore = 0;

  async function check(fromVisibility = false): Promise<void> {
    if (running || env.doc.visibilityState !== 'visible' || !env.isOnline()) return;
    if (!fromVisibility && env.now() < notBefore) return;
    const state = sync.getSnapshot();
    if (state.status !== 'paired' || state.lastSyncAt === null || state.lastSyncAt < startedAt) {
      return;
    }
    running = true;
    try {
      const account = await sync.localAccount();
      const wait = account.steamLinked ? AUTO_REFRESH_MS : UNLINKED_RECHECK_MS;
      const now = env.now();
      if (!account.steamAuto) {
        notBefore = now + AUTO_REFRESH_MS;
        return;
      }
      if (account.steamCheckedAt !== null && now - account.steamCheckedAt < wait) {
        notBefore = account.steamCheckedAt + wait;
        return;
      }
      notBefore = now + AUTO_REFRESH_MS;
      await sync.updateLocalAccount({ steamCheckedAt: now });
      await run();
    } catch (error) {
      env.onError?.(error);
    } finally {
      running = false;
    }
  }

  const onVisibility = () => void check(true);
  const unsubscribe = sync.subscribe(() => void check());
  env.doc.addEventListener('visibilitychange', onVisibility);
  void check();
  return () => {
    unsubscribe();
    env.doc.removeEventListener('visibilitychange', onVisibility);
  };
}
