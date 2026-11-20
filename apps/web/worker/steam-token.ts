// El pase de la importación de Steam (Fase 2, parte 3; §10.4 de prototipe.md; ADR-012): lo da
// `redeem` junto a la biblioteca y lo presenta la app en cada lote de `achievements`. Así los logros
// no necesitan otro login ni que D1 guarde el SteamID64 más tiempo.
//
// - Es el SteamID64 y su caducidad (15 min), cifrados y autenticados con AES-GCM: la app no puede
//   leerlo ni cambiarlo, y uno cambiado o de otra clave no se abre.
// - La clave sale de `STEAM_WEB_API_KEY` con HKDF (SHA-256, con su propio `info`): no hace falta
//   otro secreto, y cambiar la clave de Steam invalida los pases que haya.
// - La app lo guarda solo en memoria. No se registra en ningún sitio.

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const IV_BYTES = 12;
const SALT = encoder.encode('gameagenda');
const INFO = encoder.encode('steam-import-token/v1');
/** `<SteamID64 de 17 cifras>.<caducidad en ms>`. */
const PAYLOAD = /^(\d{17})\.(\d{13})$/;

/** La clave de AES-GCM (el tipo `CryptoKey` no está en las bibliotecas del Worker). */
type TokenKey = ReturnType<typeof crypto.subtle.deriveKey>;

/** Una clave derivada por clave de Steam y por *isolate*: derivarla cuesta. */
let cached: { source: string; key: TokenKey } | null = null;

function tokenKey(steamKey: string): TokenKey {
  if (cached?.source !== steamKey) {
    const key = (async () => {
      const base = await crypto.subtle.importKey('raw', encoder.encode(steamKey), 'HKDF', false, [
        'deriveKey',
      ]);
      return crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: SALT, info: INFO },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    })();
    cached = { source: steamKey, key };
  }
  return cached.key;
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** El pase de `steamId`, que caduca en `expiresAt` (ms). */
export async function sealImportToken(
  steamKey: string,
  steamId: string,
  expiresAt: number,
): Promise<string> {
  const payload = `${steamId}.${Math.trunc(expiresAt)}`;
  if (!PAYLOAD.test(payload)) throw new RangeError('pase de importación: datos no válidos');
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      await tokenKey(steamKey),
      encoder.encode(payload),
    ),
  );
  const out = new Uint8Array(IV_BYTES + sealed.byteLength);
  out.set(iv);
  out.set(sealed, IV_BYTES);
  return base64url(out);
}

/**
 * El SteamID64 de un pase vigente; `null` si no se abre con esta clave (cambiado, inventado o de
 * otra clave) o si ha caducado.
 */
export async function openImportToken(
  steamKey: string,
  token: string,
  nowMs: number,
): Promise<string | null> {
  const bytes = fromBase64url(token);
  if (bytes === null || bytes.byteLength <= IV_BYTES + 16) return null;
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, IV_BYTES) },
      await tokenKey(steamKey),
      bytes.slice(IV_BYTES),
    );
  } catch {
    return null;
  }
  const match = PAYLOAD.exec(decoder.decode(plain));
  if (match === null) return null;
  return Number(match[2]) > nowMs ? (match[1] as string) : null;
}
