// Parser de enlaces de Steam (§9.2, «Enlaces»). Sin `URL`: expresiones regulares y nada más.

export type SteamLinkSource = 'store' | 's.team' | 'community' | 'steam' | 'steamdb' | 'appid';

export interface SteamLink {
  appid: number;
  /** Título derivado del *slug* de la tienda (para el juego provisional), si lo hay. */
  title: string | null;
  source: SteamLinkSource;
}

/** `appid` de 1 a 10 cifras sin ceros a la izquierda, como en `steam:<appid>`. */
const APPID = '([1-9][0-9]{0,9})';
const REST = '(?:[/?#].*)?';
const PATTERNS: ReadonlyArray<[SteamLinkSource, RegExp]> = [
  // La tienda lleva un *slug* opcional tras el appid.
  [
    'store',
    new RegExp(
      `^(?:https?://)?store\\.steampowered\\.com/app/${APPID}(?:/([^/?#]*))?${REST}$`,
      'i',
    ),
  ],
  ['s.team', new RegExp(`^(?:https?://)?s\\.team/a/${APPID}/?(?:[?#].*)?$`, 'i')],
  ['community', new RegExp(`^(?:https?://)?steamcommunity\\.com/app/${APPID}${REST}$`, 'i')],
  ['steam', new RegExp(`^steam://store/${APPID}/?$`, 'i')],
  ['steamdb', new RegExp(`^(?:https?://)?steamdb\\.info/app/${APPID}${REST}$`, 'i')],
  ['appid', new RegExp(`^appid:\\s*${APPID}$`, 'i')],
];

/** Título a partir del *slug* de la tienda: `Hollow_Knight_Silksong` → «Hollow Knight Silksong». */
export function titleFromSlug(slug: string): string | null {
  let text = slug;
  try {
    text = decodeURIComponent(slug);
  } catch {
    // Un %XX mal formado se deja tal cual.
  }
  const title = text.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return title === '' ? null : title;
}

/**
 * Reconoce un enlace o `appid:<n>` (el texto entero, sin contar espacios alrededor):
 * `store.steampowered.com/app/<appid>[/<slug>]`, `s.team/a/<appid>`,
 * `steamcommunity.com/app/<appid>`, `steam://store/<appid>`, `steamdb.info/app/<appid>`
 * y `appid:730`. `null` si no es ninguno.
 */
export function parseSteamLink(input: string): SteamLink | null {
  const text = input.trim();
  for (const [source, pattern] of PATTERNS) {
    const m = pattern.exec(text);
    if (m === null) continue;
    const appid = Number(m[1]);
    const slug = source === 'store' ? m[2] : undefined;
    return { appid, title: slug === undefined ? null : titleFromSlug(slug), source };
  }
  return null;
}

/** Signos que suelen pegarse al final de un enlace dentro de una frase. */
const TRAILING = /[.,;:!?)\]}»"'>]+$/;
const LEADING = /^[(<[{«"']+/;

/**
 * El primer enlace de Steam dentro de un texto (p. ej. el `text` de «Compartir», con título
 * y enlace). `null` si no hay ninguno.
 */
export function findSteamLink(text: string): SteamLink | null {
  const whole = parseSteamLink(text);
  if (whole !== null) return whole;
  for (const token of text.split(/\s+/)) {
    const link = parseSteamLink(token.replace(LEADING, '').replace(TRAILING, ''));
    if (link !== null) return link;
  }
  return null;
}
