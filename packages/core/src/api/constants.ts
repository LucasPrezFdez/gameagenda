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

/** Nombre que propone Ajustes para el *token* del buzón (se puede cambiar). */
export const DEFAULT_INBOX_LABEL = 'Atajo de iOS';
/**
 * Lo que admite `POST /api/v1/inbox` en `url`: un enlace de Steam, o un texto que lo lleve (lo que
 * comparte la app de Steam lleva el título delante). Se guarda solo el enlace canónico.
 */
export const INBOX_TEXT_MAX = 2048;
/**
 * El enlace que guarda el buzón, como mucho (el canónico de la tienda; sin *slug* si no cabe). Los
 * de Steam rondan los 60 caracteres.
 */
export const INBOX_URL_MAX = 512;
/** Enlaces pendientes por agenda: con más, el buzón responde 409 `inbox_full`. */
export const INBOX_MAX_PENDING = 200;
/** Enlaces del buzón por respuesta de `sync` (los siguientes llegan en la ronda siguiente). */
export const INBOX_PAGE_SIZE = 50;
/** Ids del buzón que una petición de `sync` puede dar por apuntados. */
export const INBOX_ACK_MAX = 200;

/** `resolve` (§5.2): un nombre que Steam conoce vale 30 días en la caché de D1. */
export const RESOLVE_TTL_MS = 30 * 86_400_000;
/** Y un `appid` que Steam no conoce, 1 día: puede ser un juego que aún no se ha publicado. */
export const RESOLVE_MISS_TTL_MS = 86_400_000;
/** Nombre más largo que devuelve `resolve` (se corta, sin partir un par sustituto). */
export const RESOLVE_NAME_MAX = 200;

/**
 * Importar desde Steam (Fase 2; §10.2; ADR-012): el ticket del login caduca a los 10 min y es de un
 * solo uso. Solo lo canjea quien tiene su verificador (canje tipo PKCE).
 */
export const STEAM_TICKET_TTL_MS = 10 * 60_000;
/**
 * El ticket, el verificador y el `challenge` (`BASE64URL(SHA-256(verificador))`, como `S256` de
 * PKCE): 256 bits en base64url sin relleno, 43 caracteres.
 */
export const STEAM_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/**
 * Lo que `redeem` deja pasar de Steam como mucho (la biblioteca y la lista de deseados juntas): una
 * biblioteca de 5 000 juegos con `include_appinfo` pesa ≈1,7 MB.
 */
export const STEAM_IMPORT_MAX_BYTES = 16 * 1024 * 1024;
/** Juegos de la biblioteca, y de la lista de deseados, que la app admite como mucho. */
export const STEAM_LIST_MAX = 100_000;
/**
 * El pase de la importación (Fase 2, parte 3): lo da `redeem` y vale para pedir los logros durante
 * 15 min. Es el SteamID64 cifrado (AES-GCM, `worker/steam-token.ts`): 79 caracteres en base64url.
 */
export const STEAM_IMPORT_TOKEN_TTL_MS = 15 * 60_000;
export const STEAM_IMPORT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{60,120}$/;
/**
 * Juegos por petición de `achievements`: uno por llamada a Steam, y el plan gratuito de Workers
 * admite 50 subpeticiones por invocación.
 */
export const STEAM_ACHIEVEMENTS_BATCH = 40;
/**
 * Apps por petición de `types` (Software, DECISIONES §10.57): una sola llamada a `GetItems` de la
 * tienda de Steam, que admite 200 por llamada.
 */
export const STEAM_TYPES_BATCH = 200;

/**
 * Llaves de acceso (ADR-013): el reto para crear una o para entrar con ella vale un solo uso y
 * 5 min (el diálogo del navegador se cierra antes).
 */
export const PASSKEY_CHALLENGE_TTL_MS = 5 * 60_000;
/** Llaves por agenda, como mucho: con más, `options` responde 409 `passkeys_full`. */
export const PASSKEYS_MAX = 10;
/**
 * Algoritmos COSE que se admiten, por orden de preferencia: Ed25519 (-8), ES256 (-7) y RS256
 * (-257, el de Windows Hello con TPM).
 */
export const PASSKEY_ALGORITHMS = [-8, -7, -257] as const;
export type PasskeyAlgorithm = (typeof PASSKEY_ALGORITHMS)[number];
/** Transportes de una llave que se guardan (los demás se ignoran: puede haber nuevos). */
export const PASSKEY_TRANSPORTS = [
  'ble',
  'cable',
  'hybrid',
  'internal',
  'nfc',
  'smart-card',
  'usb',
] as const;
/** El sitio y la cuenta que enseña el llavero (`rp.name`, `user.name` y `user.displayName`). */
export const PASSKEY_RP_NAME = 'GameAgenda';
export const PASSKEY_USER_NAME = 'Mi agenda de GameAgenda';

