// Lo que comparten las piezas de Ajustes › Cuenta y sincronización (`SyncPanel.tsx` y
// `AccountPanel.tsx`): el resultado de una operación de `SyncService`, el foco tras un cambio
// de vista y la confirmación en el sitio (nunca un modal, §9.6).
import { useId, useState } from 'react';
import { logError } from '../../errors/error-log.ts';
import { es } from '../../i18n/es.ts';
import { SyncError, type SyncErrorCode } from '../../sync/types.ts';

const t = es.syncPanel;

export type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: SyncErrorCode };

/** Una operación de `SyncService`: un `SyncError` es un resultado; lo demás va al registro. */
export async function attempt<T>(run: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    if (error instanceof SyncError) return { ok: false, code: error.code };
    logError('storage', error);
    return { ok: false, code: 'internal' };
  }
}

/**
 * Lleva el foco a `id` en cuanto exista (tras un cambio de vista puede tardar un fotograma). Los
 * encabezados que lo reciben llevan `tabIndex={-1}` (WCAG 2.4.3).
 */
export function focusWhenReady(id: string, tries = 10): void {
  const element = document.getElementById(id);
  if (element) {
    element.focus();
    return;
  }
  if (tries > 0) requestAnimationFrame(() => focusWhenReady(id, tries - 1));
}

export function describedBy(...ids: (string | false | null | undefined)[]): string | undefined {
  const list = ids.filter((id): id is string => typeof id === 'string' && id !== '');
  return list.length > 0 ? list.join(' ') : undefined;
}

/** Una acción con confirmación en el sitio (sin modal, §9.6). `run` devuelve el error, o `null`. */
export function ConfirmAction({
  headingId,
  title,
  intro,
  action,
  question,
  confirm,
  busyLabel,
  danger,
  run,
}: {
  headingId: string;
  title: string;
  intro: string;
  action: string;
  question: string;
  confirm: string;
  /** El texto del botón de confirmar mientras espera («Desemparejando…»). */
  busyLabel: string;
  danger: boolean;
  run: () => Promise<string | null>;
}) {
  const id = useId();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function go(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const error = await run();
    setBusy(false);
    if (error !== null) setFailure(error);
    else setConfirming(false);
  }

  return (
    <section className="sync__block" aria-labelledby={headingId}>
      <h3 id={headingId} tabIndex={-1} className="settings__subtitle">
        {title}
      </h3>
      <p>{intro}</p>
      {confirming ? (
        // biome-ignore lint/a11y/useSemanticElements: una confirmación con su pregunta y dos botones, no un formulario.
        <div className="sync__confirm" role="group" aria-labelledby={`${id}-question`}>
          <p id={`${id}-question`}>{question}</p>
          <div className="settings__buttons">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setConfirming(false);
                setFailure(null);
                focusWhenReady(`${id}-start`);
              }}
            >
              {t.cancel}
            </button>
            <button
              id={`${id}-do`}
              type="button"
              className={danger ? 'btn btn--danger' : 'btn btn--primary'}
              aria-disabled={busy}
              onClick={() => void go()}
            >
              {busy ? busyLabel : confirm}
            </button>
          </div>
          <div className="settings__import-result" role="status">
            {failure !== null && <p className="sync__error">{failure}</p>}
          </div>
        </div>
      ) : (
        <div className="settings__buttons">
          <button
            id={`${id}-start`}
            type="button"
            className={danger ? 'btn btn--danger' : 'btn'}
            onClick={() => {
              setConfirming(true);
              focusWhenReady(`${id}-do`);
            }}
          >
            {action}
          </button>
        </div>
      )}
    </section>
  );
}
