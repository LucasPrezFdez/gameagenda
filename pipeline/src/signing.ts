// Firma del *manifest* (§7.6 y §11.3): ed25519 con `node:crypto` sobre `manifestSigningBytes` del
// *manifest* tal como se publica (el objeto, no la salida de Zod). La privada de producción solo
// vive en el secreto `CATALOG_SIGNING_KEY` de GitHub y solo firma en GitHub Actions: el PC nunca
// firma con ella (DECISIONES §10.12). Para desarrollo y *fixtures*, `--dev-sign` firma con la de
// `fixtures/signing/dev-catalog-key.pem` (`dev-1`), en la que ningún *build* de producción confía.

import { createPrivateKey, createPublicKey, type KeyObject, sign, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  CATALOG_SIGNING_KEYS,
  type CatalogSigningKey,
  fromBase64Url,
  manifestSigningBytes,
  toBase64Url,
} from '@gameagenda/core/catalog-format';

export const DEV_KID = 'dev-1';

/** Clave privada lista para firmar, con su `kid` y su uso (`prod` o `dev`). */
export interface Signer {
  readonly kid: string;
  readonly use: CatalogSigningKey['use'];
  readonly key: KeyObject;
}

/** Pública ed25519 de una privada, en base64url (la forma de `CATALOG_SIGNING_KEYS`). */
export function publicKeyOf(key: KeyObject): string {
  const jwk = createPublicKey(key).export({ format: 'jwk' });
  if (jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string') throw new Error('La clave no es ed25519');
  return jwk.x;
}

/**
 * Privada PKCS#8 (PEM) con su `kid`. El `kid` tiene que estar en `CATALOG_SIGNING_KEYS` y su
 * pública, casar: un *manifest* firmado con una clave que la app no conoce se descartaría.
 */
export function signerFromPem(
  pem: string,
  kid: string,
  known: readonly CatalogSigningKey[] = CATALOG_SIGNING_KEYS,
): Signer {
  let key: KeyObject;
  try {
    // Un secreto pegado en una sola línea trae los saltos como «\n».
    key = createPrivateKey({ key: pem.replace(/\\n/g, '\n'), format: 'pem' });
  } catch {
    throw new Error('CATALOG_SIGNING_KEY no es una clave privada PKCS#8 en PEM');
  }
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('La clave de firma no es ed25519');
  const entry = known.find((k) => k.kid === kid);
  if (!entry) {
    throw new Error(`kid «${kid}» desconocido: su pública tiene que estar en CATALOG_SIGNING_KEYS`);
  }
  if (publicKeyOf(key) !== entry.ed25519) {
    throw new Error(`La clave de firma no corresponde a la pública de «${kid}»`);
  }
  return { kid, use: entry.use, key };
}

export interface SignerOptions {
  /** `--dev-sign`: firma con la clave de desarrollo. */
  readonly devSign: boolean;
  /** Ruta de `fixtures/signing/dev-catalog-key.pem`. */
  readonly devKeyPath: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly known?: readonly CatalogSigningKey[];
}

/**
 * Clave de firma de la ejecución: `--dev-sign`, o `CATALOG_SIGNING_KEY` con `CATALOG_SIGNING_KID`;
 * sin ninguna, `null` (*manifest* sin firma). Una clave de producción fuera de GitHub Actions
 * (`GITHUB_ACTIONS=true`) es un error (§11.3).
 */
export function loadSigner(opts: SignerOptions): Signer | null {
  const { env } = opts;
  if (opts.devSign) {
    return signerFromPem(readFileSync(opts.devKeyPath, 'utf8'), DEV_KID, opts.known);
  }
  const pem = env.CATALOG_SIGNING_KEY?.trim();
  if (!pem) return null;
  const kid = env.CATALOG_SIGNING_KID?.trim();
  if (!kid) throw new Error('Falta CATALOG_SIGNING_KID para la clave de CATALOG_SIGNING_KEY');
  const signer = signerFromPem(pem, kid, opts.known);
  if (signer.use === 'prod' && env.GITHUB_ACTIONS !== 'true') {
    throw new Error(
      'La clave de producción solo firma en GitHub Actions: el PC construye sin firma (§11.3)',
    );
  }
  return signer;
}

/** El *manifest* con `sig` = `{kid, ed25519}` sobre su JSON canónico sin `sig`. */
export function signManifest<T extends Record<string, unknown>>(
  manifest: T,
  signer: Signer,
): T & { sig: { kid: string; ed25519: string } } {
  const { sig: _old, ...unsigned } = manifest;
  const signature = sign(null, manifestSigningBytes(unsigned), signer.key);
  return {
    ...(unsigned as T),
    sig: { kid: signer.kid, ed25519: toBase64Url(new Uint8Array(signature)) },
  };
}

/** `true` si `sig` es una firma válida de una de `keys` (lo que hará el cliente con WebCrypto). */
export function verifyManifest(
  manifest: Readonly<Record<string, unknown>>,
  keys: readonly CatalogSigningKey[],
): boolean {
  const sig = manifest.sig as { kid?: unknown; ed25519?: unknown } | undefined;
  if (!sig || typeof sig.kid !== 'string' || typeof sig.ed25519 !== 'string') return false;
  const entry = keys.find((k) => k.kid === sig.kid);
  const bytes = fromBase64Url(sig.ed25519);
  if (!entry || !bytes) return false;
  const pub = createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: entry.ed25519 },
    format: 'jwk',
  });
  return verify(null, manifestSigningBytes(manifest), pub, bytes);
}
