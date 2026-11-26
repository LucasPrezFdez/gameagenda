// Las reglas de las cuentas (ADR-014): cómo se normaliza el email (de él sale la sal de PBKDF2, así
// que no puede cambiar sin versión) y qué contraseñas valen. También, los esquemas de las rutas.

import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_KDF,
  ACCOUNT_PASSWORD_MAX,
  ACCOUNT_PASSWORD_MIN,
  ACCOUNT_SALT_PREFIX,
  accountCreateRequestSchema,
  accountLoginRequestSchema,
  accountResponseSchema,
  normalizeEmail,
  passwordProblem,
} from '../src/api/index.ts';

describe('normalizeEmail', () => {
  it('sin espacios en los extremos, en minúsculas y en NFC', () => {
    expect(normalizeEmail('  Lucas@Example.COM\n')).toBe('lucas@example.com');
    // «é» compuesta y descompuesta dan lo mismo.
    expect(normalizeEmail('josé@example.es')).toBe(normalizeEmail('josé@example.es'));
    expect(normalizeEmail('ÁLVARO@EJEMPLO.ES')).toBe('álvaro@ejemplo.es');
  });

  it('rechaza lo que no lo parece', () => {
    for (const text of [
      '',
      '   ',
      'sin-arroba',
      '@example.com',
      'lucas@',
      'a b@c.es',
      'a@b\u0000.es',
    ]) {
      expect(normalizeEmail(text), JSON.stringify(text)).toBeNull();
    }
    expect(normalizeEmail(`${'a'.repeat(250)}@b.es`)).toBeNull();
    expect(normalizeEmail(`${'a'.repeat(249)}@b.es`)).not.toBeNull();
  });

  it('admite una arroba en la parte local entre comillas (la última es la del dominio)', () => {
    expect(normalizeEmail('"a@b"@example.com')).toBe('"a@b"@example.com');
  });

  it('la sal va con versión', () => {
    expect(ACCOUNT_SALT_PREFIX).toBe('gameagenda/cuenta/v1\0');
    expect(ACCOUNT_KDF).toBe('pbkdf2-sha256-600000');
  });
});

describe('passwordProblem', () => {
  it(`de ${ACCOUNT_PASSWORD_MIN} a ${ACCOUNT_PASSWORD_MAX} caracteres, sin reglas de composición`, () => {
    expect(passwordProblem('a'.repeat(ACCOUNT_PASSWORD_MIN - 1), 'x@y.es')).toBe('too_short');
    expect(passwordProblem('a'.repeat(ACCOUNT_PASSWORD_MIN), 'x@y.es')).toBeNull();
    expect(passwordProblem('a'.repeat(ACCOUNT_PASSWORD_MAX), 'x@y.es')).toBeNull();
    expect(passwordProblem('a'.repeat(ACCOUNT_PASSWORD_MAX + 1), 'x@y.es')).toBe('too_long');
    expect(passwordProblem('solo minúsculas y espacios', 'x@y.es')).toBeNull();
  });

  it('cuenta caracteres, no unidades de UTF-16', () => {
    // 11 emojis son 22 unidades de UTF-16, pero 11 caracteres: corta.
    expect(passwordProblem('🎮'.repeat(ACCOUNT_PASSWORD_MIN - 1), 'x@y.es')).toBe('too_short');
    expect(passwordProblem('🎮'.repeat(ACCOUNT_PASSWORD_MIN), 'x@y.es')).toBeNull();
  });

  it('no puede ser el propio email', () => {
    expect(passwordProblem('Lucas@Example.com', 'lucas@example.com')).toBe('same_as_email');
    expect(passwordProblem('lucas@example.com ', ' LUCAS@example.com')).toBe('same_as_email');
  });
});

describe('los esquemas', () => {
  const authKey = 'A'.repeat(43);

  it('crear y entrar: objetos estrictos, con el kdf de ahora', () => {
    const create = {
      email: 'x@y.es',
      authKey,
      kdf: ACCOUNT_KDF,
      ageConfirmed: true,
      minAge: 14,
      label: 'PC',
    };
    expect(accountCreateRequestSchema.safeParse(create).success).toBe(true);
    expect(accountCreateRequestSchema.safeParse({ ...create, password: 'x' }).success).toBe(false);
    expect(accountCreateRequestSchema.safeParse({ ...create, kdf: 'otro' }).success).toBe(false);
    expect(accountCreateRequestSchema.safeParse({ ...create, ageConfirmed: false }).success).toBe(
      false,
    );
    const login = { email: 'x@y.es', authKey, kdf: ACCOUNT_KDF, label: 'PC' };
    expect(accountLoginRequestSchema.safeParse(login).success).toBe(true);
    expect(accountLoginRequestSchema.safeParse({ ...login, authKey: `${authKey}=` }).success).toBe(
      false,
    );
  });

  it('la respuesta es abierta: un cliente viejo acepta campos nuevos', () => {
    const parsed = accountResponseSchema.parse({ hasLogin: true, steam: null, nuevo: 1 });
    expect(parsed).toEqual({ hasLogin: true, steam: null });
  });
});
