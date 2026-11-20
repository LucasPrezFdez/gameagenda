// Autenticador falso para las pruebas de las llaves de acceso (ADR-013): claves de verdad, de
// WebCrypto en Node (Ed25519, P-256 y RSA), y lo que mandaría el navegador al crear y al entrar,
// como el autenticador virtual de Chromium del paso 0. ES256 firma en DER, como los de verdad.

import type { PasskeyAlgorithm } from '@gameagenda/core/api';
import { ORIGIN } from './harness.ts';

export const RP_ID = new URL(ORIGIN).hostname;

const encoder = new TextEncoder();

export function b64u(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function fromB64u(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(text, 'base64url'));
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** `r‖s` (64 bytes) → DER, como firman los autenticadores de verdad. */
export function rawToDer(raw: Uint8Array): Uint8Array<ArrayBuffer> {
  const integer = (half: Uint8Array) => {
    let value = half;
    while (value.length > 1 && value[0] === 0 && ((value[1] ?? 0) & 0x80) === 0) {
      value = value.subarray(1);
    }
    if ((value[0] ?? 0) & 0x80) value = concat(new Uint8Array([0]), value);
    return concat(new Uint8Array([0x02, value.length]), value);
  };
  const body = concat(integer(raw.subarray(0, 32)), integer(raw.subarray(32)));
  return concat(new Uint8Array([0x30, body.length]), body);
}

const KEY_PARAMS = {
  [-8]: { generate: { name: 'Ed25519' }, sign: { name: 'Ed25519' } },
  [-7]: {
    generate: { name: 'ECDSA', namedCurve: 'P-256' },
    sign: { name: 'ECDSA', hash: 'SHA-256' },
  },
  [-257]: {
    generate: {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    sign: { name: 'RSASSA-PKCS1-v1_5' },
  },
} as const;

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

export interface CeremonyOverrides {
  type?: string;
  challenge?: string;
  origin?: string;
  rpId?: string;
  /** Las marcas de `authenticatorData` (por defecto, UP y UV; al crear, también AT). */
  flags?: number;
  /** El id que dice la app, si no es el de la llave. */
  id?: string;
}

/** Una llave detectable de un llavero, con su par de claves. */
export class FakeAuthenticator {
  readonly alg: PasskeyAlgorithm;
  readonly credentialId = crypto.getRandomValues(new Uint8Array(16));
  /** Las llaves sincronizadas mandan 0; uno físico, un contador que sube. */
  signCount: number;
  userHandle: string | null = null;
  private readonly keys: CryptoKeyPair;

  private constructor(alg: PasskeyAlgorithm, keys: CryptoKeyPair, signCount: number) {
    this.alg = alg;
    this.keys = keys;
    this.signCount = signCount;
  }

  static async create(alg: PasskeyAlgorithm = -7, signCount = 0): Promise<FakeAuthenticator> {
    const keys = (await crypto.subtle.generateKey(KEY_PARAMS[alg].generate, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    return new FakeAuthenticator(alg, keys, signCount);
  }

  get id(): string {
    return b64u(this.credentialId);
  }

  async publicKeySpki(): Promise<string> {
    return b64u(new Uint8Array(await crypto.subtle.exportKey('spki', this.keys.publicKey)));
  }

  private clientData(
    type: string,
    challenge: string,
    o: CeremonyOverrides,
  ): Uint8Array<ArrayBuffer> {
    return encoder.encode(
      JSON.stringify({
        type: o.type ?? type,
        challenge: o.challenge ?? challenge,
        origin: o.origin ?? ORIGIN,
        crossOrigin: false,
      }),
    );
  }

  private async authData(flags: number, rpId: string, attested: boolean) {
    const counter = new Uint8Array(4);
    new DataView(counter.buffer).setUint32(0, this.signCount);
    const head = concat(await sha256(encoder.encode(rpId)), new Uint8Array([flags]), counter);
    if (!attested) return head;
    const length = new Uint8Array([this.credentialId.length >> 8, this.credentialId.length & 0xff]);
    // AAGUID a ceros y, detrás, la clave en COSE: el servidor no la lee (le llega en SPKI).
    return concat(
      head,
      new Uint8Array(16),
      length,
      this.credentialId,
      new Uint8Array([0xa5, 0x01]),
    );
  }

  /** Lo que manda la app a `POST /api/v1/passkeys` tras `navigator.credentials.create()`. */
  async register(
    options: { challenge: string; rpId: string; userId: string },
    overrides: CeremonyOverrides = {},
  ) {
    this.userHandle = options.userId;
    const flags = overrides.flags ?? FLAG_UP | FLAG_UV | FLAG_AT;
    return {
      id: overrides.id ?? this.id,
      clientDataJSON: b64u(this.clientData('webauthn.create', options.challenge, overrides)),
      authenticatorData: b64u(await this.authData(flags, overrides.rpId ?? options.rpId, true)),
      publicKey: await this.publicKeySpki(),
      publicKeyAlgorithm: this.alg as number,
      transports: ['internal', 'hybrid'],
    };
  }

  /** Lo que manda la app a `POST /api/v1/passkeys/redeem` tras `navigator.credentials.get()`. */
  async assert(
    options: { challenge: string; rpId: string },
    label: string,
    overrides: CeremonyOverrides = {},
  ) {
    if (this.signCount > 0) this.signCount += 1;
    const clientData = this.clientData('webauthn.get', options.challenge, overrides);
    const authData = await this.authData(
      overrides.flags ?? FLAG_UP | FLAG_UV,
      overrides.rpId ?? options.rpId,
      false,
    );
    const signed = concat(authData, await sha256(clientData));
    let signature = new Uint8Array(
      await crypto.subtle.sign(KEY_PARAMS[this.alg].sign, this.keys.privateKey, signed),
    );
    if (this.alg === -7) signature = rawToDer(signature);
    return {
      id: overrides.id ?? this.id,
      clientDataJSON: b64u(clientData),
      authenticatorData: b64u(authData),
      signature: b64u(signature),
      userHandle: this.userHandle,
      label,
    };
  }
}

/** Cambia un byte de un campo en base64url (para probar firmas y datos tocados). */
export function tamper(field: string, index = 10): string {
  const bytes = fromB64u(field);
  bytes[index] = (bytes[index] ?? 0) ^ 0x01;
  return b64u(bytes);
}

function buffer(text: string): ArrayBuffer {
  return fromB64u(text).buffer;
}

/**
 * Un `navigator.credentials` falso para la app (`WebAuthnHost`): crea y firma con `key`, como el
 * llavero del navegador. Con `fail`, rechaza como lo haría el navegador (`NotAllowedError` si el
 * usuario cierra el diálogo; `InvalidStateError` si ese llavero ya tiene una llave de la agenda).
 */
export function webAuthnHost(key: FakeAuthenticator, fail?: { name: string }) {
  const reject = () => Promise.reject(new DOMException('falso', fail?.name));
  return {
    credentials: {
      async create(options?: CredentialCreationOptions): Promise<Credential | null> {
        if (fail) return reject();
        const publicKey = options?.publicKey;
        if (!publicKey) throw new TypeError('sin publicKey');
        const body = await key.register({
          challenge: b64u(new Uint8Array(publicKey.challenge as ArrayBuffer)),
          rpId: publicKey.rp.id ?? RP_ID,
          userId: b64u(new Uint8Array(publicKey.user.id as ArrayBuffer)),
        });
        return {
          type: 'public-key',
          id: body.id,
          response: {
            clientDataJSON: buffer(body.clientDataJSON),
            getAuthenticatorData: () => buffer(body.authenticatorData),
            getPublicKey: () => buffer(body.publicKey),
            getPublicKeyAlgorithm: () => body.publicKeyAlgorithm,
            getTransports: () => body.transports,
          },
        } as unknown as Credential;
      },
      async get(options?: CredentialRequestOptions): Promise<Credential | null> {
        if (fail) return reject();
        const publicKey = options?.publicKey;
        if (!publicKey) throw new TypeError('sin publicKey');
        const body = await key.assert(
          {
            challenge: b64u(new Uint8Array(publicKey.challenge as ArrayBuffer)),
            rpId: publicKey.rpId ?? RP_ID,
          },
          '',
        );
        return {
          type: 'public-key',
          id: body.id,
          response: {
            clientDataJSON: buffer(body.clientDataJSON),
            authenticatorData: buffer(body.authenticatorData),
            signature: buffer(body.signature),
            userHandle: body.userHandle === null ? null : buffer(body.userHandle),
          },
        } as unknown as Credential;
      },
    },
  };
}
