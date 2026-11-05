// Iconos SVG incrustados (§9.8). Los de la interfaz son trazos basados en Lucide (licencia ISC).
// Los de estado y marcas son los macizos («fill») de Phosphor Icons 2.1.1 (licencia MIT): en la
// interfaz monocroma son lo único con color, y una forma llena se lee mejor que un contorno a
// 14–18 px. Se eligieron frente a Fluent, Tabler, Heroicons y unos propios
// (docs/diseno/rediseno-visual/propuesta.md). Avisos de las licencias: public/licencias.txt.
// Dos marcas van a varias tintas, a petición del usuario. Platinado es un trofeo propio con la forma
// clásica de los de PlayStation (copa, asas en bucle, tallo y peana; no el dibujo de Sony), en
// platino. Próximo es la «push-pin» de Phosphor partida en cabeza roja y aguja. Sin la marca puesta
// van en el color del texto, como los demás; los colores los pone base.css con la marca puesta.
import type { ReactNode } from 'react';
import type { Flag, Status } from '../agenda/types.ts';

/** Un icono macizo de Phosphor (rejilla de 256) dentro de la de 24 de los demás, sin trazo. */
function phosphor(d: string): ReactNode {
  return <path fill="currentColor" stroke="none" transform="scale(.09375)" d={d} />;
}

export type IconName =
  | Status
  | Flag
  | 'plus'
  | 'info'
  | 'more'
  | 'close'
  | 'back'
  | 'chevronDown'
  | 'chevronRight'
  | 'search'
  | 'list'
  | 'catalog'
  | 'settings'
  | 'undo'
  | 'offline'
  | 'pencil'
  | 'keyboard'
  | 'grip'
  | 'clipboard';

