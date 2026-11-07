// Certificado autofirmado para el espejo HTTPS de la vista previa de los E2E (`e2e-api-plugin.ts`),
// hecho con `node:crypto` al arrancar, sin `openssl` ni dependencias: una clave P-256 y un X.509 v3
// de dos días para `127.0.0.1` y `localhost`, firmado con ECDSA-SHA256. Playwright no lo valida
// (`ignoreHTTPSErrors`): lo que importa es que la página sea HTTPS, porque el WebKit de Playwright
// guarda las *cookies* `Secure` por HTTP pero no las envía ni las deja leer (§12.3).
import {
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  X509Certificate,
} from 'node:crypto';

const DAY_MS = 86_400_000;

/** Longitud DER: corta (<128) en un byte; larga, con el número de bytes delante. */
function derLength(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  for (let n = length; n > 0; n >>= 8) bytes.unshift(n & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number, ...content: Buffer[]): Buffer {
  const body = Buffer.concat(content);
  return Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
}

const sequence = (...items: Buffer[]) => tlv(0x30, ...items);
const set = (...items: Buffer[]) => tlv(0x31, ...items);
const octetString = (content: Buffer) => tlv(0x04, content);
const utf8 = (text: string) => tlv(0x0c, Buffer.from(text, 'utf8'));
/** `[n] EXPLICIT`. */
const explicit = (n: number, content: Buffer) => tlv(0xa0 | n, content);

function oid(dotted: string): Buffer {
  const [first = 0, second = 0, ...rest] = dotted.split('.').map(Number);
  const bytes = [40 * first + second];
  for (const arc of rest) {
    const chunk = [arc & 0x7f];
    for (let n = arc >> 7; n > 0; n >>= 7) chunk.unshift(0x80 | (n & 0x7f));
    bytes.push(...chunk);
  }
  return tlv(0x06, Buffer.from(bytes));
}

function positiveInteger(bytes: Buffer): Buffer {
  const first = bytes[0] ?? 0;
  return tlv(0x02, first & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes);
}

/** `UTCTime` (`AAMMDDhhmmssZ`): vale hasta 2049, de sobra para un certificado de dos días. */
function utcTime(ms: number): Buffer {
  const iso = new Date(ms).toISOString();
  const text = `${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
  return tlv(0x17, Buffer.from(text, 'ascii'));
}

const ECDSA_SHA256 = sequence(oid('1.2.840.10045.4.3.2'));

export interface SelfSignedCertificate {
  readonly key: string;
  readonly cert: string;
}

/** Clave y certificado en PEM para `https.createServer()`, nuevos en cada llamada. */
export function selfSignedCertificate(now = Date.now()): SelfSignedCertificate {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const name = sequence(set(sequence(oid('2.5.4.3'), utf8('GameAgenda E2E'))));
  // subjectAltName: `iPAddress` (`[7]`) 127.0.0.1 y `dNSName` (`[2]`) localhost.
  const altNames = sequence(
    tlv(0x87, Buffer.from([127, 0, 0, 1])),
    tlv(0x82, Buffer.from('localhost', 'ascii')),
  );
  const extensions = explicit(
    3,
    sequence(
      sequence(oid('2.5.29.17'), octetString(altNames)),
      // basicConstraints: no es una CA.
      sequence(oid('2.5.29.19'), octetString(sequence())),
    ),
  );
  const tbs = sequence(
    explicit(0, tlv(0x02, Buffer.from([2]))),
    positiveInteger(randomBytes(16)),
    ECDSA_SHA256,
    name,
    sequence(utcTime(now - DAY_MS), utcTime(now + DAY_MS)),
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
    extensions,
  );
  const signature = sign('sha256', tbs, privateKey);
  const der = sequence(tbs, ECDSA_SHA256, tlv(0x03, Buffer.from([0]), signature));
  const lines = der.toString('base64').match(/.{1,64}/g) ?? [];
  const cert = `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
  const key = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  // Si el DER estuviera mal, mejor fallar aquí que con un error de TLS en el navegador.
  if (!new X509Certificate(cert).checkPrivateKey(createPrivateKey(key))) {
    throw new Error('El certificado de los E2E no corresponde a su clave');
  }
  return { key, cert };
}
