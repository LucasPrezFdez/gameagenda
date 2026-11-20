// Verificación de las llaves de acceso (WebAuthn nivel 3; ADR-013) con `crypto.subtle` y sin
// librerías. La app manda la clave pública en SPKI (`getPublicKey()`), así que no hace falta leer
// CBOR: de `authenticatorData` solo se leen el *hash* del `rp.id`, las marcas, el contador y el id
// de la credencial. La atestación es `none`: quien crea una llave ya es un dispositivo de la agenda,
// y si mintiera sobre su clave solo estropearía su propia agenda.
//
// Algoritmos: Ed25519 (-8), ES256 (-7; la firma llega en DER y WebCrypto la quiere en `r‖s`) y
// RS256 (-257). Una verificación cuesta menos de 1 ms (paso 0 del ADR-013).

import { PASSKEY_ALGORITHMS, type PasskeyAlgorithm } from '@gameagenda/core/api';
import { base64url } from './crypto.ts';

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;
/** `rpIdHash` (32) + marcas (1) + contador (4). */
const AUTH_DATA_MIN = 37;
/** Tras el contador, con AT: AAGUID (16) y la longitud del id (2). */
const CREDENTIAL_ID_OFFSET = AUTH_DATA_MIN + 16 + 2;

// Los tipos, de las firmas de `crypto.subtle`: el tsconfig del Worker no trae los del DOM.
type ImportParams = Parameters<typeof crypto.subtle.importKey>[2];
type VerifyParams = Parameters<typeof crypto.subtle.verify>[0];
type PublicKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

const ALGORITHMS: Readonly<
  Record<PasskeyAlgorithm, { importParams: ImportParams; verify: VerifyParams }>
> = {
  [-8]: { importParams: { name: 'Ed25519' }, verify: { name: 'Ed25519' } },
  [-7]: {
    importParams: { name: 'ECDSA', namedCurve: 'P-256' },
    verify: { name: 'ECDSA', hash: 'SHA-256' },
  },
  [-257]: {
    importParams: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    verify: { name: 'RSASSA-PKCS1-v1_5' },
  },
};

export function isPasskeyAlgorithm(alg: number): alg is PasskeyAlgorithm {
  return (PASSKEY_ALGORITHMS as readonly number[]).includes(alg);
}

/** base64url sin relleno → bytes, o `null` si no lo es. */
export function fromBase64url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export interface ClientData {
  type: string;
  challenge: string;
  origin: string;
  crossOrigin: boolean;
}

/** `clientDataJSON` (UTF-8): solo lo que se comprueba, o `null` si no tiene esa forma. */
export function parseClientData(bytes: Uint8Array): ClientData | null {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { type, challenge, origin, crossOrigin } = value as Record<string, unknown>;
  if (typeof type !== 'string' || typeof challenge !== 'string' || typeof origin !== 'string') {
    return null;
  }
  return { type, challenge, origin, crossOrigin: crossOrigin === true };
}

export interface AuthenticatorData {
  rpIdHash: Uint8Array;
  flags: number;
  signCount: number;
  /** Con la marca AT (al crear): el id de la credencial. */
  credentialId: Uint8Array | null;
}

/** `authenticatorData`, o `null` si es más corto de lo que dice. */
export function parseAuthenticatorData(bytes: Uint8Array): AuthenticatorData | null {
  if (bytes.length < AUTH_DATA_MIN) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flags = view.getUint8(32);
  const signCount = view.getUint32(33);
  let credentialId: Uint8Array | null = null;
  if (flags & FLAG_AT) {
    if (bytes.length < CREDENTIAL_ID_OFFSET) return null;
    const length = view.getUint16(AUTH_DATA_MIN + 16);
    if (length === 0 || bytes.length < CREDENTIAL_ID_OFFSET + length) return null;
    credentialId = bytes.slice(CREDENTIAL_ID_OFFSET, CREDENTIAL_ID_OFFSET + length);
  }
  return { rpIdHash: bytes.slice(0, 32), flags, signCount, credentialId };
}

/**
 * Firma ECDSA en DER (`SEQUENCE { INTEGER r, INTEGER s }`) → `r‖s` de 64 bytes, como la quiere
 * WebCrypto; `null` si no es una firma de P-256 bien formada.
 */
export function derToRaw(der: Uint8Array): Uint8Array<ArrayBuffer> | null {
  if (der.length < 8 || der[0] !== 0x30 || der[1] !== der.length - 2) return null;
  const out = new Uint8Array(64);
  let offset = 2;
  for (const half of [0, 1]) {
    if (der[offset] !== 0x02) return null;
    const length = der[offset + 1] ?? 0;
    const start = offset + 2;
    if (length === 0 || start + length > der.length) return null;
    let value = der.subarray(start, start + length);
    while (value.length > 32 && value[0] === 0) value = value.subarray(1);
    if (value.length > 32) return null;
    out.set(value, half * 32 + 32 - value.length);
    offset = start + length;
  }
  return offset === der.length ? out : null;
}