const PATHS: Readonly<Record<IconName, ReactNode>> = {
  // Phosphor «bookmark-simple»
  want_to_play: phosphor(
    'M184,32H72A16,16,0,0,0,56,48V224a8,8,0,0,0,12.24,6.78L128,193.43l59.77,37.35A8,8,0,0,0,200,224V48A16,16,0,0,0,184,32Z',
  ),
  // Phosphor «play»
  playing: phosphor(
    'M240,128a15.74,15.74,0,0,1-7.6,13.51L88.32,229.65a16,16,0,0,1-16.2.3A15.86,15.86,0,0,1,64,216.13V39.87a15.86,15.86,0,0,1,8.12-13.82,16,16,0,0,1,16.2.3L232.4,114.49A15.74,15.74,0,0,1,240,128Z',
  ),
  // Phosphor «pause»
  on_hold: phosphor(
    'M216,48V208a16,16,0,0,1-16,16H160a16,16,0,0,1-16-16V48a16,16,0,0,1,16-16h40A16,16,0,0,1,216,48ZM96,32H56A16,16,0,0,0,40,48V208a16,16,0,0,0,16,16H96a16,16,0,0,0,16-16V48A16,16,0,0,0,96,32Z',
  ),
  // Phosphor «check-circle»
  completed: phosphor(
    'M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm45.66,85.66-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35a8,8,0,0,1,11.32,11.32Z',
  ),
  // Phosphor «prohibit-inset»
  dropped: phosphor(
    'M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm37.66,141.66a8,8,0,0,1-11.32,0l-64-64a8,8,0,0,1,11.32-11.32l64,64A8,8,0,0,1,165.66,165.66Z',
  ),
  // Trofeo propio: copa, asas, tallo con collarín y peana; sombra a la derecha y brillo a la izquierda
  platinum: (
    <>
      <path
        className="icon-trophy__body"
        d="M5.5 3h13v3.25c0 3.7-2.6 6.75-6.1 7.2h-.8C8.1 13 5.5 9.95 5.5 6.25zM11 13.3h2l.35 3.2h-2.7zM9.75 16.4h4.5a.6.6 0 0 1 .6.6v.5h-5.7v-.5a.6.6 0 0 1 .6-.6zM6.75 17.9h10.5a.75.75 0 0 1 .75.75v1.85a.75.75 0 0 1-.75.75H6.75a.75.75 0 0 1-.75-.75v-1.85a.75.75 0 0 1 .75-.75z"
      />
      <path
        className="icon-trophy__handle"
        d="M5.6 4.6H4.25A1.75 1.75 0 0 0 2.5 6.35c0 2.6 2.1 4.6 4.6 4.9M18.4 4.6h1.35a1.75 1.75 0 0 1 1.75 1.75c0 2.6-2.1 4.6-4.6 4.9"
      />
      <path
        className="icon-trophy__shade"
        d="M15.1 3.9h2.5v2.35c0 3.05-1.95 5.6-4.8 6.45 1.45-1.65 2.3-3.95 2.3-6.45zM14.6 18.75h2.6v1.75h-2.6z"
      />
      <path
        className="icon-trophy__shine"
        d="M7.6 4.4h1.5v1.9c0 2.3.9 4.3 2.4 5.6-2.4-.5-3.9-2.9-3.9-5.6zM7.4 18.75h3.2v.7H7.4z"
      />
    </>
  ),
  // Phosphor «bag-simple»
  owned: phosphor(
    'M216,64H176a48,48,0,0,0-96,0H40A16,16,0,0,0,24,80V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V80A16,16,0,0,0,216,64ZM128,32a32,32,0,0,1,32,32H96A32,32,0,0,1,128,32Z',
  ),
  // Phosphor «push-pin», partida: aguja, cabeza y su brillo
  next: (
    <g transform="scale(.09375)">
      <path
        className="icon-pin__needle"
        strokeWidth="18"
        strokeLinecap="round"
        d="M90.6 165.4 46 210"
      />
      <path
        className="icon-pin__head"
        d="M235.33,104l-53.47,53.65c4.56,12.67,6.45,33.89-13.19,60A15.93,15.93,0,0,1,157,224c-.38,0-.75,0-1.13,0a16,16,0,0,1-11.32-4.69L96.29,171,85,159.71l-48.3-48.3A16,16,0,0,1,38,87.63c25.42-20.51,49.75-16.48,60.4-13.14L152,20.7a16,16,0,0,1,22.63,0l60.69,60.68A16,16,0,0,1,235.33,104Z"
      />
      <path className="icon-pin__shine" d="M165 40a14 14 0 1 1 0 .1z" />
    </g>
  ),
  plus: <path d="M5 12h14M12 5v14" />,
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </>
  ),
  more: (
    <>
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </>
  ),
  close: <path d="M18 6 6 18M6 6l12 12" />,
  back: <path d="m15 18-6-6 6-6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronRight: <path d="m9 18 6-6-6-6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  list: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle fill="currentColor" cx="4.5" cy="6" r=".6" />
      <circle fill="currentColor" cx="4.5" cy="12" r=".6" />
      <circle fill="currentColor" cx="4.5" cy="18" r=".6" />
    </>
  ),
  catalog: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
    </>
  ),
  settings: (
    <>
      <path d="M20 7h-9M14 17H5" />
      <circle cx="17" cy="17" r="3" />
      <circle cx="7" cy="7" r="3" />
    </>
  ),
  undo: (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </>
  ),
  offline: (
    <>
      <path d="M12 20h.01M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 5.2-2.7" />
      <path d="M19 12.9a10 10 0 0 0-2.1-1.6M2 8.8a15 15 0 0 1 4.2-2.7M22 8.8a15 15 0 0 0-11.3-3.8" />
      <path d="m2 2 20 20" />
    </>
  ),
  pencil: (
    <path d="M21.2 6.8a1 1 0 0 0-4-4L3.8 16.2a2 2 0 0 0-.5.8l-1.3 4.4a.5.5 0 0 0 .6.6l4.4-1.3a2 2 0 0 0 .8-.5z" />
  ),
  // Teclado (ayuda de atajos)
  keyboard: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M10 13h4M8 16h8" />
    </>
  ),
  // Portapapeles (chip «Pegar enlace»)
  clipboard: (
    <>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    </>
  ),
  // Asa `::` para arrastrar (seis puntos)
  grip: (
    <>
      <circle cx="9" cy="6" r="1" />
      <circle cx="9" cy="12" r="1" />
      <circle cx="9" cy="18" r="1" />
      <circle cx="15" cy="6" r="1" />
      <circle cx="15" cy="12" r="1" />
      <circle cx="15" cy="18" r="1" />
    </>
  ),
};

export function Icon({ name, className = 'icon' }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
