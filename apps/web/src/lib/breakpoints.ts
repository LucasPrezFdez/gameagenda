// Puntos de corte de la maqueta que también necesita JavaScript. Son las mismas condiciones que las
// hojas de estilos; la tabla completa está al principio de `styles/tokens.css`.

/** Un móvil en horizontal (844 × 390, 932 × 430…): táctil y bajo. Lleva la maqueta del móvil. */
const SHORT_TOUCH = '(max-height: 500px) and (pointer: coarse)';

/** Cabecera arriba, cápsula abajo, la paleta como hoja y la ficha a pantalla completa. */
export const MOBILE_MEDIA = `(max-width: 767px), ${SHORT_TOUCH}`;

/** Lo contrario de `MOBILE_MEDIA`: la barra lateral. */
export const DESKTOP_MEDIA = `(min-width: 768px) and (not (${SHORT_TOUCH}))`;

/** Tablet (768–1 023 px): la barra lateral, encogida por defecto (`sidebarCollapsedNarrow`). */
export const NARROW_DESKTOP_MEDIA = `(min-width: 768px) and (max-width: 1023px) and (not (${SHORT_TOUCH}))`;

/** La ficha, al lado de la lista y no superpuesta. */
export const WIDE_MEDIA = `(min-width: 1280px) and (not (${SHORT_TOUCH}))`;
