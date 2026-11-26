// Lo que la micro-API guarda del email y de la contraseña de una cuenta (ADR-014): dos HMAC-SHA256
// con el secreto `ACCOUNT_PEPPER`. El trabajo lento lo hace el dispositivo (PBKDF2, 600 000
// vueltas): aquí llega `authKey`, que ya tiene 256 bits, así que un HMAC basta y cuesta
// microsegundos (los 10 ms de CPU del plan gratuito). Quien robe D1 sin el secreto no puede probar
// contraseñas ni leer emails; con el secreto, cada contraseña que pruebe le cuesta las 600 000
// vueltas de PBKDF2.
//
// - `email_hash`: `HMAC(pepper, "email\0" ‖ email)`. Sirve para buscar la cuenta y para que un
//   email no tenga dos; no se puede leer.
// - `pw_verifier`: `HMAC(pepper, "pw\0" ‖ sal ‖ "\0" ‖ authKey)`, con 16 bytes aleatorios de sal por
//   cuenta, para que dos cuentas con la misma contraseña no den lo mismo.

import { base64url } from './crypto.ts';

const encoder = new TextEncoder();

/** La clave del HMAC (el tipo `CryptoKey` no está en las bibliotecas del Worker). */
type PepperKey = ReturnType<typeof crypto.subtle.importKey>;

/** Una clave por secreto y por *isolate*: importarla cuesta. */
let cached: { source: string; key: PepperKey } | null = null;

function pepperKey(pepper: string): PepperKey {
  if (cached?.source !== pepper) {
    const key = crypto.subtle.importKey(
      'raw',
      encoder.encode(pepper),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    cached = { source: pepper, key };
  }
  return cached.key;
}

async function hmac(pepper: string, text: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.sign('HMAC', await pepperKey(pepper), encoder.encode(text)),
  );
}

/** El HMAC de un email ya normalizado (`normalizeEmail` de core), en base64url. */
export async function emailHash(pepper: string, email: string): Promise<string> {
  return base64url(await hmac(pepper, `email\0${email}`));
}

/** La sal de una cuenta: 16 bytes aleatorios en base64url. */
export function newPasswordSalt(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(16)));
}

export async function passwordVerifier(
  pepper: string,
  salt: string,
  authKey: string,
): Promise<string> {
  return base64url(await hmac(pepper, `pw\0${salt}\0${authKey}`));
}

/** ¿Iguales? Recorre siempre todo, para no decir por el tiempo cuánto se parecen. */
export function sameSecret(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
