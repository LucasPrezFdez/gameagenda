// Gestos de M3 (§9.4; RF-15 y RF-16), sin DOM, para que se prueben en Vitest: deslizar una fila
// (→ avanza el estado, ← muestra las marcas), la pulsación larga, arrastrar `::` y ↓ en la hoja.
// Se activan al 40 % del ancho, se cancelan volviendo atrás antes de soltar (WCAG 2.5.2), vibran
// 10 ms donde se puede (Android) y respetan zonas muertas de 24 px en los dos bordes, las del gesto
// «atrás» del sistema. Ninguno borra, y cada uno tiene su botón (WCAG 2.5.1 y 2.5.7).
import type { Status } from '../agenda/types.ts';

/** Fracción del ancho a la que se activa un gesto. */
export const ACTIVATION = 0.4;
/** Zonas muertas en los bordes de la pantalla, en px. */
export const EDGE_DEAD_ZONE_PX = 24;
/** Hasta aquí, un toque; a partir de aquí se decide la dirección del gesto. */
export const SLOP_PX = 10;
export const LONG_PRESS_MS = 500;
export const HAPTIC_MS = 10;
/** Lo que se deja seguir al dedo hacia un lado sin acción, antes de volver. */
const RUBBER_BAND_PX = 24;

/**
 * El estado al que avanza una fila al deslizarla a la derecha, o `null` si ya no avanza:
 * Quiero jugar → Jugando («Empezar»), En pausa → Jugando («Retomar») y Jugando → Completado.
 */
export function advanceStatus(status: Status): Status | null {
  switch (status) {
    case 'want_to_play':
    case 'on_hold':
      return 'playing';
    case 'playing':
      return 'completed';
    case 'completed':
    case 'dropped':
      return null;
  }
}

/** ¿Empieza el gesto en una zona muerta, junto a un borde de la pantalla? */
export function inEdgeZone(x: number, viewportWidth: number): boolean {
  return x < EDGE_DEAD_ZONE_PX || x > viewportWidth - EDGE_DEAD_ZONE_PX;
}

export type Axis = 'horizontal' | 'vertical';

/** La dirección de un gesto, o `null` mientras se mueva menos de `SLOP_PX` (sigue siendo un toque). */
export function lockAxis(dx: number, dy: number): Axis | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SLOP_PX) return null;
  return Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
}

/** ¿Se ha llegado al 40 % de `width`? */
export function isArmed(distance: number, width: number): boolean {
  return width > 0 && distance >= width * ACTIVATION;
}

/** → avanza el estado; ← muestra las marcas. */
export type SwipeSide = 'advance' | 'flags';

export interface SwipeFrame {
  /** `pending`: aún es un toque; `swipe`: horizontal, es nuestro; `ignored`: vertical, del navegador. */
  readonly phase: 'pending' | 'swipe' | 'ignored';
  /** Cuánto se desplaza la fila, en px. */
  readonly offset: number;
  readonly side: SwipeSide | null;
  /** Al soltar, ¿se hará? */
  readonly armed: boolean;
  /** Acaba de pasar el umbral: se vibra una vez. */
  readonly justArmed: boolean;
}

export interface SwipeOptions {
  /** Ancho de la fila: el umbral es su 40 %. */
  readonly width: number;
  /** La fila avanza a la derecha (ver `advanceStatus`). */
  readonly canAdvance: boolean;
}

export interface Swipe {
  move(x: number, y: number): SwipeFrame;
  /** Lo que se hace al soltar: `null` si no había llegado al umbral o se volvió atrás. */
  end(): SwipeSide | null;
}

/**
 * Deslizar una fila desde (`startX`, `startY`). Hacia un lado sin acción (→ en Completado o
 * Abandonado), la fila sigue al dedo como mucho 24 px y nunca se activa.
 */
export function createSwipe(startX: number, startY: number, options: SwipeOptions): Swipe {
  let phase: SwipeFrame['phase'] = 'pending';
  let armed = false;
  let side: SwipeSide | null = null;
  return {
    move(x, y) {
      const dx = x - startX;
      if (phase === 'pending') {
        const axis = lockAxis(dx, y - startY);
        if (axis === 'vertical') phase = 'ignored';
        else if (axis === 'horizontal') phase = 'swipe';
      }
      if (phase !== 'swipe') {
        return { phase, offset: 0, side: null, armed: false, justArmed: false };
      }
      side = dx >= 0 ? 'advance' : 'flags';
      const allowed = side === 'flags' || options.canAdvance;
      const offset = allowed
        ? Math.max(-options.width, Math.min(options.width, dx))
        : Math.sign(dx) * Math.min(Math.abs(dx) / 4, RUBBER_BAND_PX);
      const wasArmed = armed;
      armed = allowed && isArmed(Math.abs(dx), options.width);
      return { phase, offset, side, armed, justArmed: armed && !wasArmed };
    },
    end() {
      return phase === 'swipe' && armed ? side : null;
    },
  };
}

/**
 * Puesto en el que caería la fila `from` si su centro está en `center`: el de la última fila
 * cuyo centro ha cruzado. `centers` son los de cada fila antes de arrastrar, de arriba abajo.
 */
export function dropIndex(centers: readonly number[], from: number, center: number): number {
  let to = from;
  for (let i = from + 1; i < centers.length && center > (centers[i] ?? Infinity); i++) to = i;
  if (to !== from) return to;
  for (let i = from - 1; i >= 0 && center < (centers[i] ?? -Infinity); i--) to = i;
  return to;
}

/** Cuánto se aparta la fila `index` mientras `from` cae en `to`: le deja su hueco (`size`). */
export function shiftFor(index: number, from: number, to: number, size: number): number {
  if (from < to && index > from && index <= to) return -size;
  if (to < from && index >= to && index < from) return size;
  return 0;
}

/**
 * Lo que se pide a la agenda al soltar, con los `ids` de la sección tal como se ven (quizá
 * filtrada): dejarla después de la fila sobre la que cae, si baja, o antes, si sube.
 */
export function dropTarget(
  ids: readonly string[],
  from: number,
  to: number,
): { readonly before: string } | { readonly after: string } | null {
  const id = ids[to];
  if (to === from || id === undefined) return null;
  return to > from ? { after: id } : { before: id };
}

/** Banda junto a los bordes de la zona visible en la que se desplaza sola la página, en px. */
export const AUTO_SCROLL_ZONE_PX = 48;
const AUTO_SCROLL_MAX_PX = 14;

/**
 * Píxeles por fotograma que se desplaza la página al arrastrar cerca del borde de arriba
 * (negativo) o del de abajo de la zona visible (`top`–`bottom`): más rápido cuanto más cerca.
 */
export function autoScrollSpeed(y: number, top: number, bottom: number): number {
  const zone = AUTO_SCROLL_ZONE_PX;
  if (y < top + zone) return -Math.ceil(AUTO_SCROLL_MAX_PX * Math.min(1, (top + zone - y) / zone));
  if (y > bottom - zone) {
    return Math.ceil(AUTO_SCROLL_MAX_PX * Math.min(1, (y - (bottom - zone)) / zone));
  }
  return 0;
}
