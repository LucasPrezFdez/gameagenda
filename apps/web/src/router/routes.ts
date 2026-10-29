// Rutas de la §9.1, sin dependencias del DOM (se prueban con Vitest).

export const SETTINGS_SECTIONS = ['appearance', 'content', 'keyboard', 'data', 'about'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** Segmentos de URL en español para cada sección de Ajustes. */
export const SETTINGS_SLUGS: Readonly<Record<SettingsSection, string>> = {
  appearance: 'apariencia',
  content: 'contenido',
  keyboard: 'teclado',
  data: 'datos',
  about: 'acerca-de',
};

export type Route =
  | { readonly name: 'list' }
  | { readonly name: 'capture' }
  | { readonly name: 'catalog' }
  | { readonly name: 'game'; readonly id: string }
  | { readonly name: 'settings'; readonly section: SettingsSection | null }
  | { readonly name: 'notFound' };

const STEAM_ID = /^steam:[1-9][0-9]{0,9}$/;
const MANUAL_ID = /^manual:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isEntryId(id: string): boolean {
  return STEAM_ID.test(id) || MANUAL_ID.test(id);
}

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

export function parseRoute(pathname: string): Route {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (path === '/' || path === '') return { name: 'list' };
  if (path === '/apuntar') return { name: 'capture' };
  if (path === '/catalogo') return { name: 'catalog' };
  if (path === '/ajustes') return { name: 'settings', section: null };

  const game = /^\/juego\/([^/]+)$/.exec(path);
  if (game?.[1] !== undefined) {
    const id = decode(game[1]);
    return id !== null && isEntryId(id) ? { name: 'game', id } : { name: 'notFound' };
  }
  const settings = /^\/ajustes\/([^/]+)$/.exec(path);
  if (settings?.[1] !== undefined) {
    const section = SETTINGS_SECTIONS.find((s) => SETTINGS_SLUGS[s] === settings[1]);
    return section ? { name: 'settings', section } : { name: 'notFound' };
  }
  return { name: 'notFound' };
}

export function gamePath(id: string): string {
  return `/juego/${id}`;
}

export function settingsPath(section: SettingsSection | null): string {
  return section === null ? '/ajustes' : `/ajustes/${SETTINGS_SLUGS[section]}`;
}

/** Une ruta y parámetros, sin `?` si no quedan parámetros. */
export function withSearch(pathname: string, params: URLSearchParams): string {
  const query = params.toString();
  return query === '' ? pathname : `${pathname}?${query}`;
}
