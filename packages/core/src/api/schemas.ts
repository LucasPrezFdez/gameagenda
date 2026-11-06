// Contrato de la micro-API de `ga-web` (§5.2, §7.7 y §11.4; ADR-011): lo usan el Worker, que valida
// las peticiones, y la app, que valida las respuestas. Las peticiones son objetos estrictos (Zod
// rechaza los campos desconocidos, §11.4); las respuestas no, para que un cliente antiguo acepte
// campos nuevos.

import '../zod-config.ts';
import * as z from 'zod';

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
} as const;
export type ApiErrorCode = keyof typeof API_ERRORS;

/** Nombre del dispositivo en Ajustes («Chrome en Android»): texto corto sin caracteres de control. */
export const deviceLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(DEVICE_LABEL_MAX)
  .regex(/^[^\p{Cc}]*$/u);

// --- Peticiones ---

/** `POST /api/v1/agenda`: activar la sincronización, con la declaración de edad (CA4.7). */
export const createAgendaRequestSchema = z.strictObject({
  ageConfirmed: z.literal(true),
  /** La edad que se le ha pedido declarar: si el servidor pide otra, responde `age_policy_changed`. */
  minAge: z.int().min(13).max(18),
  label: deviceLabelSchema,
});
export type CreateAgendaRequest = z.input<typeof createAgendaRequestSchema>;

/** `POST /api/v1/pairing/redeem` y `POST /api/v1/recovery/redeem`. */
export const redeemRequestSchema = z.strictObject({
  code: z.string().max(CODE_INPUT_MAX),
  label: deviceLabelSchema,
});
export type RedeemRequest = z.input<typeof redeemRequestSchema>;

/** Rutas que cambian algo sin datos: el cuerpo es `{}` (y sigue siendo JSON, §11.4). */
export const emptyRequestSchema = z.strictObject({});

/** `POST /api/v1/agenda/delete` («Borrar todos mis datos», CA4.7). */
export const deleteAgendaRequestSchema = z.strictObject({ confirm: z.literal(true) });

// --- Respuestas ---

export const apiErrorSchema = z.object({ error: z.string() });

export const createAgendaResponseSchema = z.object({
  deviceId: z.string(),
  /** Se muestra una vez (§11.4). */
  recoveryCode: z.string(),
});
export type CreateAgendaResponse = z.output<typeof createAgendaResponseSchema>;

export const redeemResponseSchema = z.object({ deviceId: z.string() });
export type RedeemResponse = z.output<typeof redeemResponseSchema>;

export const pairingResponseSchema = z.object({
  code: z.string(),
  /** Instante ISO 8601 UTC. */
  expiresAt: z.string(),
});
export type PairingResponse = z.output<typeof pairingResponseSchema>;

export const recoveryResponseSchema = z.object({ recoveryCode: z.string() });
export type RecoveryResponse = z.output<typeof recoveryResponseSchema>;

export const deviceInfoSchema = z.object({
  id: z.string(),
  kind: z.enum(DEVICE_KINDS),
  label: z.string(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  /** El que hace la petición. */
  current: z.boolean(),
});
export type DeviceInfo = z.output<typeof deviceInfoSchema>;

export const devicesResponseSchema = z.object({ devices: z.array(deviceInfoSchema) });
export type DevicesResponse = z.output<typeof devicesResponseSchema>;

export const okResponseSchema = z.object({ ok: z.literal(true) });
