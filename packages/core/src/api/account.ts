// Contrato de las cuentas (ADR-014): lo que manda la app a `/api/v1/account/*` y a
// `/api/v1/steam/link`, `refresh` y `unlink` (objetos estrictos, como el resto de la micro-API) y
// lo que responde el Worker. La contraseña nunca viaja: va `authKey`, que sale de ella con PBKDF2
// en el dispositivo.

import '../zod-config.ts';
import * as z from 'zod';
import { ACCOUNT_AUTH_KEY_PATTERN, ACCOUNT_EMAIL_INPUT_MAX, ACCOUNT_KDF } from './constants.ts';
import { deviceLabelSchema } from './schemas.ts';

/** El email tal como lo escribe el usuario: el Worker lo normaliza (`normalizeEmail`). */
const emailInputSchema = z.string().min(1).max(ACCOUNT_EMAIL_INPUT_MAX);
const authKeySchema = z.string().regex(ACCOUNT_AUTH_KEY_PATTERN);
const kdfSchema = z.literal(ACCOUNT_KDF);

// --- Peticiones ---

/** `POST /api/v1/account`: crear la agenda con su cuenta, como `POST /api/v1/agenda` (CA4.7). */
export const accountCreateRequestSchema = z.strictObject({
  email: emailInputSchema,
  authKey: authKeySchema,
  kdf: kdfSchema,
  ageConfirmed: z.literal(true),
  minAge: z.int().min(13).max(18),
  label: deviceLabelSchema,
});
export type AccountCreateRequest = z.input<typeof accountCreateRequestSchema>;

/** `POST /api/v1/account/login`: entrar desde un dispositivo nuevo. */
export const accountLoginRequestSchema = z.strictObject({
  email: emailInputSchema,
  authKey: authKeySchema,
  kdf: kdfSchema,
  label: deviceLabelSchema,
});
export type AccountLoginRequest = z.input<typeof accountLoginRequestSchema>;

/** `POST /api/v1/account/login-details`: poner o cambiar el email y la contraseña. */
export const loginDetailsRequestSchema = z.strictObject({
  email: emailInputSchema,
  authKey: authKeySchema,
  kdf: kdfSchema,
});
export type LoginDetailsRequest = z.input<typeof loginDetailsRequestSchema>;

// --- Respuestas ---

export const steamLinkInfoSchema = z.object({
  /** Instantes ISO 8601 UTC. */
  linkedAt: z.string(),
  refreshedAt: z.string().nullable(),
});
export type SteamLinkInfo = z.output<typeof steamLinkInfoSchema>;

/** `GET /api/v1/account` y las rutas que lo cambian. */
export const accountResponseSchema = z.object({
  /** La agenda tiene email y contraseña. */
  hasLogin: z.boolean(),
  steam: steamLinkInfoSchema.nullable(),
});
export type AccountResponse = z.output<typeof accountResponseSchema>;
