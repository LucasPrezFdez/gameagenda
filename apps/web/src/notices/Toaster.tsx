import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useServices } from '../app/services.tsx';
import { Icon } from '../components/icons.tsx';
import { es } from '../i18n/es.ts';
import { measureFeedback } from '../perf/measures.ts';
import { NOTICE_MS, type Notice } from './notice-center.ts';

/** Lo que dura la salida del aviso («toast-out», shell.css); con «reducir movimiento» no se ve. */
const LEAVE_MS = 130;

/** Aviso con Deshacer: `role="status"` siempre montado para que los lectores lo anuncien. */
export function Toaster() {
  const { notices } = useServices();
  const notice = useSyncExternalStore(notices.subscribe, notices.getSnapshot);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const remaining = useRef(NOTICE_MS);
  const paused = focused || hovered;
  // El aviso que caduca se queda un momento más para irse con su animación (DECISIONES §10.44).
  // Si lo sustituye otro, no: el nuevo entra en su sitio.
  // Se decide al pintar (no en un efecto) para que no haya un fotograma sin aviso entre medias.
  const [previous, setPrevious] = useState(notice);
  const [leaving, setLeaving] = useState<Notice | null>(null);
  if (previous !== notice) {
    setPrevious(notice);
    setLeaving(notice === null ? previous : null);
  }
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setLeaving(null), LEAVE_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  // Primer fotograma con la confirmación: cierra `ui:feedback` y `capture:palette-to-confirm`.
  useLayoutEffect(() => {
    remaining.current = NOTICE_MS;
    if (notice?.timing) measureFeedback(notice.timing);
  }, [notice]);

  useEffect(() => {
    if (!notice || paused) return;
    const started = performance.now();
    const timer = setTimeout(() => notices.dismiss(notice.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (performance.now() - started));
    };
  }, [notice, paused, notices]);

  const shown = notice ?? leaving;
  const isLeaving = notice === null && leaving !== null;

  return (
    <div
      className="toaster"
      data-paused={paused ? '' : undefined}
      role="status"
      aria-label={es.toast.region}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      {shown && (
        <div className={isLeaving ? 'toast is-leaving' : 'toast'} key={shown.id} inert={isLeaving}>
          <p className="toast__message">{shown.message}</p>
          {shown.undoId !== null && notices.undoStack.has(shown.undoId) && (
            <button
              type="button"
              className="btn btn--ghost toast__undo"
              onClick={(event) => {
                notices.undoNotice(shown, { feedbackStart: event.timeStamp });
                // El botón desaparece: el foco pasa al contenido en vez de perderse.
                document.getElementById('main')?.focus({ preventScroll: true });
              }}
            >
              <Icon name="undo" />
              {es.toast.undo}
            </button>
          )}
          {shown.actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className="btn btn--ghost toast__action"
              onClick={() => {
                notices.dismiss(shown.id);
                document.getElementById('main')?.focus({ preventScroll: true });
                action.run();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
