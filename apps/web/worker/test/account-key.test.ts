// La clave que sale de la contraseña (ADR-014): PBKDF2-HMAC-SHA256 con la sal SHA-256(prefijo ‖
// email) y 600 000 vueltas. Si cambia algo (la sal, las vueltas, la normalización), nadie puede
// entrar con su contraseña: el vector fijo lo impide sin querer.

import { createHash, pbkdf2Sync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { deriveAuthKey } from '../../src/sync/account-key.ts';
import { SyncError } from '../../src/sync/types.ts';

const PASSWORD = 'una frase larga de prueba';

describe('deriveAuthKey', () => {
  it('es PBKDF2-HMAC-SHA256 sobre la sal SHA-256(prefijo ‖ email normalizado)', async () => {
    const salt = createHash('sha256').update('gameagenda/cuenta/v1\0lucas@example.com').digest();
    const expected = pbkdf2Sync(PASSWORD, salt, 1000, 32, 'sha256').toString('base64url');
    expect(await deriveAuthKey(' Lucas@Example.COM ', PASSWORD, 1000)).toBe(expected);
  });

  it('con las vueltas de verdad, el vector de siempre', async () => {
    expect(await deriveAuthKey('lucas@example.com', PASSWORD)).toBe(
      '3tTNui5EDJvr2iy5FoikVOz1uj4RQv0BlHp-zWS88ME',
    );
  });

  it('la contraseña, en NFC: «é» compuesta o descompuesta da lo mismo', async () => {
    const composed = await deriveAuthKey('a@b.es', 'contraseña café', 1000);
    expect(await deriveAuthKey('a@b.es', 'contraseña café', 1000)).toBe(composed);
  });

  it('un email que no lo parece es invalid_login, sin calcular nada', async () => {
    await expect(deriveAuthKey('sin arroba', PASSWORD)).rejects.toEqual(
      new SyncError('invalid_login'),
    );
  });
});
