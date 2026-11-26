// Reglas de las cuentas (ADR-014), sin Zod ni criptografía: las comparten el Worker, que vuelve a
// normalizar el email que recibe, y la app, que además saca de él la sal de PBKDF2
// (`apps/web/src/sync/account-key.ts`). Si cambia la normalización, cambian las sales y nadie puede
// entrar: va con versión (`ACCOUNT_SALT_PREFIX`).

import { ACCOUNT_EMAIL_MAX, ACCOUNT_PASSWORD_MAX, ACCOUNT_PASSWORD_MIN } from './constants.ts';

/** Lo que va delante del email en la sal: `SHA-256(prefijo ‖ email)`. */
export const ACCOUNT_SALT_PREFIX = 'gameagenda/cuenta/v1\0';

/**
 * El email tal como se guarda y se deriva: sin espacios en los extremos, en NFC y en minúsculas.
 * `null` si no lo parece: sin `@`, con algo antes y después, sin espacios ni caracteres de control
 * dentro, y como mucho `ACCOUNT_EMAIL_MAX` caracteres. No se comprueba nada más, porque no se envía
 * ningún correo.
 */
export function normalizeEmail(text: string): string | null {
  const email = text.trim().normalize('NFC').toLowerCase();
  if (email.length === 0 || email.length > ACCOUNT_EMAIL_MAX) return null;
  if (/[\s\p{Cc}]/u.test(email)) return null;
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return null;
  return email;
}

export type PasswordProblem = 'too_short' | 'too_long' | 'same_as_email';

/** La contraseña en NFC: la misma que escriba el usuario en otro teclado u otro sistema. */
export function normalizePassword(password: string): string {
  return password.normalize('NFC');
}

/**
 * Por qué no vale una contraseña, o `null` si vale (NIST SP 800-63B): de `ACCOUNT_PASSWORD_MIN` a
 * `ACCOUNT_PASSWORD_MAX` caracteres (puntos de código, en NFC), sin reglas de composición, y que no
 * sea el propio email.
 */
export function passwordProblem(password: string, email: string): PasswordProblem | null {
  const normalized = normalizePassword(password);
  const length = [...normalized].length;
  if (length < ACCOUNT_PASSWORD_MIN) return 'too_short';
  if (length > ACCOUNT_PASSWORD_MAX) return 'too_long';
  const plain = normalizeEmail(email);
  if (plain !== null && normalized.trim().toLowerCase() === plain) return 'same_as_email';
  return null;
}
