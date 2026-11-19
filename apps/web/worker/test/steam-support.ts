// Apoyo de las pruebas de la importación de Steam (ADR-012): el verificador y el `challenge` como
// los hace la app.

import { sha256Base64url } from '../crypto.ts';

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

/** Un verificador aleatorio de 256 bits y su `challenge` (`S256`), como los genera la app. */
export async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  return { verifier, challenge: await sha256Base64url(verifier) };
}
