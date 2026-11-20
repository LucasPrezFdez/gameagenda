// Contrato de las llaves de acceso (ADR-013): lo que manda la app a `/api/v1/passkeys/*` (objetos
// estrictos, como el resto de la micro-API) y lo que responde el Worker. Los datos de WebAuthn van
// en base64url sin relleno, como los da `PublicKeyCredential.toJSON()`. La app manda la clave
// pública en SPKI (`getPublicKey()`), así que el Worker no lee CBOR.

import '../zod-config.ts';
import * as z from 'zod';
import { PASSKEYS_MAX } from './constants.ts';
import { deviceLabelSchema } from './schemas.ts';

/** base64url sin relleno, con un tope en caracteres. */
const base64url = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+$/);

/** El id de una credencial: hasta 1 023 bytes (WebAuthn), 1 364 caracteres. */
const credentialIdSchema = base64url(1364);
/** `clientDataJSON` y `authenticatorData`: unos cientos de bytes; con extensiones, algo más. */
const webauthnDataSchema = base64url(8192);

// --- Peticiones ---

/** `POST /api/v1/passkeys`: la llave recién creada en el navegador. */
export const passkeyCreateRequestSchema = z.strictObject({
  id: credentialIdSchema,
  clientDataJSON: webauthnDataSchema,
  authenticatorData: webauthnDataSchema,
  /** SPKI (DER): ≈44 bytes con Ed25519, 91 con P-256 y 294 con RSA de 2 048 bits. */
  publicKey: base64url(2048),
  publicKeyAlgorithm: z.int(),
  /** Los que no se conocen se ignoran (`PASSKEY_TRANSPORTS`). */
  transports: z.array(z.string().max(32)).max(16),
});
export type PasskeyCreateRequest = z.input<typeof passkeyCreateRequestSchema>;

/** `POST /api/v1/passkeys/redeem`: entrar en la agenda con una llave, desde un dispositivo nuevo. */
export const passkeyRedeemRequestSchema = z.strictObject({
  id: credentialIdSchema,
  clientDataJSON: webauthnDataSchema,
  authenticatorData: webauthnDataSchema,
  /** Con RSA de 4 096 bits, 512 bytes. */
  signature: base64url(1024),
  /** El `user.id` de la llave; con llaves detectables llega siempre, pero no se exige. */
  userHandle: base64url(128).nullable(),
  label: deviceLabelSchema,
});
export type PasskeyRedeemRequest = z.input<typeof passkeyRedeemRequestSchema>;

// --- Respuestas ---

/** `POST /api/v1/passkeys/options`: lo que necesita `navigator.credentials.create()`. */
export const passkeyCreationOptionsSchema = z.object({
  challenge: z.string(),
  rpId: z.string(),
  /** `user.id`: 32 bytes aleatorios por agenda, en base64url. */
  userId: z.string(),
  /** Las llaves que ya tiene la agenda, para que el llavero no cree otra igual. */
  excludeCredentials: z
    .array(z.object({ id: z.string(), transports: z.array(z.string()) }))
    .max(PASSKEYS_MAX),
});
export type PasskeyCreationOptions = z.output<typeof passkeyCreationOptionsSchema>;

/** `POST /api/v1/passkeys/challenge`: lo que necesita `navigator.credentials.get()`. */
export const passkeyChallengeResponseSchema = z.object({ challenge: z.string(), rpId: z.string() });
export type PasskeyChallengeResponse = z.output<typeof passkeyChallengeResponseSchema>;

export const passkeyInfoSchema = z.object({
  id: z.string(),
  /** El nombre del dispositivo donde se creó. */
  label: z.string(),
  createdAt: z.string(),
  /** Instante ISO 8601 UTC de la última vez que abrió la agenda; `null` si nunca. */
  lastUsedAt: z.string().nullable(),
});
export type PasskeyInfo = z.output<typeof passkeyInfoSchema>;

/** `GET /api/v1/passkeys` y `POST /api/v1/passkeys` (con la lista nueva). */
export const passkeysResponseSchema = z.object({
  passkeys: z.array(passkeyInfoSchema),
  /** El `user.id` de la agenda, para avisar al llavero de las llaves que ya no valen; o `null`. */
  userId: z.string().nullable(),
  rpId: z.string(),
});
export type PasskeysResponse = z.output<typeof passkeysResponseSchema>;
