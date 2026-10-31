// `.tgz` mínimo (ustar + gzip) para llevar el estado del pipeline y lo que sube `catalog:stage` a
// las *Releases* de GitHub (§4.5 y §12.5 de prototipe.md). Solo ficheros normales, sin permisos,
// dueños ni fechas (mtime 0): el mismo contenido da los mismos bytes. Se abre con cualquier `tar`
// (`tar -tzf estado.tgz`). No se llama al `tar` del sistema porque, en Windows, el de Git Bash
// toma `C:` por un servidor remoto.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

export interface TarEntry {
  /** Ruta relativa con `/`, sin `..` ni barra inicial. */
  readonly path: string;
  readonly data: Uint8Array;
}

const BLOCK = 512;
const RE_SAFE_PATH =
  /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9._@+=,-]+(?:\/[A-Za-z0-9._@+=,-]+)*$/;

/** `true` si `path` se puede escribir dentro de una carpeta sin salirse de ella. */
export function isSafeEntryPath(path: string): boolean {
  return RE_SAFE_PATH.test(path);
}

function writeString(header: Uint8Array, offset: number, length: number, value: string): void {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > length) throw new Error(`«${value}» no cabe en la cabecera tar`);
  header.set(bytes, offset);
}

function writeOctal(header: Uint8Array, offset: number, length: number, value: number): void {
  writeString(header, offset, length, `${value.toString(8).padStart(length - 1, '0')}\0`);
}

/** Separa la ruta en `prefix` (≤155) y `name` (≤100) por una `/`, como pide ustar. */
function splitPath(path: string): [prefix: string, name: string] {
  if (Buffer.byteLength(path) <= 100) return ['', path];
  for (let i = path.lastIndexOf('/'); i > 0; i = path.lastIndexOf('/', i - 1)) {
    const prefix = path.slice(0, i);
    const name = path.slice(i + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return [prefix, name];
  }
  throw new Error(`Ruta demasiado larga para ustar: ${path}`);
}

function header(path: string, size: number): Uint8Array {
  const h = new Uint8Array(BLOCK);
  const [prefix, name] = splitPath(path);
  writeString(h, 0, 100, name);
  writeOctal(h, 100, 8, 0o644);
  writeOctal(h, 108, 8, 0);
  writeOctal(h, 116, 8, 0);
  writeOctal(h, 124, 12, size);
  writeOctal(h, 136, 12, 0);
  h.fill(0x20, 148, 156);
  h[156] = 0x30; // '0': fichero normal
  writeString(h, 257, 6, 'ustar\0');
  writeString(h, 263, 2, '00');
  writeString(h, 345, 155, prefix);
  const sum = h.reduce((a, b) => a + b, 0);
  writeString(h, 148, 8, `${sum.toString(8).padStart(6, '0')}\0 `);
  return h;
}

/** Empaqueta `entries` en un `.tgz`, en el orden dado. */
export function packTgz(entries: readonly TarEntry[]): Buffer {
  const parts: Uint8Array[] = [];
  const seen = new Set<string>();
  for (const { path, data } of entries) {
    if (!isSafeEntryPath(path)) throw new Error(`Ruta no válida en el paquete: ${path}`);
    if (seen.has(path)) throw new Error(`Ruta repetida en el paquete: ${path}`);
    seen.add(path);
    parts.push(header(path, data.length), data);
    const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
    if (pad > 0) parts.push(new Uint8Array(pad));
  }
  parts.push(new Uint8Array(BLOCK * 2));
  return gzipSync(Buffer.concat(parts), { level: 9 });
}

function readString(block: Uint8Array, offset: number, length: number): string {
  const slice = block.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return new TextDecoder().decode(end < 0 ? slice : slice.subarray(0, end));
}

function readOctal(block: Uint8Array, offset: number, length: number): number {
  const text = readString(block, offset, length).trim();
  if (!/^[0-7]*$/.test(text)) throw new Error('Cabecera tar no válida (número)');
  return text === '' ? 0 : Number.parseInt(text, 8);
}

/** Desempaqueta un `.tgz`: solo ficheros normales; salta carpetas y cabeceras pax. */
export function unpackTgz(tgz: Uint8Array): TarEntry[] {
  const tar = gunzipSync(tgz);
  const out: TarEntry[] = [];
  for (let at = 0; at + BLOCK <= tar.length; ) {
    const block = tar.subarray(at, at + BLOCK);
    if (block.every((b) => b === 0)) break;
    const stored = readOctal(block, 148, 8);
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : (block[i] as number);
    if (sum !== stored) throw new Error('Cabecera tar no válida (suma de control)');
    const size = readOctal(block, 124, 12);
    const type = String.fromCharCode(block[156] as number);
    const prefix = readString(block, 345, 155);
    const name = readString(block, 0, 100);
    const path = prefix ? `${prefix}/${name}` : name;
    const start = at + BLOCK;
    at = start + Math.ceil(size / BLOCK) * BLOCK;
    if (type === '5' || type === 'x' || type === 'g') continue;
    if (type !== '0' && type !== '\0') throw new Error(`Tipo de entrada tar no admitido: ${type}`);
    if (!isSafeEntryPath(path)) throw new Error(`Ruta no válida en el paquete: ${path}`);
    if (start + size > tar.length) throw new Error(`Paquete truncado en ${path}`);
    out.push({ path, data: tar.subarray(start, start + size) });
  }
  return out;
}

/** Ficheros de `dir` (recursivo, en orden) cuya ruta relativa acepta `keep`. */
export function readDirEntries(
  dir: string,
  keep: (path: string) => boolean = () => true,
): TarEntry[] {
  const out: TarEntry[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      const rel = relative(dir, full).split(sep).join('/');
      if (statSync(full).isDirectory()) {
        if (keep(`${rel}/`)) walk(full);
      } else if (keep(rel)) {
        out.push({ path: rel, data: readFileSync(full) });
      }
    }
  };
  walk(dir);
  return out;
}

/** Escribe `entries` dentro de `dir` (crea las carpetas; sobrescribe lo que haya). */
export function writeEntries(dir: string, entries: readonly TarEntry[]): void {
  for (const { path, data } of entries) {
    if (!isSafeEntryPath(path)) throw new Error(`Ruta no válida en el paquete: ${path}`);
    const full = join(dir, ...path.split('/'));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, data);
  }
}
