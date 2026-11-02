// Lo que los atajos (§9.4) necesitan del DOM y comparten las pantallas.
import { isEditableTarget } from '../lib/hooks.ts';

/** ¿Puede actuar aquí una tecla suelta? No en campos de texto, menús abiertos ni diálogos. */
export function isShortcutTarget(target: EventTarget | null): boolean {
  if (isEditableTarget(target)) return false;
  return !(
    target instanceof Element && target.closest('[role="menu"], dialog, [role="dialog"]') !== null
  );
}

export function steamUrl(appid: number): string {
  return `https://store.steampowered.com/app/${appid}/`;
}

/**
 * «Ver en Steam» (`V`), por el mismo camino que el enlace de la ficha: un `<a target="_blank">`.
 * En la app de escritorio, `on_new_window` lo abre en el navegador del sistema (ADR-010).
 */
export function openSteam(appid: number): void {
  const link = document.createElement('a');
  link.href = steamUrl(appid);
  link.target = '_blank';
  link.rel = 'noopener';
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
}

// `N` desde una fila abre la ficha con el foco en la nota: la ficha lo recoge al montarse.
let pendingNote: string | null = null;

export function requestNoteFocus(id: string): void {
  pendingNote = id;
}

/** ¿Pidió `N` la nota de esta entrada? Solo responde `true` una vez. */
export function takeNoteFocus(id: string): boolean {
  if (pendingNote !== id) return false;
  pendingNote = null;
  return true;
}

/** Los `id` de Mi lista en el orden en que se ven (para `J` y `K` en la ficha). */
export function visibleEntryIds(): string[] {
  return [...document.querySelectorAll<HTMLElement>('.screen-slot--list [data-entry-id]')].map(
    (row) => row.dataset.entryId ?? '',
  );
}

/** El filtro de la pantalla para `F`, si se puede usar (no tapado por la ficha: `inert`). */
export function filterField(): HTMLInputElement | null {
  for (const field of document.querySelectorAll<HTMLInputElement>('[data-filter-field]')) {
    if (!field.closest('[inert]') && field.getClientRects().length > 0) return field;
  }
  return null;
}
