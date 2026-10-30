// Búsqueda de la clave de Steam en un *build* (§12.5 y §11 de prototipe.md; CA0.4): falla si algún
// fichero de la carpeta contiene `x-webapi-key`, `STEAM_WEB_API_KEY` o una palabra de 32
// caracteres alfanuméricos cuyo SHA-256 coincida con `STEAM_KEY_SHA256`. Esa variable del CI es el
// *hash* de la clave, nunca la clave: así `ci.yml` no necesita el secreto. Sin ella solo se buscan
// los dos nombres.
//
// Uso: node scripts/scan-secrets.ts [carpeta]  (por defecto, apps/web/dist).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Nombres que nunca deben llegar al cliente (se buscan sin distinguir mayúsculas). */
const FORBIDDEN = ['x-webapi-key', 'STEAM_WEB_API_KEY'] as const;
/**
 * Candidatas a clave: 32 caracteres alfanuméricos sin otro alfanumérico al lado. No vale `\b`,
 * que trata `_` como letra y no vería `KEY_<clave>`. La clave son 32 dígitos hexadecimales que
 * Steam muestra en mayúsculas (ver `docs/medidas/verificaciones-m0-20261030.md`).
 */
const RE_WORD = /(?<![0-9A-Za-z])[0-9A-Za-z]{32}(?![0-9A-Za-z])/g;
const RE_SHA256 = /^[0-9a-f]{64}$/;

export interface Finding {
  readonly file: string;
  readonly what: string;
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** Lo prohibido que contiene `text`: los nombres y, con `keySha256`, la clave. */
export function scanText(text: string, keySha256: string | null): string[] {
  const found: string[] = [];
  const lower = text.toLowerCase();
  for (const name of FORBIDDEN) if (lower.includes(name.toLowerCase())) found.push(name);
  if (keySha256 !== null) {
    for (const match of text.matchAll(RE_WORD)) {
      // También en minúsculas: el *hash* es el de la clave tal como la da Steam, en mayúsculas.
      if (sha256(match[0]) === keySha256 || sha256(match[0].toUpperCase()) === keySha256) {
        found.push('la clave de Steam (coincide con STEAM_KEY_SHA256)');
        break;
      }
    }
  }
  return found;
}

/** Recorre `dir` entero. Los ficheros se leen como `latin1`: la clave y los nombres son ASCII. */
export function scanDir(dir: string, keySha256: string | null): Finding[] {
  const findings: Finding[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else {
        for (const what of scanText(readFileSync(path, 'latin1'), keySha256)) {
          findings.push({ file: relative(dir, path), what });
        }
      }
    }
  };
  walk(dir);
  return findings;
}

/** `STEAM_KEY_SHA256` validada: 64 dígitos hexadecimales, o `null` si no está. */
export function keyHashFromEnv(value: string | undefined): string | null {
  const hash = value?.trim().toLowerCase();
  if (!hash) return null;
  if (!RE_SHA256.test(hash)) throw new Error('STEAM_KEY_SHA256 no es un SHA-256 en hexadecimal');
  return hash;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const dir = process.argv[2] ?? join(root, 'apps/web/dist');
  const keySha256 = keyHashFromEnv(process.env.STEAM_KEY_SHA256);
  const findings = scanDir(dir, keySha256);
  const scope = keySha256 ? 'nombres y clave' : 'solo los nombres, falta STEAM_KEY_SHA256';
  if (findings.length > 0) {
    for (const f of findings) console.error(`✗ ${f.file}: ${f.what}`);
    console.error(`La carpeta ${dir} contiene secretos de Steam: no se puede publicar.`);
    process.exit(1);
  }
  console.log(`✓ Sin secretos de Steam en ${dir} (${scope}).`);
}
