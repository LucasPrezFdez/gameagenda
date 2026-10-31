// Ficheros del catálogo en el Worker (ver §5.3, §5.4, §7.6 y §11.3):
// - `manifest.json` con `cache: 'no-cache'`, validado con su esquema y con su firma ed25519
//   (WebCrypto `Ed25519`) contra las claves en las que confía el *build* (`trustedSigningKeys`):
//   sin firma, con una clave desconocida o con una firma que no cuadra, se descarta;
// - cada fichero, comprobado con su `sha256` y guardado en Cache Storage (`gacat-<versión>`, que
//   sustituye a las anteriores); un fichero con el mismo *hash* que ya está en la caché no se
//   vuelve a bajar;
// - regla de los 7 días (CA2.4): con un núcleo local de ≤7 días, una versión nueva no lo vuelve a
//   bajar: bastan `recent` y, si han cambiado, los alias y el índice de *shards*. El núcleo que
//   se usa se apunta en la caché (`gacat-local.json`), porque ya no es el del *manifest*;
// - sin red, el último catálogo válido de la caché.
//
// La caché es de confianza: solo se escribe tras verificar la firma y los `sha256`, así que al
// arrancar no se vuelve a verificar la firma (tampoco hace falta Ed25519 para usarla: RNF-12).
//
// Aún no se escribe `meta.catalog` en IndexedDB: la versión vigente es la del *manifest*
// guardado en la caché y el *manifest* se comprueba en cada arranque (no cada 12 h).
import {
  type CatalogManifest,
  type CatalogSigningKey,
  catalogFileSchema,
  catalogManifestSchema,
  fromBase64Url,
  isCatalogVersion,
  manifestSigningBytes,
  trustedSigningKeys,
} from '@gameagenda/core/catalog-format';

/** Errores de carga: el código va en `status.error` (ver §8.7). */
export type CatalogErrorCode =
  | 'network'
  | 'http'
  | 'manifest'
  /** *Manifest* sin firma, con una clave desconocida o con una firma que no es válida (§11.3). */
  | 'signature'
  | 'integrity'
  | 'format'
  /** El catálogo pide una versión más nueva de la app (`minClientVersion`). */
  | 'client-too-old'
  /** El navegador no tiene Ed25519 en WebCrypto: hay que actualizarlo (RNF-12). */
  | 'browser-too-old';

/** Errores que no se arreglan reintentando: hace falta otra app u otro navegador. */
const NOT_RETRYABLE: ReadonlySet<CatalogErrorCode> = new Set(['client-too-old', 'browser-too-old']);

export class CatalogLoadError extends Error {
  readonly code: CatalogErrorCode;
  readonly retryable: boolean;
  /** Fichero con *hash* que ha fallado, o `null` si es el *manifest* (o no es una descarga). */
  readonly path: string | null;

  constructor(code: CatalogErrorCode, message: string, path: string | null = null) {
    super(message);
    this.name = 'CatalogLoadError';
    this.code = code;
    this.retryable = !NOT_RETRYABLE.has(code);
    this.path = path;
  }
}

