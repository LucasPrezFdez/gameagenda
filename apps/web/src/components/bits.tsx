// Piezas pequeñas compartidas: portada generada, insignias de marcas y de estado.
import { type AgendaEntry, FLAGS, type Status } from '../agenda/types.ts';
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

/** Portada generada con CSS (iniciales y color), en 2:3 (ver §9.5, regla 5). */
export function Cover({ title, size = 'row' }: { title: string; size?: 'row' | 'sheet' }) {
  return (
    <span
      className={`cover cover--${size} cover--t${hash(title) % COVER_TONES}`}
      aria-hidden="true"
    >
      {initialsOf(title)}
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
