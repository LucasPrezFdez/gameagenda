import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useServices } from '../app/services.tsx';
import { Icon } from '../components/icons.tsx';
import { es } from '../i18n/es.ts';
import { measureFeedback } from '../perf/measures.ts';
import { NOTICE_MS } from './notice-center.ts';

/** Aviso con Deshacer: `role="status"` siempre montado para que los lectores lo anuncien. */
export function Toaster() {
  const { notices } = useServices();
  const notice = useSyncExternalStore(notices.subscribe, notices.getSnapshot);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const remaining = useRef(NOTICE_MS);
  const paused = focused || hovered;

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

  return (
    <div
      className="toaster"
      role="status"
      aria-label={es.toast.region}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      {notice && (
        <div className="toast" key={notice.id}>
          <p className="toast__message">{notice.message}</p>
          {notice.undoId !== null && notices.undoStack.has(notice.undoId) && (
            <button
              type="button"
              className="btn btn--ghost toast__undo"
              onClick={(event) => {
                notices.undoNotice(notice, { feedbackStart: event.timeStamp });
                // El botón desaparece: el foco pasa al contenido en vez de perderse.
                document.getElementById('main')?.focus({ preventScroll: true });
              }}
            >
              <Icon name="undo" />
              {es.toast.undo}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
