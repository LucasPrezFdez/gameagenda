// Rutas de la §9.1, sin dependencias del DOM (se prueban con Vitest).

export const SETTINGS_SECTIONS = [
  'appearance',
  'content',
  'keyboard',
  'data',
  'privacy',
  // M4: entre Privacidad y Rendimiento, como en el *wireframe* de la §9.3.
  'sync',
  'performance',
  'about',
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** Segmentos de URL en español para cada sección de Ajustes. */
export const SETTINGS_SLUGS: Readonly<Record<SettingsSection, string>> = {
  appearance: 'apariencia',
  content: 'contenido',
  keyboard: 'teclado',
  data: 'datos',
  privacy: 'privacidad',
  sync: 'sincronizacion',
  performance: 'rendimiento',
  about: 'acerca-de',
};

/**
 * Enlace del QR de emparejamiento (M4; §11.4): `<origen>/emparejar#<código>`. El código va en el
 * fragmento, que el navegador no manda al servidor, y nunca se canjea con un GET: la app lo quita
 * de la URL al arrancar y abre Ajustes › Sincronización con el código puesto (ver
 * `pairing-link.ts`).
 */
export const PAIR_PATH = '/emparejar';

/** Los textos legales (M4; CA4.7): la política de privacidad y el aviso legal. */
export type LegalDoc = 'privacy' | 'notice';
export const LEGAL_PATHS: Readonly<Record<LegalDoc, string>> = {
  privacy: '/privacidad',
  notice: '/aviso-legal',
};

export type Route =
  | { readonly name: 'list' }
  | { readonly name: 'capture' }
  /** Destino de «Compartir» en Android (`share_target`, M3): apunta y vuelve a `/`. */
  | { readonly name: 'share' }
  | { readonly name: 'catalog' }
  | { readonly name: 'game'; readonly id: string }
  | { readonly name: 'settings'; readonly section: SettingsSection | null }
  /** Enlace del QR de emparejamiento (M4): se queda en Ajustes › Sincronización. */
  | { readonly name: 'pair' }
  | { readonly name: 'legal'; readonly doc: LegalDoc }
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
  if (path === '/share') return { name: 'share' };
  if (path === '/catalogo') return { name: 'catalog' };
  if (path === '/ajustes') return { name: 'settings', section: null };
  if (path === PAIR_PATH) return { name: 'pair' };
  if (path === LEGAL_PATHS.privacy) return { name: 'legal', doc: 'privacy' };
  if (path === LEGAL_PATHS.notice) return { name: 'legal', doc: 'notice' };

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

/** `https://ga-web…/emparejar#XXXX-XXXX-…`: lo que lleva el QR de «Emparejar otro dispositivo». */
export function pairingUrl(origin: string, code: string): string {
  return `${origin}${PAIR_PATH}#${code}`;
}

/** Un código pegado con espacios o guiones de más sigue cabiendo (`CODE_INPUT_MAX` de core). */
const PAIR_FRAGMENT_MAX = 64;

/**
 * El código del fragmento de `/emparejar#…`, tal cual (lo normaliza `parseCode()` al canjearlo, en
 * Ajustes), o `null` si no hay. Sin Zod: va en el *chunk* inicial.
 */
export function pairingCodeFromHash(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const text = (decode(raw) ?? '').trim();
  return text === '' || text.length > PAIR_FRAGMENT_MAX ? null : text;
}

/** Une ruta y parámetros, sin `?` si no quedan parámetros. */
export function withSearch(pathname: string, params: URLSearchParams): string {
  const query = params.toString();
  return query === '' ? pathname : `${pathname}?${query}`;
}
