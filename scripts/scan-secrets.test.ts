import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { keyHashFromEnv, scanDir, scanText } from './scan-secrets.ts';

// Una clave falsa con la forma de las de la Web API (CA0.4): nunca la real.
const FAKE_KEY = '0123456789ABCDEF0123456789ABCDEF';
const FAKE_HASH = createHash('sha256').update(FAKE_KEY).digest('hex');

const dirs: string[] = [];
function build(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'scan-secrets-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
  }
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('búsqueda de la clave de Steam en el build (CA0.4)', () => {
  it('encuentra la cabecera y el nombre de la variable, sin distinguir mayúsculas', () => {
    expect(scanText('headers: { "X-WebAPI-Key": k }', null)).toEqual(['x-webapi-key']);
    expect(scanText('process.env.steam_web_api_key', null)).toEqual(['STEAM_WEB_API_KEY']);
  });

  it('encuentra la clave por su SHA-256, y no otras palabras de 32 caracteres', () => {
    expect(scanText(`const k = "${FAKE_KEY}";`, FAKE_HASH)).toHaveLength(1);
    expect(scanText('const h = "ABCDEF0123456789ABCDEF0123456789";', FAKE_HASH)).toEqual([]);
    // Sin el *hash* no se puede saber cuál es la clave: solo se buscan los nombres.
    expect(scanText(`const k = "${FAKE_KEY}";`, null)).toEqual([]);
  });

  it('recorre la carpeta entera y dice en qué fichero está', () => {
    const dir = build({
      'index.html': '<!doctype html>',
      'assets/index-abc.js': `fetch(u, { headers: { "x-webapi-key": "${FAKE_KEY}" } })`,
    });
    expect(scanDir(dir, FAKE_HASH)).toEqual([
      { file: join('assets', 'index-abc.js'), what: 'x-webapi-key' },
      {
        file: join('assets', 'index-abc.js'),
        what: 'la clave de Steam (coincide con STEAM_KEY_SHA256)',
      },
    ]);
    expect(scanDir(build({ 'index.html': '<p>GameAgenda</p>' }), FAKE_HASH)).toEqual([]);
  });

  it('STEAM_KEY_SHA256 tiene que ser un SHA-256 en hexadecimal', () => {
    expect(keyHashFromEnv(undefined)).toBeNull();
    expect(keyHashFromEnv('  ')).toBeNull();
    expect(keyHashFromEnv(FAKE_HASH.toUpperCase())).toBe(FAKE_HASH);
    expect(() => keyHashFromEnv(FAKE_KEY)).toThrow('no es un SHA-256');
  });
});