/**
 * Cuentas (ADR-014): el email y la contraseña de la agenda. La contraseña nunca sale del
 * dispositivo: viaja `authKey`, que sale de ella con PBKDF2 (`account-key.ts`), y el Worker solo
 * calcula un HMAC. El email, como mucho 254 caracteres (RFC 5321) tras normalizarlo; lo que llega
 * puede traer espacios de más.
 */
export const ACCOUNT_EMAIL_MAX = 254;
export const ACCOUNT_EMAIL_INPUT_MAX = 320;
/** La contraseña, en caracteres (puntos de código): sin reglas de composición (NIST SP 800-63B). */
export const ACCOUNT_PASSWORD_MIN = 12;
export const ACCOUNT_PASSWORD_MAX = 128;
/** PBKDF2-HMAC-SHA256 con 600 000 vueltas (OWASP). La versión viaja para poder subirla. */
export const ACCOUNT_KDF = 'pbkdf2-sha256-600000';
export const ACCOUNT_KDF_ITERATIONS = 600_000;
/** `authKey`: 256 bits en base64url sin relleno, 43 caracteres. */
export const ACCOUNT_AUTH_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/**
 * El freno por email: con `LOGIN_MAX_FAILURES` fallos en `LOGIN_WINDOW_MS` desde el primero, ese
 * email no puede entrar con contraseña hasta que acabe la ventana. Cuenta también los emails que no
 * existen, para que el bloqueo no diga cuáles sí.
 */
export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_WINDOW_MS = 60 * 60_000;
/**
 * Steam vinculado (ADR-014): la micro-API trae la biblioteca de una agenda como mucho una vez cada
 * 20 h, y la app lo pide al abrirse si han pasado 24 h desde la última vez.
 */
export const STEAM_REFRESH_MIN_INTERVAL_MS = 20 * 3_600_000;
export const STEAM_AUTO_REFRESH_MS = 24 * 3_600_000;

/** Códigos de error de la micro-API: la app los traduce a sus textos. */
export const API_ERRORS = {
  invalid_body: 400,
  invalid_code: 400,
  /**
   * Entrar con email y contraseña: el email no tiene cuenta o la contraseña no vale. Las dos dan
   * la misma respuesta (ADR-014).
   */
  invalid_login: 400,
  /** El buzón solo admite enlaces de Steam (§11.4). */
  invalid_link: 400,
  /**
   * Entrar o crear con una llave de acceso: el reto no vale (gastado, caducado o de otro), la llave
   * no está en ninguna agenda o la firma no cuadra. Todas dan la misma respuesta (ADR-013).
   */
  invalid_passkey: 400,
  unauthorized: 401,
  bad_origin: 403,
  not_found: 404,
  already_paired: 409,
  age_policy_changed: 409,
  /** Hay `INBOX_MAX_PENDING` enlaces sin recoger: hay que abrir la app para que los apunte. */
  inbox_full: 409,
  /** La agenda ya tiene `PASSKEYS_MAX` llaves: hay que quitar alguna. */
  passkeys_full: 409,
  /** Crear una cuenta, o ponerle email: ese email ya es de otra cuenta (sin correos, no se evita). */
  email_taken: 409,
  payload_too_large: 413,
  unsupported_media_type: 415,
  rate_limited: 429,
  /** Demasiados fallos con la contraseña de este email: hay que esperar (`LOGIN_WINDOW_MS`). */
  too_many_attempts: 429,
  internal: 500,
  /**
   * Importar desde Steam: el ticket no existe, ha caducado, ya se canjeó o el verificador no es el
   * suyo (las cuatro dan la misma respuesta). Hay que volver a empezar.
   */
  steam_ticket_invalid: 410,
  /** Importar desde Steam: el pase de los logros no vale o ha caducado. Hay que volver a empezar. */
  steam_token_invalid: 410,
  /**
   * `resolve`: Steam no ha contestado (o no como se esperaba) y no hay nada en la caché. Importar
   * desde Steam: `GetOwnedGames` no ha respondido como se esperaba.
   */
  steam_unavailable: 502,
  sync_disabled: 503,
  /** `STEAM_ENABLED` no vale `'1'`, o falta la clave de la Steam Web API en el Worker. */
  steam_disabled: 503,
  /** `PASSKEYS_ENABLED` no vale `'1'`: las llaves de acceso están apagadas (ADR-013). */
  passkeys_disabled: 503,
  /**
   * `ACCOUNTS_ENABLED` no vale `'1'`, o falta el secreto `ACCOUNT_PEPPER`: las cuentas con email y
   * el vínculo con Steam están apagados (ADR-014).
   */
  accounts_disabled: 503,
  /** Se ha llegado al tope diario de llamadas a Steam (los ToU, §11.1): mañana. */
  steam_busy: 503,
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
