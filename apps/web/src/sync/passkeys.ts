// Llaves de acceso en el navegador (ADR-013): `navigator.credentials.create()` y `get()`, y lo que
// se manda a la micro-API, en base64url. La clave pública va en SPKI (`getPublicKey()`), así que
// el Worker no lee CBOR. Va en el *chunk* diferido del motor, con el cliente de la micro-API.
//
// Errores del navegador → `SyncError`:
// - `NotAllowedError`: el usuario cerró el diálogo, o se agotó el tiempo → `passkey_cancelled`
//   (la pantalla vuelve sin mensaje);
// - `InvalidStateError` al crear: ese llavero ya tiene una llave de esta agenda
//   (`excludeCredentials`) → `passkey_exists`;
// - lo demás → `passkey_failed`.
import {
  PASSKEY_ALGORITHMS,
  PASSKEY_RP_NAME,
  PASSKEY_USER_NAME,
  type PasskeyChallengeResponse,
  type PasskeyCreateRequest,
  type PasskeyCreationOptions,
  type PasskeyRedeemRequest,
} from '@gameagenda/core/api';
import { SyncError } from './types.ts';

/** El diálogo del navegador, como mucho (el reto vale 5 min). */
const CEREMONY_TIMEOUT_MS = 4 * 60_000;

export function toBase64url(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Lo que se usa del navegador; las pruebas pasan uno falso. */
export interface WebAuthnHost {
  readonly credentials: Pick<CredentialsContainer, 'create' | 'get'>;
}

function browserHost(): WebAuthnHost {
  return { credentials: navigator.credentials };
}

/** Una credencial de llave de acceso (sin `instanceof`: en las pruebas no existe la clase). */
function asPublicKey(credential: Credential | null): PublicKeyCredential | null {
  return credential !== null && credential.type === 'public-key' && 'response' in credential
    ? (credential as PublicKeyCredential)
    : null;
}

function ceremonyError(error: unknown, creating: boolean): SyncError {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'AbortError')
    return new SyncError('passkey_cancelled');
  if (creating && name === 'InvalidStateError') return new SyncError('passkey_exists');
  return new SyncError('passkey_failed');
}

/** Crea una llave detectable con las opciones de `POST /passkeys/options`. */
export async function createPasskeyCredential(
  options: PasskeyCreationOptions,
  host: WebAuthnHost = browserHost(),
): Promise<PasskeyCreateRequest> {
  let credential: Credential | null;
  try {
    credential = await host.credentials.create({
      publicKey: {
        rp: { id: options.rpId, name: PASSKEY_RP_NAME },
        user: {
          id: fromBase64url(options.userId),
          name: PASSKEY_USER_NAME,
          displayName: PASSKEY_USER_NAME,
        },
        challenge: fromBase64url(options.challenge),
        pubKeyCredParams: PASSKEY_ALGORITHMS.map((alg) => ({ type: 'public-key', alg })),
        excludeCredentials: options.excludeCredentials.map((c) => ({
          type: 'public-key',
          id: fromBase64url(c.id),
          transports: c.transports as AuthenticatorTransport[],
        })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        attestation: 'none',
        timeout: CEREMONY_TIMEOUT_MS,
      },
    });
  } catch (error) {
    throw ceremonyError(error, true);
  }
  const created = asPublicKey(credential);
  if (created === null) throw new SyncError('passkey_failed');
  const response = created.response as AuthenticatorAttestationResponse;
  const publicKey = response.getPublicKey?.();
  const algorithm = response.getPublicKeyAlgorithm?.();
  const authenticatorData = response.getAuthenticatorData?.();
  // Sin `getPublicKey()` (navegadores de antes de 2021) o con un algoritmo que el navegador no
  // sabe exportar, no se puede guardar sin leer CBOR.
  if (!publicKey || algorithm === undefined || !authenticatorData) {
    throw new SyncError('passkey_failed');
  }
  return {
    id: created.id,
    clientDataJSON: toBase64url(response.clientDataJSON),
    authenticatorData: toBase64url(authenticatorData),
    publicKey: toBase64url(publicKey),
    publicKeyAlgorithm: algorithm,
    transports: response.getTransports?.() ?? [],
  };
}

/** Pide al navegador una llave de este sitio (sin decir cuál: son detectables) y firma el reto. */
export async function getPasskeyAssertion(
  challenge: PasskeyChallengeResponse,
  label: string,
  host: WebAuthnHost = browserHost(),
): Promise<PasskeyRedeemRequest> {
  let credential: Credential | null;
  try {
    credential = await host.credentials.get({
      publicKey: {
        rpId: challenge.rpId,
        challenge: fromBase64url(challenge.challenge),
        userVerification: 'required',
        timeout: CEREMONY_TIMEOUT_MS,
      },
    });
  } catch (error) {
    throw ceremonyError(error, false);
  }
  const asserted = asPublicKey(credential);
  if (asserted === null) throw new SyncError('passkey_failed');
  const response = asserted.response as AuthenticatorAssertionResponse;
  return {
    id: asserted.id,
    clientDataJSON: toBase64url(response.clientDataJSON),
    authenticatorData: toBase64url(response.authenticatorData),
    signature: toBase64url(response.signature),
    userHandle: response.userHandle ? toBase64url(response.userHandle) : null,
    label,
  };
}

/** La API de señales (WebAuthn nivel 3), donde exista: Chrome, Edge y la app de escritorio. */
interface SignalApi {
  signalUnknownCredential?(options: { rpId: string; credentialId: string }): Promise<void>;
  signalAllAcceptedCredentials?(options: {
    rpId: string;
    userId: string;
    allAcceptedCredentialIds: string[];
  }): Promise<void>;
}

function signals(): SignalApi | null {
  return typeof PublicKeyCredential === 'undefined'
    ? null
    : (PublicKeyCredential as unknown as SignalApi);
}

/** Tras quitar una llave: que el llavero la olvide. Si no se puede, no pasa nada. */
export function forgetPasskey(rpId: string, credentialId: string): void {
  signals()
    ?.signalUnknownCredential?.({ rpId, credentialId })
    ?.catch(() => undefined);
}

/** Tras quitar una llave o borrar la agenda: las que siguen valiendo (ninguna, al borrarla). */
export function keepOnlyPasskeys(rpId: string, userId: string, ids: readonly string[]): void {
  signals()
    ?.signalAllAcceptedCredentials?.({ rpId, userId, allAcceptedCredentialIds: [...ids] })
    ?.catch(() => undefined);
}
