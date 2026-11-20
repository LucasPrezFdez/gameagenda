// Secretos de la micro-API (§7.7 y §11.4): todo sale de `crypto.getRandomValues` y D1 solo guarda
// su SHA-256. Con ≥128 bits aleatorios no hace falta un *hash* lento: adivinar es inviable igual.

import { CODE_SYMBOLS, codeFromBytes } from '@gameagenda/core/api';

const encoder = new TextEncoder();

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Credencial de dispositivo: 256 bits en base64url (43 caracteres). */
export function newDeviceToken(): string {
  return base64url(randomBytes(32));
}

/** Ticket del login con Steam (ADR-012): 256 bits en base64url, como la credencial. */
export function newSteamTicket(): string {
  return base64url(randomBytes(32));
}

/** Reto de una llave de acceso (ADR-013): 256 bits en base64url. D1 solo guarda su SHA-256. */
export function newPasskeyChallenge(): string {
  return base64url(randomBytes(32));
}

/** El `user.id` de las llaves de una agenda (ADR-013): 32 bytes aleatorios, no el id de la agenda. */
export function newPasskeyUserId(): string {
  return base64url(randomBytes(32));
}

/** Código de emparejamiento o de recuperación, canónico: 140 bits (ver `codes.ts` de core). */
export function newCode(): string {
  return codeFromBytes(randomBytes(CODE_SYMBOLS));
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
  let hex = '';
  for (const b of digest) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/** `BASE64URL(SHA-256(texto))`: el `challenge` de un verificador (`S256` de PKCE, RFC 7636). */
export async function sha256Base64url(text: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))));
}
