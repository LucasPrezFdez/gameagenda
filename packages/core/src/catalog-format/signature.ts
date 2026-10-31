// Firma del *manifest* (§7.6 y §11.3): ed25519 sobre los bytes UTF-8 del JSON canónico del
// *manifest* sin `sig`. `core` no firma ni verifica, porque no hace E/S ni usa WebCrypto: da esos
// bytes, codifica la firma y guarda las claves públicas. El pipeline firma con `node:crypto` y el
// Worker de búsqueda verifica con WebCrypto (`Ed25519`).
//
// Hay que firmar y verificar el JSON tal como se publica (el resultado de `JSON.parse`), no el que
// devuelve el esquema: Zod quita los campos desconocidos, y un campo nuevo también va firmado.

import { canonicalJson } from './canonical.ts';

/** Bytes que firma el pipeline y verifica el cliente: el JSON canónico de `manifest` sin `sig`. */
export function manifestSigningBytes(manifest: Readonly<Record<string, unknown>>): Uint8Array {
  const { sig: _sig, ...unsigned } = manifest;
  return new TextEncoder().encode(canonicalJson(unsigned));
}

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64URL_VALUE = new Map([...B64URL].map((c, i) => [c, i]));

/** Base64url sin relleno (RFC 4648, §5): la forma de `sig.ed25519` y de las claves públicas. */
export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64URL[(n >> 18) & 63];
    out += B64URL[(n >> 12) & 63];
    if (b !== undefined) out += B64URL[(n >> 6) & 63];
    if (c !== undefined) out += B64URL[n & 63];
  }
  return out;
}

/** Bytes de un texto base64url (con o sin relleno), o `null` si no es base64url válido. */
export function fromBase64Url(text: string): Uint8Array | null {
  const clean = text.replace(/=+$/, '');
  if (clean.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let j = 0;
  for (const c of clean) {
    const v = B64URL_VALUE.get(c);
    if (v === undefined) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[j++] = (acc >> bits) & 0xff;
    }
  }
  // Los bits sobrantes del último carácter tienen que ser ceros (forma canónica).
  if ((acc & ((1 << bits) - 1)) !== 0) return null;
  return out;
}

/** Una clave pública de firma del catálogo: 32 bytes ed25519 en base64url. */
export interface CatalogSigningKey {
  /** `sig.kid` del *manifest* que firma. */
  readonly kid: string;
  readonly ed25519: string;
  /**
   * `dev` firma el mini-catálogo de `fixtures/` y los E2E; su privada está en el repositorio, así
   * que **un *build* de producción nunca debe confiar en ella**.
   */
  readonly use: 'prod' | 'dev';
}

/**
 * Claves públicas conocidas, con hueco para una segunda de producción al rotar (§11.3). La privada
 * de producción solo vive en el secreto `CATALOG_SIGNING_KEY` de GitHub.
 */
export const CATALOG_SIGNING_KEYS: readonly CatalogSigningKey[] = [
  // Privada solo en el secreto `CATALOG_SIGNING_KEY` de GitHub (generada el 31-10-2026).
  { kid: 'prod-1', ed25519: 'Myv8dlFljRr63lGOeNj_YspOLSTgv4p-lK-9HewunvQ', use: 'prod' },
  // Privada en `fixtures/signing/dev-catalog-key.pem` (generada el 31-10-2026).
  { kid: 'dev-1', ed25519: '92ri9B5j6K1FWTuSNRK-B1gRPwJZgOC4BsDI7zjC-80', use: 'dev' },
];

/** Las claves en las que confía un *build*: las de producción y, si `dev`, también la de desarrollo. */
export function trustedSigningKeys(options: {
  readonly dev: boolean;
}): readonly CatalogSigningKey[] {
  return CATALOG_SIGNING_KEYS.filter((key) => key.use === 'prod' || options.dev);
}
