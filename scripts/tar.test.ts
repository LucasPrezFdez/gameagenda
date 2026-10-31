import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isSafeEntryPath,
  packTgz,
  readDirEntries,
  type TarEntry,
  unpackTgz,
  writeEntries,
} from './tar.ts';
import { cleanup, tempDir } from './test-helpers.ts';

const dirs: string[] = [];
afterEach(() => cleanup(dirs));

const text = (s: string): Uint8Array => new TextEncoder().encode(s);
const asText = (e: TarEntry): [string, string] => [e.path, Buffer.from(e.data).toString('utf8')];

describe('tar: el .tgz del estado y de catalog:stage', () => {
  it('ida y vuelta, también con rutas de más de 100 bytes, vacíos y binarios', () => {
    const long = `raw/${'a'.repeat(90)}/${'b'.repeat(60)}.json.gz`;
    const binary = new Uint8Array(1500).map((_, i) => (i * 37) % 256);
    const entries: TarEntry[] = [
      { path: 'master.ndjson.gz', data: text('{"appid":730}\n') },
      { path: 'vacio.txt', data: new Uint8Array(0) },
      { path: long, data: binary },
    ];
    const back = unpackTgz(packTgz(entries));
    expect(back.map((e) => e.path)).toEqual(entries.map((e) => e.path));
    expect(Buffer.from((back[2] as TarEntry).data).equals(Buffer.from(binary))).toBe(true);
    expect(asText(back[0] as TarEntry)).toEqual(['master.ndjson.gz', '{"appid":730}\n']);
  });

  it('el mismo contenido da los mismos bytes (sin fechas ni dueños)', () => {
    const entries = [{ path: 'a/b.txt', data: text('hola') }];
    expect(packTgz(entries).equals(packTgz(entries))).toBe(true);
  });

  it('rechaza rutas que se salen de la carpeta', () => {
    for (const bad of ['../x', '/abs', 'a/../b', 'a\\b', 'C:/x', 'a//b', './a', '']) {
      expect(isSafeEntryPath(bad), bad).toBe(false);
      expect(() => packTgz([{ path: bad, data: text('x') }])).toThrow();
    }
    expect(isSafeEntryPath('raw-2026-10-31/query-000950.json.gz')).toBe(true);
  });

  it('detecta una cabecera corrupta', () => {
    const tar = gunzipSync(packTgz([{ path: 'a.txt', data: text('hola') }]));
    tar[0] = 'b'.charCodeAt(0);
    expect(() => unpackTgz(gzipSync(tar))).toThrow(/suma de control/);
  });

  it('lee una carpeta con filtro y la vuelve a escribir', () => {
    const src = tempDir('tar-src-', dirs);
    mkdirSync(join(src, 'raw-2026-10-31'));
    mkdirSync(join(src, 'sub'));
    writeFileSync(join(src, 'master.ndjson.gz'), 'm');
    writeFileSync(join(src, 'raw-2026-10-31', 'query.json.gz'), 'q');
    writeFileSync(join(src, 'sub', 'x.json'), 'x');
    const entries = readDirEntries(src, (p) => !p.startsWith('raw-'));
    expect(entries.map((e) => e.path)).toEqual(['master.ndjson.gz', 'sub/x.json']);
    const dst = tempDir('tar-dst-', dirs);
    writeEntries(dst, unpackTgz(packTgz(entries)));
    expect(readFileSync(join(dst, 'sub', 'x.json'), 'utf8')).toBe('x');
  });
});
