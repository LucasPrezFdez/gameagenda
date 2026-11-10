// Movimiento hecho con la Web Animations API (pulido visual, DECISIONES §10.44): lo que no se
// puede declarar en CSS porque depende de un cambio concreto (una fila que cambia de sitio, una
// marca que se acaba de poner). No toca estilos en línea (la CSP no los admite, §11.3) ni clases de
// React, y con «reducir movimiento» no hace nada: `--motion` vale 0 (tokens.css).

/** La curva de `--ease` (tokens.css). */
export const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

/** Duración de base en ms: la de `--motion`, o 0 con «reducir movimiento» o sin `animate()`. */
export function motionMs(): number {
  if (typeof document === 'undefined' || typeof Element.prototype.animate !== 'function') return 0;
  const value = getComputedStyle(document.documentElement).getPropertyValue('--motion').trim();
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) return 0;
  // La compilación minimiza «160ms» a «.16s»: vale en las dos unidades.
  return value.endsWith('ms') ? amount : amount * 1000;
}

/** El salto del icono al poner una marca: crece un 20 % y vuelve. */
export function popIcon(button: Element): void {
  const ms = motionMs();
  const icon = button.querySelector('.icon');
  if (ms === 0 || !icon) return;
  icon.animate([{ scale: 0.6 }, { scale: 1.2, offset: 0.6 }, { scale: 1 }], {
    duration: ms * 1.8,
    easing: EASE,
  });
}
