// Identificadores naturales (§7.3): `steam:<appid>` y `manual:<uuidv7>`.

export const STEAM_ENTRY_ID_PATTERN = /^steam:[1-9][0-9]{0,9}$/;
export const UUIDV7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const MANUAL_ENTRY_ID_PATTERN =
  /^manual:[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** El mayor `appid` que admite el patrón de Zod (10 cifras). */
export const MAX_APPID = 9_999_999_999;

export type ParsedEntryId = { kind: 'steam'; appid: number } | { kind: 'manual'; uuid: string };

export function isAppid(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= MAX_APPID
  );
}

/** Solo se construye aquí: en SQL, `'steam:' || ?` con un REAL daría `'steam:730.0'`. */
export function steamEntryId(appid: number): string {
  if (!isAppid(appid)) throw new RangeError(`steamEntryId: appid no válido: ${appid}`);
  return `steam:${appid}`;
}

/** El uuidv7 lo genera quien llama (core no tiene aleatorios propios). */
export function manualEntryId(uuid: string): string {
  if (!UUIDV7_PATTERN.test(uuid)) throw new TypeError(`manualEntryId: no es un uuidv7: ${uuid}`);
  return `manual:${uuid}`;
}

export function isSteamEntryId(id: unknown): boolean {
  return typeof id === 'string' && STEAM_ENTRY_ID_PATTERN.test(id);
}

export function isManualEntryId(id: unknown): boolean {
  return typeof id === 'string' && MANUAL_ENTRY_ID_PATTERN.test(id);
}

export function isEntryId(id: unknown): boolean {
  return isSteamEntryId(id) || isManualEntryId(id);
}

export function parseEntryId(id: string): ParsedEntryId | null {
  if (isSteamEntryId(id)) return { kind: 'steam', appid: Number(id.slice('steam:'.length)) };
  if (isManualEntryId(id)) return { kind: 'manual', uuid: id.slice('manual:'.length) };
  return null;
}
