// Ficheros del catálogo en el Worker (ver §5.3 y §7.6): `manifest.json` con `cache: 'no-cache'`,
// validado con su esquema; cada fichero, comprobado con su `sha256` (WebCrypto) y guardado en
// Cache Storage (`gacat-<versión>`, que sustituye a las anteriores). Sin red, el último
// *manifest* válido de la caché con sus ficheros.
//
// En M1 no se escribe `meta.catalog` en IndexedDB: la versión vigente es la del *manifest*
// guardado en la caché y el *manifest* se comprueba en cada arranque (no cada 12 h).
import { type CatalogManifest, catalogManifestSchema } from '@gameagenda/core/catalog-format';

/** Errores de carga: el código va en `status.error` (ver §8.7). */
export type CatalogErrorCode =
  | 'network'
  | 'http'
  | 'manifest'
  | 'integrity'
  | 'format'
  | 'client-too-old';

export class CatalogLoadError extends Error {
  readonly code: CatalogErrorCode;
  readonly retryable: boolean;

  constructor(code: CatalogErrorCode, message: string, retryable = code !== 'client-too-old') {
    super(message);
    this.name = 'CatalogLoadError';
    this.code = code;
    this.retryable = retryable;
  }
}

/** El catálogo listo para indexar: el *manifest* y el texto de sus ficheros. */
export interface CatalogTexts {
  readonly manifest: CatalogManifest;
  readonly core: string;
  readonly aliases: string;
}

export interface CatalogStoreDeps {
  readonly fetch: typeof fetch;
  /** `null` donde no hay Cache Storage: se descarga en cada arranque. */
  readonly caches: CacheStorage | null;
  readonly subtle: SubtleCrypto;
  /** URL absoluta de la carpeta del catálogo, terminada en `/`. */
  readonly baseUrl: string;
  /** Versión de la app, que se compara con `minClientVersion`. */
  readonly appVersion: string;
}

export interface CatalogStore {
  /** El catálogo más reciente de la caché con todos sus ficheros válidos, o `null`. */
  readCached(): Promise<CatalogTexts | null>;
  /** `manifest.json` de la red, revalidado (`no-cache`). */
  fetchManifest(): Promise<CatalogManifest>;
  /**
   * Los ficheros del *manifest*: de la caché si ya están y son válidos; si no, de la red, con su
   * avance en bytes. Al terminar guarda el *manifest* y borra las versiones anteriores.
   */
  download(
    manifest: CatalogManifest,
    onProgress?: (fraction: number) => void,
  ): Promise<CatalogTexts>;
}

const CACHE_PREFIX = 'gacat-';
const RE_CACHE_NAME = /^gacat-(\d{8})\.([1-9]\d*)$/;
const RE_SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/** Ordena versiones `AAAAMMDD.N`: negativo si `a` es anterior a `b`. */
export function compareCatalogVersions(a: string, b: string): number {
  const [da = 0, na = 0] = a.split('.').map(Number);
  const [db = 0, nb = 0] = b.split('.').map(Number);
  return da - db || na - nb;
}

function semverParts(v: string): number[] {
  const m = RE_SEMVER.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}

/** `true` si la app (`app`) es al menos `min`. */
export function satisfiesMinVersion(app: string, min: string): boolean {
  const a = semverParts(app);
  const b = semverParts(min);
  for (let i = 0; i < 3; i++) {
    const d = (a[i] as number) - (b[i] as number);
    if (d !== 0) return d > 0;
  }
  return true;
}

function toHex(buffer: ArrayBuffer): string {
  let out = '';
  for (const byte of new Uint8Array(buffer)) out += byte.toString(16).padStart(2, '0');
  return out;
}

const decoder = new TextDecoder('utf-8');

