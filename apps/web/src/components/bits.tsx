// Piezas pequeñas compartidas: portada, insignias de marcas y de estado.
import { useEffect, useMemo, useRef, useState } from 'react';
import { type AgendaEntry, FLAGS, type Status } from '../agenda/types.ts';
import { coverCandidates } from '../details/cover-url.ts';
import {
  useCoverMode,
  useDetailsStore,
  useGameDetails,
  useNearViewport,
} from '../details/details-context.tsx';
import { es } from '../i18n/es.ts';
import { Icon } from './icons.tsx';

const COVER_TONES = 8;

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function initialsOf(title: string): string {
  const words = title
    .replace(/['’‘‛ʼʻ`´′＇]/g, '')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const letters = words.slice(0, 2).map((word) => [...word][0] ?? '');
  return letters.join('').toLocaleUpperCase('es-ES') || '?';
}

export interface CoverProps {
  readonly title: string;
  /** Juego de Steam; sin él (juego manual), siempre la portada generada. */
  readonly appid?: number | null;
  readonly size?: 'row' | 'sheet' | 'palette';
  /**
   * ¿Puede pedir sus detalles? La paleta solo los pide tras 150 ms sin teclear (§9.5, regla 5);
   * sin pedirlos, enseña lo que ya se sepa.
   */
  readonly load?: boolean;
  /** ¿Saca el aviso de primera capa si aún no ha salido? (La paleta no: lo taparía.) */
  readonly notice?: boolean;
}

/**
 * Portada en un hueco fijo de 2:3 (§9.5, reglas 3 y 5): debajo, la generada con CSS (iniciales y
 * color); encima, `library_capsule` o, si falla, `header`, solo con URL de `asset_url_format`
 * (§4.10). Sin portadas (ajuste, *kill switch* o aviso aún sin ver), ninguna petición a Valve.
 */
export function Cover({
  title,
  appid = null,
  size = 'row',
  load = true,
  notice = true,
}: CoverProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const store = useDetailsStore();
  const mode = useCoverMode();
  const wanted = mode !== 'off' && appid !== null;
  // Las filas piden sus detalles al acercarse a la pantalla; la ficha y la paleta, ya.
  const near = useNearViewport(ref, wanted && size === 'row');
  const state = useGameDetails(wanted ? appid : null, load && (size !== 'row' || near));
  const sources = useMemo(
    () => (state.kind === 'ready' && state.details ? coverCandidates(state.details) : []),
    [state],
  );
  const key = sources.join(' ');
  const [attempt, setAttempt] = useState({ key: '', index: 0, loaded: false });
  const current = attempt.key === key ? attempt : { key, index: 0, loaded: false };
  const hasSource = sources.length > 0;

  useEffect(() => {
    if (mode === 'pending' && hasSource && notice) return store.wantCover();
  }, [mode, hasSource, notice, store]);

  const src = mode === 'on' ? sources[current.index] : undefined;
  const tone = hash(title) % COVER_TONES;
  return (
    <span
      ref={ref}
      className={`cover cover--${size} cover--t${tone}${src && current.loaded ? ' has-image' : ''}`}
      aria-hidden="true"
    >
      <span className="cover__initials">{initialsOf(title)}</span>
      {src && (
        <img
          key={src}
          className="cover__img"
          src={src}
          alt=""
          width={600}
          height={900}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          crossOrigin="anonymous"
          draggable={false}
          onLoad={() => setAttempt({ key, index: current.index, loaded: true })}
          onError={() => setAttempt({ key, index: current.index + 1, loaded: false })}
        />
      )}
    </span>
  );
}

/** Estado con icono, texto y color (WCAG 1.4.1). */
export function StatusText({ status }: { status: Status }) {
  return (
    <span className={`status-text status-text--${status}`}>
      <Icon name={status} />
      {es.status[status]}
    </span>
  );
}

/** Solo las marcas activas (ver §9.8). */
export function FlagBadges({ entry }: { entry: AgendaEntry }) {
  const active = FLAGS.filter((flag) => entry.flags[flag] === true);
  if (active.length === 0) return null;
  return (
    <span className="flag-badges">
      {active.map((flag) => (
        <span key={flag} className={`chip chip--${flag}`}>
          <Icon name={flag} />
          {es.flag[flag]}
        </span>
      ))}
    </span>
  );
}
