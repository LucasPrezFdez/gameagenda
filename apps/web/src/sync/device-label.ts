// Nombre del dispositivo por defecto para la lista de Ajustes («Chrome en Windows»): se deduce del
// *user agent*, sin pedir nada. El usuario puede cambiarlo antes de activar o emparejar.
import { es } from '../i18n/es.ts';

/** `DEVICE_LABEL_MAX` de `@gameagenda/core/api`, a mano para no arrastrar Zod (lo comprueba una prueba). */
export const LABEL_MAX = 60;

const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\bOPR\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
  [/\b(?:Chrome|CriOS|Chromium)\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
];

const SYSTEMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bWindows\b/, 'Windows'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\b(?:Macintosh|Mac OS X)\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

function first(table: ReadonlyArray<readonly [RegExp, string]>, ua: string): string | null {
  for (const [pattern, name] of table) if (pattern.test(ua)) return name;
  return null;
}

export function defaultDeviceLabel(userAgent: string): string {
  const browser = first(BROWSERS, userAgent) ?? es.sync.unknownBrowser;
  const system = first(SYSTEMS, userAgent) ?? es.sync.unknownSystem;
  return es.sync.deviceLabel(browser, system).slice(0, LABEL_MAX);
}
