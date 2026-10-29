// Ajustes en la tabla `settings` (una fila por clave) y al día entre pestañas.
import {
  parseSettings,
  type SettingsStorage,
  type SettingsStore,
} from '../settings/settings-store.ts';
import { onTableChange } from './changes.ts';
import type { GameAgendaDb } from './database.ts';

export interface DexieSettingsStorage extends SettingsStorage {
  /** Aplica a `store` lo que otra pestaña guarde (o borre). */
  watch(store: SettingsStore): () => void;
  /** Se resuelve cuando todo lo pendiente está guardado. */
  whenIdle(): Promise<void>;
}

export function createDexieSettingsStorage(
  db: GameAgendaDb,
  onError: (error: unknown) => void,
): DexieSettingsStorage {
  let chain: Promise<void> = Promise.resolve();
  let inFlight = 0;
  let version = 0;

  return {
    save(changes) {
      inFlight += 1;
      version += 1;
      chain = chain
        .then(() =>
          db.transaction('rw', db.settings, async () => {
            for (const [key, value] of Object.entries(changes)) {
              if (value === undefined) await db.settings.delete(key);
              else await db.settings.put({ key, value });
            }
          }),
        )
        .catch(onError)
        .finally(() => {
          inFlight -= 1;
        });
    },
    watch(store) {
      return onTableChange(db, 'settings', () => {
        const since = version;
        db.settings
          .toArray()
          .then((rows) => {
            // Un cambio local más nuevo manda: su propio evento traerá lo guardado.
            if (inFlight > 0 || version !== since) return;
            store.replace(parseSettings(Object.fromEntries(rows.map((r) => [r.key, r.value]))));
          })
          .catch(onError);
      });
    },
    whenIdle: () => chain,
  };
}
