// `meta.copyReminder` (RNF-08): se guarda en segundo plano y está al día entre pestañas.
import {
  type CopyReminderState,
  type CopyReminderStore,
  parseCopyReminder,
} from '../data/copy-reminder.ts';
import { onTableChange } from './changes.ts';
import { type GameAgendaDb, META_KEYS } from './database.ts';

export interface DexieCopyReminderStorage {
  save(state: CopyReminderState): void;
  /** Aplica a `store` lo que otra pestaña guarde, o el borrado de «Borrar todos mis datos». */
  watch(store: CopyReminderStore): () => void;
  /** Se resuelve cuando todo lo pendiente está guardado. */
  whenIdle(): Promise<void>;
}

export function createDexieCopyReminderStorage(
  db: GameAgendaDb,
  onError: (error: unknown) => void,
): DexieCopyReminderStorage {
  let chain: Promise<void> = Promise.resolve();
  let inFlight = 0;
  let version = 0;

  return {
    save(state) {
      inFlight += 1;
      version += 1;
      chain = chain
        .then(async () => {
          await db.meta.put({ key: META_KEYS.copyReminder, value: state });
        })
        .catch(onError)
        .finally(() => {
          inFlight -= 1;
        });
    },
    watch(store) {
      return onTableChange(db, 'meta', (change) => {
        if ('ids' in change && !change.ids.includes(META_KEYS.copyReminder)) return;
        const since = version;
        db.meta
          .get(META_KEYS.copyReminder)
          .then((row) => {
            // Un cambio local más nuevo manda: su propio evento traerá lo guardado.
            if (inFlight > 0 || version !== since) return;
            store.replace(parseCopyReminder(row?.value));
          })
          .catch(onError);
      });
    },
    whenIdle: () => chain,
  };
}
