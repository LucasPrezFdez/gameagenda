// Firma del *manifest* (§7.6 y §11.3): ed25519 sobre el JSON canónico tal como se publica, la
// clave de desarrollo y las salvaguardas de la de producción.

import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  type CatalogSigningKey,
  manifestSigningBytes,
  trustedSigningKeys,
} from '@gameagenda/core/catalog-format';
import { describe, expect, it } from 'vitest';
import {
  DEV_KID,
  loadSigner,
  publicKeyOf,
  signerFromPem,
  signManifest,
  verifyManifest,
} from '../src/signing.ts';

const DEV_PEM_PATH = fileURLToPath(
  new URL('../../fixtures/signing/dev-catalog-key.pem', import.meta.url),
);
const DEV_PEM = readFileSync(DEV_PEM_PATH, 'utf8');
const MANIFEST = { format: 'gacat', v: 1, version: '20261031.1', counts: { core: 1 } };

function prodPair(): { pem: string; known: CatalogSigningKey[] } {
  const { privateKey } = generateKeyPairSync('ed25519');
  const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  return { pem, known: [{ kid: 'prod-1', ed25519: publicKeyOf(privateKey), use: 'prod' }] };
}

describe('firma con la clave de desarrollo', () => {
  it('firma el JSON canónico sin sig y la app lo verifica solo si confía en dev', () => {
    const signer = signerFromPem(DEV_PEM, DEV_KID);
    const signed = signManifest(MANIFEST, signer);
    expect(signed.sig.kid).toBe('dev-1');
    expect(signed.sig.ed25519).toMatch(/^[A-Za-z0-9_-]{86}$/);
    expect(verifyManifest(signed, trustedSigningKeys({ dev: true }))).toBe(true);
    expect(verifyManifest(signed, trustedSigningKeys({ dev: false }))).toBe(false);
    // El orden de las claves no importa (JCS); un campo de más o cambiado, sí.
    const reordered = JSON.parse(JSON.stringify({ sig: signed.sig, ...MANIFEST }));
    expect(verifyManifest(reordered, trustedSigningKeys({ dev: true }))).toBe(true);
    expect(verifyManifest({ ...signed, extra: 1 }, trustedSigningKeys({ dev: true }))).toBe(false);
    expect(
      verifyManifest({ ...signed, version: '20261031.2' }, trustedSigningKeys({ dev: true })),
    ).toBe(false);
    // Volver a firmar sustituye la firma, no la firma a ella.
    expect(signManifest(signed, signer).sig).toEqual(signed.sig);
    expect(manifestSigningBytes(signed)).toEqual(manifestSigningBytes(MANIFEST));
  });

  it('--dev-sign carga la de fixtures/signing; sin nada, no se firma', () => {
    expect(loadSigner({ devSign: true, devKeyPath: DEV_PEM_PATH, env: {} })?.kid).toBe('dev-1');
    expect(loadSigner({ devSign: false, devKeyPath: DEV_PEM_PATH, env: {} })).toBeNull();
  });
});

describe('salvaguardas', () => {
  it('kid desconocido, clave que no casa con su kid o que no es PEM: error', () => {
    expect(() => signerFromPem(DEV_PEM, 'prod-9')).toThrow('desconocido');
    expect(() => signerFromPem(prodPair().pem, DEV_KID)).toThrow('no corresponde');
    expect(() => signerFromPem('no es una clave', DEV_KID)).toThrow('PKCS#8');
    expect(() =>
      loadSigner({
        devSign: false,
        devKeyPath: DEV_PEM_PATH,
        env: { CATALOG_SIGNING_KEY: DEV_PEM },
      }),
    ).toThrow('CATALOG_SIGNING_KID');
  });

  it('la clave de producción solo firma en GitHub Actions (§11.3)', () => {
    const { pem, known } = prodPair();
    const env = { CATALOG_SIGNING_KEY: pem, CATALOG_SIGNING_KID: 'prod-1' };
    expect(() => loadSigner({ devSign: false, devKeyPath: DEV_PEM_PATH, env, known })).toThrow(
      'GitHub Actions',
    );
    const ci = loadSigner({
      devSign: false,
      devKeyPath: DEV_PEM_PATH,
      env: { ...env, GITHUB_ACTIONS: 'true' },
      known,
    });
    expect(ci).toMatchObject({ kid: 'prod-1', use: 'prod' });
    const signed = signManifest(MANIFEST, ci as NonNullable<typeof ci>);
    expect(verifyManifest(signed, known)).toBe(true);
    // Un secreto pegado en una línea, con «\n» literales, también vale.
    const oneLine = loadSigner({
      devSign: false,
      devKeyPath: DEV_PEM_PATH,
      env: { ...env, CATALOG_SIGNING_KEY: pem.replace(/\n/g, '\\n'), GITHUB_ACTIONS: 'true' },
      known,
    });
    expect(oneLine?.kid).toBe('prod-1');
  });
});
