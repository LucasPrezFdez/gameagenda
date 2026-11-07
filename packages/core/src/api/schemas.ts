// Contrato de la micro-API de `ga-web` (§5.2, §7.7 y §11.4; ADR-011): lo usan el Worker, que valida
// las peticiones, y la app, que valida las respuestas. Las peticiones son objetos estrictos (Zod
// rechaza los campos desconocidos, §11.4); las respuestas no, para que un cliente antiguo acepte
// campos nuevos. Las constantes van aparte, sin Zod (`constants.ts`).

import '../zod-config.ts';
import * as z from 'zod';
import { entryIdSchema, fieldSchema, hlcSchema } from '../schemas/entry.ts';
import {
  CODE_INPUT_MAX,
  DEVICE_KINDS,
  DEVICE_LABEL_MAX,
  EPOCH_MAX,
  MAX_SYNC_OPS,
  SYNC_REJECTIONS,
} from './constants.ts';

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

/**
 * `POST /api/v1/sync` (§7.7): sube la `outbox` y baja los cambios desde `cursor`. Cada operación
 * se valida aparte (`strictOpSchema`): una que no vale se rechaza, con las de su misma acción, sin
 * tirar el resto.
 */
export const syncRequestSchema = z.strictObject({
  /** La `seq` del servidor hasta la que la app ya tiene los cambios; 0 si nunca ha sincronizado. */
  cursor: z.int().min(0),
  /** El `purgedSeq` de la última respuesta: con él, el servidor sabe si la app vio la purga. */
  purgedSeq: z.int().min(0),
  ops: z.array(z.unknown()).max(MAX_SYNC_OPS),
});
export type SyncRequest = z.input<typeof syncRequestSchema>;

export const syncChangeSchema = z.object({
  entryId: entryIdSchema,
  field: fieldSchema,
  value: z.json(),
  hlc: hlcSchema,
});
export type SyncChange = z.output<typeof syncChangeSchema>;

export const syncResponseSchema = z.object({
  /** El cursor que guarda la app cuando aplica esta página. */
  cursor: z.int().min(0),
  purgedSeq: z.int().min(0),
  /**
   * Época de la agenda: cambia cuando D1 vuelve atrás (el *runbook* del restore la cambia). Si no
   * es la que tenía la app, su cursor ya no vale: lo vuelve a subir todo y baja desde 0.
   */
  epoch: z.string().max(EPOCH_MAX),
  /**
   * La app se quedó atrás de una purga: estos cambios empiezan desde 0, y al acabar las páginas
   * borra las entradas que el servidor ya no tiene (salvo las que aún tiene en la `outbox`).
   */
  reset: z.boolean(),
  /** Quedan más páginas: hay que volver a llamar con el cursor nuevo. */
  more: z.boolean(),
  /** Hora del servidor en ms UTC: con ella la app corrige el desfase de su HLC (§7.4). */
  serverTime: z.number(),
  changes: z.array(syncChangeSchema),
  /** Las operaciones procesadas, ganaran o no: ya pueden salir de la `outbox`. */
  accepted: z.array(z.string()),
  rejected: z.array(
    z.object({
      /** Posición en `ops`. */
      index: z.int().min(0),
      opId: z.string().nullable(),
      reason: z.enum(SYNC_REJECTIONS),
    }),
  ),
});
export type SyncResponse = z.output<typeof syncResponseSchema>;

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
