// Ayuda de atajos (`?`, o «Atajos de teclado» en el menú y en Ajustes; §9.4). Un `<dialog>`
// nativo con `showModal()`: deja inerte el resto, Esc lo cierra y el foco vuelve adonde estaba.
import { createContext, Fragment, useContext, useEffect, useId, useRef } from 'react';
import { FLAGS, type Flag, STATUSES, type Status } from '../agenda/types.ts';
import { useSettings } from '../app/services.tsx';
import { es } from '../i18n/es.ts';
import { navigate } from '../router/router.tsx';
import { settingsPath } from '../router/routes.ts';
import { type KeyCombo, shortcutGroups } from './keymap.ts';

const GROUPS = shortcutGroups({
  status: Object.fromEntries(STATUSES.map((s) => [s, es.shortcuts.statusTo(s)])) as Record<
    Status,
    string
  >,
  flag: Object.fromEntries(FLAGS.map((f) => [f, es.shortcuts.flagToggle(f)])) as Record<
    Flag,
    string
  >,
  text: es.shortcuts.text,
});

const OpenHelpContext = createContext<() => void>(() => undefined);

/** Lo da la carcasa: abre la ayuda (para el botón de Ajustes › Teclado y gestos). */
export const ShortcutHelpProvider = OpenHelpContext.Provider;

export function useOpenShortcutHelp(): () => void {
  return useContext(OpenHelpContext);
}

function Combo({ combo }: { combo: KeyCombo }) {
  return (
    <span className="shortcut-combo">
      {combo.keys.map((key, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: teclas fijas de una combinación.
        <Fragment key={index}>
          {index > 0 && (combo.sequence ? ` ${es.shortcuts.sequence} ` : '+')}
          <kbd>{key}</kbd>
        </Fragment>
      ))}
    </span>
  );
}

export function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const { singleKeyShortcuts } = useSettings();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnTo.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  function onDialogClose(): void {
    onClose();
    const target = returnTo.current;
    returnTo.current = null;
    if (target?.isConnected) target.focus();
  }

  return (
    <dialog ref={ref} className="shortcut-help" aria-labelledby={titleId} onClose={onDialogClose}>
      <div className="shortcut-help__header">
        <h2 id={titleId}>{es.shortcuts.title}</h2>
        <button type="button" className="btn btn--ghost" onClick={() => ref.current?.close()}>
          {es.shortcuts.close} <kbd>{es.palette.escKey}</kbd>
        </button>
      </div>
      <div className="shortcut-help__body">
        <p className="muted">{es.shortcuts.intro}</p>
        {!singleKeyShortcuts && (
          <p className="notice">
            {es.shortcuts.off}{' '}
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                returnTo.current = null;
                ref.current?.close();
                navigate(settingsPath('keyboard'));
              }}
            >
              {es.shortcuts.settings}
            </button>
          </p>
        )}
        {GROUPS.map((group) => (
          <table key={group.title} className="shortcut-table">
            <caption>{group.title}</caption>
            <tbody>
              {group.rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">
                    {row.combos.map((combo, index) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: alternativas fijas de una fila.
                      <Fragment key={index}>
                        {index > 0 && ` ${es.shortcuts.or} `}
                        <Combo combo={combo} />
                      </Fragment>
                    ))}
                  </th>
                  <td>{row.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    </dialog>
  );
}
