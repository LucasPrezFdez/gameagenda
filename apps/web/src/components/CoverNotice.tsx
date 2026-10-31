// Aviso de primera capa de las portadas (§9.9 y §11.2): sale antes de la primera portada (CA2.7),
// solo informa y ofrece desactivarlas. Las portadas esperan (`coverNotice: 'unseen'`) hasta que el
// aviso se ha pintado; después se cargan, y el aviso sigue a la vista hasta que se cierra. Va fijo
// abajo, debajo del aviso con Deshacer: no empuja la lista (§9.5, regla 3).
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useServices, useSettings } from '../app/services.tsx';
import { useCoverDemand, useCoversAvailable } from '../details/details-context.tsx';
import { es } from '../i18n/es.ts';
import { Link } from '../router/router.tsx';
import { settingsPath } from '../router/routes.ts';

/** Hueco entre este aviso y el de Deshacer, que va encima (px). */
const NOTICE_GAP = 8;

/** Tras el primer fotograma con el aviso pintado. */
function afterPaint(task: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const frame = requestAnimationFrame(() => {
    timer = setTimeout(task, 0);
  });
  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
  };
}

export function CoverNotice({ hidden }: { hidden: boolean }) {
  const { settings } = useServices();
  const { loadCovers, coverNotice } = useSettings();
  const demand = useCoverDemand();
  const available = useCoversAvailable();
  const coversOn = loadCovers && available;
  const visible =
    !hidden && coversOn && (coverNotice === 'shown' || (coverNotice === 'unseen' && demand));

  useEffect(() => {
    if (!visible || coverNotice !== 'unseen') return;
    return afterPaint(() => settings.update({ coverNotice: 'shown' }));
  }, [visible, coverNotice, settings]);

  // Lo que sube el aviso de Deshacer: el alto de este más el hueco (por CSSOM: la CSP no admite
  // estilos en línea). Con la paleta abierta no se pinta (alto 0) y se queda la última medida:
  // cada cambio de una propiedad de la raíz recalcula los estilos de toda la página.
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!visible || !element) return;
    const root = document.documentElement;
    const measure = () => {
      const height = element.offsetHeight;
      if (height > 0) root.style.setProperty('--cover-notice-space', `${height + NOTICE_GAP}px`);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      root.style.removeProperty('--cover-notice-space');
    };
  }, [visible]);

  if (!visible) return null;

  /** El aviso se va con el foco dentro: el foco pasa a la pantalla (WCAG 2.4.11). */
  function close(patch: { loadCovers?: boolean }): void {
    settings.update({ ...patch, coverNotice: 'done' });
    requestAnimationFrame(() => document.getElementById('main')?.focus({ preventScroll: true }));
  }

  return (
    <section ref={ref} className="cover-notice notice" aria-label={es.coverNotice.label}>
      <p>{es.coverNotice.text}</p>
      <div className="cover-notice__actions">
        <Link to={settingsPath('privacy')} className="btn btn--ghost">
          {es.coverNotice.moreInfo}
        </Link>
        <button type="button" className="btn" onClick={() => close({ loadCovers: false })}>
          {es.coverNotice.disable}
        </button>
        <button type="button" className="btn btn--primary" onClick={() => close({})}>
          {es.coverNotice.ok}
        </button>
      </div>
    </section>
  );
}
