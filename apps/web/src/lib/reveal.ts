// Enseñar un elemento dentro de una tira que se desplaza en horizontal (las pestañas de vista de
// Mi lista en el móvil; DECISIONES §10.56). Mueve solo la tira, nunca la página: `scrollIntoView`
// también desplaza en vertical si la tira no está a la vista (al restaurar el desplazamiento).

/** Lo que se deja a la vista más allá del elemento, para que se note que la tira sigue. */
export const REVEAL_MARGIN_PX = 24;

/**
 * Lo que hay que sumar al `scrollLeft` de la tira para que se vea `[left, right]` entero (en las
 * mismas coordenadas que `[stripLeft, stripRight]`), con `margin` de más; 0 si ya se ve.
 */
export function revealDelta(
  strip: { readonly left: number; readonly right: number },
  item: { readonly left: number; readonly right: number },
  margin = REVEAL_MARGIN_PX,
): number {
  if (item.left < strip.left) return item.left - strip.left - margin;
  if (item.right > strip.right) return item.right - strip.right + margin;
  return 0;
}

/** Desplaza `strip` lo justo para que se vea `item` entero. */
export function revealInStrip(strip: HTMLElement, item: HTMLElement): void {
  const delta = revealDelta(strip.getBoundingClientRect(), item.getBoundingClientRect());
  if (delta !== 0) strip.scrollLeft += delta;
}