/** Un fichero publicado: ruta con el *hash*, SHA-256 y bytes (como `files.*` del *manifest*). */
export interface FileSpec {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

/** El núcleo en uso y la versión del catálogo que lo trajo (la regla de los 7 días la mira). */
export interface CoreFile extends FileSpec {
  readonly version: string;
}

/** El catálogo listo para indexar: el *manifest* y el texto de sus ficheros. */
export interface CatalogTexts {
  readonly manifest: CatalogManifest;
  /** El del *manifest* o, por la regla de los 7 días, uno anterior que sigue valiendo. */
  readonly coreFile: CoreFile;
  readonly core: string;
  /** `recent` del *manifest*, o `null` si no lo trae (el de M1). */
  readonly recent: string | null;
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
  /** Claves públicas en las que se confía: en producción, solo las `prod` (`signingKeysForMode`). */
  readonly signingKeys: readonly CatalogSigningKey[];
  /**
   * Solo los E2E (ganchos del modo `e2e`): en un navegador sin Ed25519 (el WebKit de Playwright
   * en Windows), acepta sin verificarla la firma de una clave `dev` de `signingKeys`. El *build*
   * de producción no lo pasa, y tampoco confía en ninguna clave `dev`.
   */
  readonly acceptUnverifiedDevSignature?: (() => boolean) | undefined;
}

export interface DownloadOptions {
  /** Avance de la descarga, de 0 a 1. */
  readonly onProgress?: ((fraction: number) => void) | undefined;
  /** Núcleo en uso: si tiene ≤7 días y el *manifest* trae `recent`, no se baja otro (CA2.4). */
  readonly current?: CoreFile | null | undefined;
  /** «Actualizar catálogo»: el núcleo del *manifest*, aunque el local tenga ≤7 días. */
  readonly forceCore?: boolean | undefined;
}

export interface CatalogStore {
  /** El catálogo más reciente de la caché con todos sus ficheros válidos, o `null`. */
  readCached(): Promise<CatalogTexts | null>;
  /** `manifest.json` de la red, revalidado (`no-cache`), con la firma verificada. */
  fetchManifest(): Promise<CatalogManifest>;
  /**
   * Los ficheros del *manifest*: de la caché si ya están y son válidos; si no, de la red, con su
   * avance en bytes. Con un núcleo en uso de ≤7 días, lo reutiliza. Al terminar guarda el
   * *manifest* y borra las versiones anteriores.
   */
  download(manifest: CatalogManifest, options?: DownloadOptions): Promise<CatalogTexts>;
}

/** Antigüedad máxima del núcleo local para no bajar el nuevo (§5.4, §7.6; CA2.4). */
export const CORE_MAX_AGE_DAYS = 7;

/** Modos de Vite que confían en la clave de desarrollo (§11.3): nunca el de producción. */
const DEV_KEY_MODES: ReadonlySet<string> = new Set(['development', 'e2e']);

/** Las claves en las que confía el *build* del modo `mode` (`import.meta.env.MODE`). */
export function signingKeysForMode(mode: string): readonly CatalogSigningKey[] {
  return trustedSigningKeys({ dev: DEV_KEY_MODES.has(mode) });
}

const CACHE_PREFIX = 'gacat-';
/** Solo las cachés de versión: `gacat-details` (los *shards* pedidos, §7.6) no se toca. */
const RE_CACHE_NAME = /^gacat-(\d{8})\.([1-9]\d*)$/;
const RE_SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const DAY_MS = 86_400_000;

/** Ordena versiones `AAAAMMDD.N`: negativo si `a` es anterior a `b`. */
export function compareCatalogVersions(a: string, b: string): number {
  const [da = 0, na = 0] = a.split('.').map(Number);
  const [db = 0, nb = 0] = b.split('.').map(Number);
  return da - db || na - nb;
}

/** Días naturales entre las fechas de dos versiones `AAAAMMDD.N` (`to` − `from`). */
export function catalogAgeDays(from: string, to: string): number {
  const day = (v: string) =>
    Date.UTC(Number(v.slice(0, 4)), Number(v.slice(4, 6)) - 1, Number(v.slice(6, 8))) / DAY_MS;
  return day(to) - day(from);
}

/**
 * Regla de los 7 días: ¿sigue valiendo el núcleo `local` con este *manifest*? Sí si es el mismo
 * fichero o si el *manifest* trae `recent` (altas y renombrados de 14 días) y el núcleo local no
 * tiene más de 7 días.
 */
export function canKeepCore(local: CoreFile, manifest: CatalogManifest): boolean {
  if (local.sha256 === manifest.files.core.sha256) return true;
  if (!manifest.files.recent) return false;
  const age = catalogAgeDays(local.version, manifest.version);
  return age >= 0 && age <= CORE_MAX_AGE_DAYS;
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

/** `importKey` o `verify` de un algoritmo que el navegador no conoce (Ed25519 antes de 2025). */
function isNotSupported(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'NotSupportedError'
  );
}

function contentType(path: string): string {
  return path.endsWith('.json') ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8';
}

const decoder = new TextDecoder('utf-8');

export function createCatalogStore(deps: CatalogStoreDeps): CatalogStore {
  const manifestUrl = new URL('manifest.json', deps.baseUrl).href;
  /** Clave de la caché (nunca se pide a la red) con el núcleo en uso, `CoreFile`. */
  const localCoreUrl = new URL('gacat-local.json', deps.baseUrl).href;
  const fileUrl = (path: string): string => new URL(path, deps.baseUrl).href;
  /** Claves públicas importadas, por `kid`. */
  const verifyKeys = new Map<string, Promise<CryptoKey>>();

  async function isValid(bytes: Uint8Array<ArrayBuffer>, spec: FileSpec): Promise<boolean> {
    if (bytes.byteLength !== spec.bytes) return false;
    return toHex(await deps.subtle.digest('SHA-256', bytes)) === spec.sha256;
  }

  function parseManifest(json: unknown): CatalogManifest | null {
    const parsed = catalogManifestSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  }

  function parseCoreFile(json: unknown): CoreFile | null {
    const parsed = catalogFileSchema.safeParse(json);
    const version = (json as { version?: unknown } | null)?.version;
    if (!parsed.success || typeof version !== 'string' || !isCatalogVersion(version)) return null;
    return { ...parsed.data, version };
  }

  function importVerifyKey(key: CatalogSigningKey): Promise<CryptoKey> {
    let imported = verifyKeys.get(key.kid);
    if (!imported) {
      const raw = fromBase64Url(key.ed25519);
      imported =
        raw?.byteLength === 32
          ? deps.subtle.importKey('raw', new Uint8Array(raw), { name: 'Ed25519' }, false, [
              'verify',
            ])
          : Promise.reject(new CatalogLoadError('signature', `Clave pública «${key.kid}» rota`));
      imported.catch(() => verifyKeys.delete(key.kid));
      verifyKeys.set(key.kid, imported);
    }
    return imported;
  }

  /**
   * Firma ed25519 del JSON canónico sin `sig` (§7.6). Se verifica `json`, el *manifest* tal como
   * llega (`JSON.parse`), y no el del esquema: Zod quita los campos desconocidos, que también van
   * firmados.
   */
  async function verifySignature(json: unknown, manifest: CatalogManifest): Promise<void> {
    const sig = manifest.sig;
    if (!sig) throw new CatalogLoadError('signature', 'El manifest no va firmado');
    const key = deps.signingKeys.find((k) => k.kid === sig.kid);
    if (!key) {
      throw new CatalogLoadError(
        'signature',
        `El manifest va firmado con otra clave («${sig.kid}»)`,
      );
    }
    const signature = fromBase64Url(sig.ed25519);
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = new Uint8Array(manifestSigningBytes(json as Record<string, unknown>));
    } catch {
      throw new CatalogLoadError('signature', 'El manifest no se puede pasar a JSON canónico');
    }
    if (signature?.byteLength !== 64) {
      throw new CatalogLoadError('signature', 'La firma del manifest no es válida');
    }
    let ok: boolean;
    try {
      const publicKey = await importVerifyKey(key);
      ok = await deps.subtle.verify('Ed25519', publicKey, new Uint8Array(signature), bytes);
    } catch (error) {
      if (error instanceof CatalogLoadError) throw error;
      if (!isNotSupported(error)) {
        throw new CatalogLoadError('signature', 'No se ha podido verificar la firma del manifest');
      }
      // Sin Ed25519 no se puede aceptar ningún *manifest*: sigue el catálogo de la caché (RNF-12).
      if (key.use === 'dev' && deps.acceptUnverifiedDevSignature?.()) return;
      throw new CatalogLoadError('browser-too-old', 'Este navegador no tiene Ed25519 en WebCrypto');
    }
    if (!ok) throw new CatalogLoadError('signature', 'La firma del manifest no es válida');
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
      // Ficheros inmutables (el *hash* va en el nombre): la caché HTTP vale tal cual. Pero
      // `ga-catalog` sirve también los 404 con `immutable` (ver ADR-003): si falla, se reintenta
      // una vez sin la caché HTTP, por si lo que guarda es un 404 de cuando el fichero no estaba.
      response = await deps.fetch(fileUrl(spec.path));
      if (!response.ok) response = await deps.fetch(fileUrl(spec.path), { cache: 'reload' });
    } catch {
      throw new CatalogLoadError('network', `Sin red al descargar ${spec.path}`, spec.path);
    }
    if (!response.ok) {
      throw new CatalogLoadError('http', `${spec.path}: HTTP ${response.status}`, spec.path);
    }
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = await readBody(response, spec.bytes, onBytes);
    } catch {
      throw new CatalogLoadError('network', `Descarga cortada: ${spec.path}`, spec.path);
    }
    if (!(await isValid(bytes, spec))) {
      throw new CatalogLoadError('integrity', `${spec.path} no coincide con su sha256`, spec.path);
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
        // Sin `gacat-local.json` (las cachés de M1), el núcleo es el del *manifest*.
        const local = await cache.match(localCoreUrl);
        const coreFile = local
          ? parseCoreFile(await local.json().catch(() => null))
          : { ...manifest.files.core, version: manifest.version };
        if (!coreFile) continue;
        const core = await cachedFile(coreFile, cache);
        const aliases = core && (await cachedFile(manifest.files.aliases, cache));
        if (!core || !aliases) continue;
        const recentSpec = manifest.files.recent;
        const recent = recentSpec ? await cachedFile(recentSpec, cache) : null;
        if (recentSpec && !recent) continue;
        return {
          manifest,
          coreFile,
          core: decoder.decode(core),
          recent: recent && decoder.decode(recent),
          aliases: decoder.decode(aliases),
        };
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
      const json: unknown = await response.json().catch(() => null);
      const manifest = parseManifest(json);
      if (!manifest) throw new CatalogLoadError('manifest', 'El manifest no es válido');
      // Antes que nada más: un *manifest* sin firma válida no dice nada (tampoco su versión mínima).
      await verifySignature(json, manifest);
      if (!satisfiesMinVersion(deps.appVersion, manifest.minClientVersion)) {
        throw new CatalogLoadError(
          'client-too-old',
          `El catálogo pide la versión ${manifest.minClientVersion} de la app`,
        );
      }
      return manifest;
    },

    async download(manifest, options = {}) {
      const { files } = manifest;
      const local = options.current ?? null;
      let coreFile: CoreFile = { ...files.core, version: manifest.version };
      let coreBytes: Uint8Array<ArrayBuffer> | null = null;
      if (local && !options.forceCore && canKeepCore(local, manifest) && deps.caches) {
        // Regla de los 7 días: el núcleo en uso, si sigue en la caché (si no, el del *manifest*).
        coreBytes = await cachedFile(local, deps.caches);
        if (coreBytes) coreFile = local;
      }
      // El índice de *shards* solo hace falta si los detalles no están apagados (CA2.3).
      const details = manifest.killSwitches?.details ? undefined : files.details;
      const specs: FileSpec[] = [coreFile, files.aliases];
      if (files.recent) specs.push(files.recent);
      if (details) specs.push(details);
      const found: (Uint8Array<ArrayBuffer> | null)[] = [coreBytes];
      for (const spec of specs.slice(1)) {
        // Ya descargado: una descarga cortada o el mismo fichero en la versión anterior.
        found.push(deps.caches ? await cachedFile(spec, deps.caches) : null);
      }
      if (!found[0] && deps.caches) found[0] = await cachedFile(coreFile, deps.caches);

      const total = specs.reduce((sum, spec) => sum + spec.bytes, 0) || 1;
      let received = 0;
      const progress = (bytes: number) => {
        received += bytes;
        options.onProgress?.(Math.min(1, received / total));
      };
      for (const bytes of found) if (bytes) progress(bytes.byteLength);

      const name = `${CACHE_PREFIX}${manifest.version}`;
      const cache = deps.caches ? await deps.caches.open(name) : null;
      const texts: string[] = [];
      for (const [i, spec] of specs.entries()) {
        const bytes = found[i] ?? (await fetchFile(spec, progress));
        await cache?.put(
          fileUrl(spec.path),
          new Response(bytes, { headers: { 'Content-Type': contentType(spec.path) } }),
        );
        texts.push(decoder.decode(bytes));
      }
      if (cache && deps.caches) {
        await cache.put(localCoreUrl, Response.json(coreFile));
        // El *manifest* se guarda el último: marca la versión como completa.
        await cache.put(
          manifestUrl,
          new Response(JSON.stringify(manifest), {
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
          }),
        );
        for (const other of await deps.caches.keys()) {
          if (RE_CACHE_NAME.test(other) && other !== name) await deps.caches.delete(other);
        }
      }
      return {
        manifest,
        coreFile,
        core: texts[0] as string,
        recent: files.recent ? (texts[2] as string) : null,
        aliases: texts[1] as string,
      };
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
