// Ganchos de los E2E de la sincronización (ver §12.3). Solo los usa el *build* del modo `e2e`: en
// el de producción, `import.meta.env.MODE` no es `e2e` y este módulo queda fuera del *bundle*.
// - Opciones: las pruebas pueden fijar `globalThis.__GA_SYNC_TEST__` con `page.addInitScript`
//   antes de cargar la página (por ejemplo, esperas más cortas).
// - Estado: `globalThis.__gaSync` da el estado, el número de rondas correctas y `syncNow()`, para
//   esperar sin `sleep`: `await page.evaluate(() => globalThis.__gaSync?.syncNow())`.
import type { RuntimeTimings } from './runtime.ts';
import type { SyncState } from './types.ts';

export interface SyncTestOptions {
  /** Esperas del planificador (de escritura, reintentos, Web Lock…), en ms. */
  readonly timings?: Partial<RuntimeTimings>;
}

export interface SyncTestHandle {
  /** El estado de `SyncService.getSnapshot()`. */
  readonly state: SyncState;
  /** Rondas de sincronización correctas desde que se cargó la página. */
  readonly successes: number;
  /** Sincroniza ya y espera a que acabe la ronda (no lanza; mira `state.error`). */
  syncNow(): Promise<void>;
  /** Espera a que no haya ronda ni restauración en marcha. */
  idle(): Promise<void>;
}

declare global {
  var __GA_SYNC_TEST__: SyncTestOptions | undefined;
  var __gaSync: SyncTestHandle | undefined;
}

export function syncTestOptions(): SyncTestOptions {
  return globalThis.__GA_SYNC_TEST__ ?? {};
}

export function installSyncTestHooks(handle: SyncTestHandle): void {
  globalThis.__gaSync = handle;
}