async function importPublicKey(
  spki: Uint8Array<ArrayBuffer>,
  alg: PasskeyAlgorithm,
): Promise<PublicKey | null> {
  try {
    return await crypto.subtle.importKey('spki', spki, ALGORITHMS[alg].importParams, false, [
      'verify',
    ]);
  } catch {
    return null;
  }
}

/** Lo que se espera de toda llave: el reto que se dio, el origen de la app y su `rp.id`. */
export interface Expected {
  challenge: string;
  origin: string;
  rpId: string;
}

/** Lo común a crear y a entrar: tipo, reto, origen, `rp.id` y las marcas UP y UV. */
async function checkCeremony(
  clientDataBytes: Uint8Array,
  authDataBytes: Uint8Array,
  type: 'webauthn.create' | 'webauthn.get',
  expected: Expected,
): Promise<AuthenticatorData | null> {
  const clientData = parseClientData(clientDataBytes);
  if (
    clientData === null ||
    clientData.type !== type ||
    clientData.challenge !== expected.challenge ||
    clientData.origin !== expected.origin ||
    clientData.crossOrigin
  ) {
    return null;
  }
  const auth = parseAuthenticatorData(authDataBytes);
  if (auth === null) return null;
  const rpIdHash = await sha256(new TextEncoder().encode(expected.rpId));
  if (!equalBytes(auth.rpIdHash, rpIdHash)) return null;
  // Presencia (UP) y verificación del usuario (UV: Face ID, huella o PIN): las dos, siempre.
  if (!(auth.flags & FLAG_UP) || !(auth.flags & FLAG_UV)) return null;
  return auth;
}

export interface RegistrationInput {
  id: string;
  clientDataJSON: string;
  authenticatorData: string;
  publicKey: string;
  publicKeyAlgorithm: number;
}

export interface VerifiedRegistration {
  credentialId: string;
  publicKey: string;
  alg: PasskeyAlgorithm;
  signCount: number;
}

/** Comprueba una llave recién creada (`webauthn.create`); `null` si algo no cuadra. */
export async function verifyRegistration(
  input: RegistrationInput,
  expected: Expected,
): Promise<VerifiedRegistration | null> {
  const clientData = fromBase64url(input.clientDataJSON);
  const authData = fromBase64url(input.authenticatorData);
  const spki = fromBase64url(input.publicKey);
  if (clientData === null || authData === null || spki === null) return null;
  const auth = await checkCeremony(clientData, authData, 'webauthn.create', expected);
  if (auth === null || auth.credentialId === null) return null;
  // El id que dice la app tiene que ser el de `authenticatorData`.
  if (base64url(auth.credentialId) !== input.id) return null;
  const alg = input.publicKeyAlgorithm;
  if (!isPasskeyAlgorithm(alg)) return null;
  if ((await importPublicKey(spki, alg)) === null) return null;
  return { credentialId: input.id, publicKey: input.publicKey, alg, signCount: auth.signCount };
}

export interface AssertionInput {
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
}

export interface StoredPasskey {
  publicKey: string;
  alg: PasskeyAlgorithm;
  signCount: number;
}

/**
 * Comprueba una entrada con llave (`webauthn.get`) con la clave guardada. Devuelve el contador
 * que hay que guardar, o `null` si algo no cuadra.
 *
 * El contador: las llaves sincronizadas (iCloud, Google) mandan siempre 0. Solo se rechaza si el
 * guardado y el nuevo son mayores que 0 y el nuevo no sube, que es lo que haría una llave clonada.
 */
export async function verifyAssertion(
  input: AssertionInput,
  stored: StoredPasskey,
  expected: Expected,
): Promise<{ signCount: number } | null> {
  const clientData = fromBase64url(input.clientDataJSON);
  const authData = fromBase64url(input.authenticatorData);
  const rawSignature = fromBase64url(input.signature);
  const spki = fromBase64url(stored.publicKey);
  if (clientData === null || authData === null || rawSignature === null || spki === null) {
    return null;
  }
  const auth = await checkCeremony(clientData, authData, 'webauthn.get', expected);
  if (auth === null) return null;
  const key = await importPublicKey(spki, stored.alg);
  if (key === null) return null;
  const signature = stored.alg === -7 ? derToRaw(rawSignature) : rawSignature;
  if (signature === null) return null;
  const signed = new Uint8Array(authData.length + 32);
  signed.set(authData);
  signed.set(await sha256(clientData), authData.length);
  let valid = false;
  try {
    valid = await crypto.subtle.verify(ALGORITHMS[stored.alg].verify, key, signature, signed);
  } catch {
    return null;
  }
  if (!valid) return null;
  if (auth.signCount > 0 && stored.signCount > 0 && auth.signCount <= stored.signCount) return null;
  return { signCount: Math.max(auth.signCount, stored.signCount) };
}
