// La contraseña de la cuenta, en el dispositivo (ADR-014): nunca sale de aquí. Lo que viaja es
// `authKey = PBKDF2-HMAC-SHA256(contraseña en NFC, SHA-256(prefijo ‖ email), 600 000 vueltas)`,
// 256 bits en base64url. El trabajo lento se hace aquí porque el Worker solo tiene 10 ms de CPU: allí
// basta un HMAC. La sal sale del email, así que no hace falta preguntar al servidor por ella (y no
// hay una ruta que diga si un email existe). Va en el *chunk* del motor, con WebCrypto, que hace el
// cálculo fuera del hilo principal.

import {
  ACCOUNT_KDF_ITERATIONS,
  ACCOUNT_SALT_PREFIX,
  normalizeEmail,
  normalizePassword,
} from '@gameagenda/core/api';
import { toBase64url } from './passkeys.ts';
import { SyncError } from './types.ts';

const encoder = new TextEncoder();

/** La sal de un email ya normalizado (`normalizeEmail`). */
export async function accountSalt(email: string): Promise<Uint8Array<ArrayBuffer>> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(ACCOUNT_SALT_PREFIX + email));
  return new Uint8Array(digest);
}

/**
 * `authKey` de un email y una contraseña. Un email que no lo parece da `invalid_login`: no hay
 * cuenta con él (y al crear, la pantalla ya lo ha comprobado antes).
 */
export async function deriveAuthKey(
  email: string,
  password: string,
  iterations = ACCOUNT_KDF_ITERATIONS,
): Promise<string> {
  const normalized = normalizeEmail(email);
  if (normalized === null) throw new SyncError('invalid_login');
  const base = await crypto.subtle.importKey(
    'raw',
    encoder.encode(normalizePassword(password)),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: await accountSalt(normalized), iterations },
    base,
    256,
  );
  return toBase64url(bits);
}
