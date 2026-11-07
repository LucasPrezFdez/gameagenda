// Constantes del contrato de la micro-API (§5.2, §7.7 y §11.4; ADR-011), sin Zod: así la app las
// usa en Ajustes › Sincronización sin descargar los esquemas (`schemas.ts`), que solo carga el
// motor de la sincronización.

export const API_BASE = '/api/v1';

/** Credencial del dispositivo: `__Host-ga_device`, `HttpOnly`, 256 bits (§11.4). */
export const DEVICE_COOKIE = 'ga_device';
/**
 * Indicio para la app, sin secreto: `__Host-ga_sync=1`, legible desde JavaScript. Vive y muere con
 * la credencial, así que, si se borra solo IndexedDB, la app sabe que sigue emparejada y restaura
 * la agenda sin preguntar al servidor en cada arranque (CA4.3).
 */
export const SYNC_HINT_COOKIE = 'ga_sync';
/** Chrome limita las cookies a 400 días; se renuevan al sincronizar, como mucho una vez al día. */
export const DEVICE_COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;

/** Un *token* de emparejamiento vale para un uso y 10 min (§11.4; CA4.4). */
export const PAIRING_TTL_MS = 10 * 60_000;
/** Edad mínima declarada al activar la sincronización (art. 7 LOPDGDD; R-10: podría pasar a 16). */
export const DEFAULT_MIN_AGE = 14;
export const DEVICE_LABEL_MAX = 60;
/** Un código pegado con espacios o guiones de más sigue cabiendo. */
export const CODE_INPUT_MAX = 64;

export const DEVICE_KINDS = ['app', 'inbox'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

/** Códigos de error de la micro-API: la app los traduce a sus textos. */
export const API_ERRORS = {
  invalid_body: 400,
  invalid_code: 400,
  unauthorized: 401,
  bad_origin: 403,
  not_found: 404,
  already_paired: 409,
  age_policy_changed: 409,
  payload_too_large: 413,
  unsupported_media_type: 415,
  rate_limited: 429,
  internal: 500,
  sync_disabled: 503,
  /** Otro dispositivo escribía a la vez y los reintentos no bastaron: probar más tarde. */
  busy: 503,
} as const;
export type ApiErrorCode = keyof typeof API_ERRORS;

/**
 * Operaciones por petición. La app manda lotes de `SYNC_BATCH_SIZE` (200) sin partir acciones; una
 * acción más grande va entera, y por eso el tope es mayor.
 */
export const MAX_SYNC_OPS = 1000;
/** Cuerpo de `POST /api/v1/sync`: 1 000 operaciones con notas largas caben de sobra. */
export const MAX_SYNC_BODY = 1024 * 1024;
/** Cambios por página de la respuesta (§7.7). */
export const SYNC_PAGE_SIZE = 1000;
/** Época de la agenda (`agenda.epoch`): 16 cifras hexadecimales; la app admite hasta esto. */
export const EPOCH_MAX = 64;

/**
 * Por qué se rechaza una operación: `invalid` (no pasa Zod, o lo hace otra de su acción: se
 * descarta) o `clock` (su HLC va más de 5 min por delante del servidor: se vuelve a sellar).
 */
export const SYNC_REJECTIONS = ['invalid', 'clock'] as const;
export type SyncRejection = (typeof SYNC_REJECTIONS)[number];