interface FileSpec {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

export function createCatalogStore(deps: CatalogStoreDeps): CatalogStore {
  const manifestUrl = new URL('manifest.json', deps.baseUrl).href;
  const fileUrl = (path: string): string => new URL(path, deps.baseUrl).href;

  async function isValid(bytes: Uint8Array<ArrayBuffer>, spec: FileSpec): Promise<boolean> {
    if (bytes.byteLength !== spec.bytes) return false;
    return toHex(await deps.subtle.digest('SHA-256', bytes)) === spec.sha256;
  }

  function parseManifest(json: unknown): CatalogManifest | null {
    const parsed = catalogManifestSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  }

  /** El fichero de una caché (o de cualquiera, sin `cache`) si existe y es válido. */
  async function cachedFile(
    spec: FileSpec,
    cache: Cache | CacheStorage,
  ): Promise<Uint8Array<ArrayBuffer> | null> {
    const response = await cache.match(fileUrl(spec.path));
    if (!response) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return (await isValid(bytes, spec)) ? bytes : null;
  }

  async function cacheNames(): Promise<string[]> {
    if (!deps.caches) return [];
    const names = (await deps.caches.keys()).filter((name) => RE_CACHE_NAME.test(name));
    return names.sort((a, b) =>
      compareCatalogVersions(b.slice(CACHE_PREFIX.length), a.slice(CACHE_PREFIX.length)),
    );
  }

  async function fetchFile(
    spec: FileSpec,
    onBytes: (received: number) => void,
  ): Promise<Uint8Array<ArrayBuffer>> {
    let response: Response;
    try {
      // Ficheros inmutables (el *hash* va en el nombre): la caché HTTP vale tal cual.
      response = await deps.fetch(fileUrl(spec.path));
    } catch {
      throw new CatalogLoadError('network', `Sin red al descargar ${spec.path}`);
    }
    if (!response.ok) throw new CatalogLoadError('http', `${spec.path}: HTTP ${response.status}`);
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = await readBody(response, spec.bytes, onBytes);
    } catch {
      throw new CatalogLoadError('network', `Descarga cortada: ${spec.path}`);
    }
    if (!(await isValid(bytes, spec))) {
      throw new CatalogLoadError('integrity', `${spec.path} no coincide con su sha256`);
    }
    return bytes;
  }

  return {
    async readCached() {
      if (!deps.caches) return null;
      for (const name of await cacheNames()) {
        const cache = await deps.caches.open(name);
        const response = await cache.match(manifestUrl);
        if (!response) continue;
        const manifest = parseManifest(await response.json().catch(() => null));
        if (!manifest || `${CACHE_PREFIX}${manifest.version}` !== name) continue;
        const core = await cachedFile(manifest.files.core, cache);
        const aliases = core && (await cachedFile(manifest.files.aliases, cache));
        if (!core || !aliases) continue;
        return { manifest, core: decoder.decode(core), aliases: decoder.decode(aliases) };
      }
      return null;
    },

    async fetchManifest() {
      let response: Response;
      try {
        response = await deps.fetch(manifestUrl, { cache: 'no-cache' });
      } catch {
        throw new CatalogLoadError('network', 'Sin red al pedir el manifest');
      }
      if (!response.ok) throw new CatalogLoadError('http', `manifest: HTTP ${response.status}`);
      const manifest = parseManifest(await response.json().catch(() => null));
      if (!manifest) throw new CatalogLoadError('manifest', 'El manifest no es válido');
      if (!satisfiesMinVersion(deps.appVersion, manifest.minClientVersion)) {
        throw new CatalogLoadError(
          'client-too-old',
          `El catálogo pide la versión ${manifest.minClientVersion} de la app`,
        );
      }
      return manifest;
    },

    async download(manifest, onProgress) {
      const specs = [manifest.files.core, manifest.files.aliases];
      const total = specs.reduce((sum, spec) => sum + spec.bytes, 0) || 1;
      let received = 0;
      const progress = (bytes: number) => {
        received += bytes;
        onProgress?.(Math.min(1, received / total));
      };
      const name = `${CACHE_PREFIX}${manifest.version}`;
      const cache = deps.caches ? await deps.caches.open(name) : null;
      const texts: string[] = [];
      for (const spec of specs) {
        // Ya descargado (una descarga cortada o el mismo fichero en la versión anterior).
        let bytes = deps.caches ? await cachedFile(spec, deps.caches) : null;
        if (bytes) progress(bytes.byteLength);
        else bytes = await fetchFile(spec, progress);
        await cache?.put(
          fileUrl(spec.path),
          new Response(bytes, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }),
        );
        texts.push(decoder.decode(bytes));
      }
      if (cache && deps.caches) {
        // El *manifest* se guarda el último: marca la versión como completa.
        await cache.put(
          manifestUrl,
          new Response(JSON.stringify(manifest), {
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
          }),
        );
        for (const other of await deps.caches.keys()) {
          if (other.startsWith(CACHE_PREFIX) && other !== name) await deps.caches.delete(other);
        }
      }
      return { manifest, core: texts[0] as string, aliases: texts[1] as string };
    },
  };
}

/** Lee el cuerpo entero informando de cada trozo (el avance de la descarga). */
async function readBody(
  response: Response,
  expected: number,
  onBytes: (received: number) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onBytes(bytes.byteLength);
    return bytes;
  }
  const reader = response.body.getReader();
  let buffer = new Uint8Array(Math.max(expected, 1024));
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > buffer.byteLength) {
      const grown = new Uint8Array(Math.max(buffer.byteLength * 2, size + value.byteLength));
      grown.set(buffer.subarray(0, size));
      buffer = grown;
    }
    buffer.set(value, size);
    size += value.byteLength;
    onBytes(value.byteLength);
  }
  return size === buffer.byteLength ? buffer : buffer.slice(0, size);
}
