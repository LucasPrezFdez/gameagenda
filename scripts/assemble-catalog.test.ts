import { createHash, generateKeyPairSync } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CATALOG_SIGNING_KEYS,
  type CatalogSigningKey,
  detailShardOf,
} from '@gameagenda/core/catalog-format';
import { afterEach, describe, expect, it } from 'vitest';
import { assemble, checkSignature } from './assemble-catalog.ts';
import type { FetchLike } from './catalog-live.ts';
import { cleanup, DEV_KEY, signManifest, tempDir, writeTestCatalog } from './test-helpers.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const dirs: string[] = [];
afterEach(() => cleanup(dirs));

function files(dir: string): string[] {
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((n) => {
      const p = join(d, n);
      return statSync(p).isDirectory() ? walk(p) : [relative(dir, p).split(sep).join('/')];
    });
  return walk(dir).sort();
}

/** `fetch` que sirve la carpeta `dir` como si fuera `origin`. */
function serveDir(origin: string, dir: string | null): FetchLike {
  return async (url) => {
    const path = decodeURIComponent(new URL(url).pathname.slice(1));
    const full = dir ? join(dir, ...path.split('/')) : '';
    if (!url.startsWith(origin) || !dir || !existsSync(full)) {
      return new Response('', { status: 404 });
    }
    return new Response(readFileSync(full), { status: 200 });
  };
}

describe('assemble-catalog: carpeta de ga-catalog con la versión anterior (CA2.4)', () => {
  it('monta la versión nueva y los ficheros de la anterior; solo entra el manifest nuevo', async () => {
    const prev = writeTestCatalog(tempDir('prev-', dirs), {
      version: '20261030.1',
      appids: [730, 570],
    });
    const next = writeTestCatalog(tempDir('next-', dirs), {
      version: '20261031.1',
      appids: [730, 570, 367520],
      salt: '!',
    });
    const out = join(tempDir('out-', dirs), 'dist');
    const r = await assemble({ source: next.dir, previous: prev.dir, out });

    expect(r.version).toBe('20261031.1');
    expect(r.previousVersion).toBe('20261030.1');
    const published = files(out);
    for (const p of [...next.paths, ...prev.paths]) expect(published).toContain(p);
    expect(published).toContain('_headers');
    expect(published.filter((p) => p.endsWith('manifest.json'))).toEqual(['manifest.json']);
    expect(JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')).version).toBe('20261031.1');
    // Los alias no cambian entre versiones salvo la cabecera: aquí cambian, así que hay dos.
    expect(r.files).toBe(new Set([...next.paths, ...prev.paths]).size + 2);
    expect(r.previousOnly).toBe(new Set(prev.paths.filter((p) => !next.paths.includes(p))).size);
  });

  it('un fichero que está en las dos versiones va una vez', async () => {
    const prev = writeTestCatalog(tempDir('prev-', dirs), { version: '20261030.1' });
    const next = writeTestCatalog(tempDir('next-', dirs), { version: '20261031.1', salt: 'x' });
    // Mismo *shard* en las dos (mismos detalles): la misma ruta y el mismo contenido.
    const shared = next.paths.filter((p) => prev.paths.includes(p));
    expect(shared.length).toBeGreaterThan(0);
    const out = join(tempDir('out-', dirs), 'dist');
    const r = await assemble({ source: next.dir, previous: prev.dir, out });
    expect(r.previousOnly).toBe(prev.paths.length - shared.length);
  });

  it('descarga la versión anterior del ga-catalog publicado; un 404 es la primera publicación', async () => {
    const origin = 'https://ga-catalog.example.workers.dev';
    const prev = writeTestCatalog(tempDir('prev-', dirs), { version: '20261030.2' });
    const next = writeTestCatalog(tempDir('next-', dirs), { version: '20261031.1', salt: 'y' });
    const out = join(tempDir('out-', dirs), 'dist');
    const r = await assemble({
      source: next.dir,
      previous: origin,
      out,
      fetchImpl: serveDir(origin, prev.dir),
    });
    expect(r.previousVersion).toBe('20261030.2');
    for (const p of prev.paths) expect(existsSync(join(out, ...p.split('/')))).toBe(true);

    const first = await assemble({
      source: next.dir,
      previous: origin,
      out,
      fetchImpl: serveDir(origin, null),
    });
    expect(first.previousVersion).toBeNull();
    expect(first.previousOnly).toBe(0);
  });

  it('sigue montando el mini-catálogo de M0 (fixtures/catalog, sin firma)', async () => {
    const out = join(tempDir('out-', dirs), 'dist');
    const r = await assemble({ source: join(root, 'fixtures/catalog'), out });
    expect(r.version).toBe('20261028.1');
    expect(r.signature).toBe('sin firma');
    expect(files(out)).toEqual([
      '_headers',
      'aliases.c2260f78db024b1a.tsv',
      'core.f7d1ce6bcb576d9b.tsv',
      'manifest.json',
    ]);
    expect(readFileSync(join(out, '_headers'), 'utf8')).toBe(
      readFileSync(join(root, 'pipeline/catalog.headers'), 'utf8'),
    );
  });

  it('avisa de lo que el manifest no cita y no lo publica', async () => {
    const next = writeTestCatalog(tempDir('next-', dirs), { version: '20261031.1' });
    writeFileSync(join(next.dir, 'details', '0001.0123456789abcdef.json'), '{}\n');
    const out = join(tempDir('out-', dirs), 'dist');
    const r = await assemble({ source: next.dir, out });
    expect(r.unreferenced).toEqual(['details/0001.0123456789abcdef.json']);
    expect(existsSync(join(out, 'details', '0001.0123456789abcdef.json'))).toBe(false);
  });
});

describe('assemble-catalog: lo que no se publica', () => {
  async function rejects(
    mutate: (dir: string, manifest: Record<string, unknown>) => void,
    message: RegExp,
  ): Promise<void> {
    const next = writeTestCatalog(tempDir('next-', dirs), { version: '20261031.1' });
    mutate(next.dir, next.manifest);
    const outParent = tempDir('out-', dirs);
    const out = join(outParent, 'dist');
    writeFileSync(join(outParent, 'marker'), 'x');
    await expect(assemble({ source: next.dir, out })).rejects.toThrow(message);
    expect(existsSync(out)).toBe(false);
  }

  const manifestFiles = (m: Record<string, unknown>) =>
    m.files as Record<string, { path: string; sha256: string; bytes: number }>;
  const rewrite = (dir: string, m: Record<string, unknown>) =>
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m));

  it('un fichero cuyo SHA-256 no es el del manifest', async () => {
    await rejects((dir, m) => {
      const core = manifestFiles(m).core as { path: string };
      writeFileSync(join(dir, core.path), 'otro contenido');
    }, /bytes, no|SHA-256/);
  });

  it('un nombre sin el prefijo de su hash', async () => {
    await rejects((dir, m) => {
      const aliases = manifestFiles(m).aliases as { path: string };
      const renamed = aliases.path.replace(/\.[0-9a-f]{16}\./, '.0000000000000000.');
      writeFileSync(join(dir, renamed), readFileSync(join(dir, aliases.path)));
      aliases.path = renamed;
      rewrite(dir, m);
    }, /prefijo de su hash/);
  });

  it('un fichero que falta', async () => {
    await rejects((dir, m) => {
      const recent = manifestFiles(m).recent as { path: string };
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m));
      rmFile(join(dir, recent.path));
    }, /no está en/);
  });

  it('un shard cuyo contenido no da el hash de su nombre', async () => {
    await rejects((dir) => {
      const shard = shardFiles(dir)[0] as string;
      writeFileSync(join(dir, 'details', shard), '{"730":[]}\n');
    }, /no empieza por el hash/);
  });

  it('un shard que no cumple el esquema o con un appid de otro shard', async () => {
    const other = [1, 2, 3, 4, 5].find((a) => detailShardOf(a) !== detailShardOf(730)) as number;
    for (const [content, message] of [
      ['{"730":["sin formato"]}\n', /no cumple el esquema/],
      [
        `{"730":${JSON.stringify(validDetails())},"${other}":${JSON.stringify(validDetails())}}\n`,
        /es del shard/,
      ],
    ] as const) {
      await rejects((dir, m) => replaceShard(dir, m, 730, content), message);
    }
  });

  it('un índice de shards de otra versión', async () => {
    await rejects((dir, m) => {
      const spec = manifestFiles(m).details as { path: string; sha256: string; bytes: number };
      const index = JSON.parse(readFileSync(join(dir, ...spec.path.split('/')), 'utf8'));
      index.version = '20261030.1';
      writeReplaced(dir, m, 'details', `${JSON.stringify(index)}\n`, 'details/index', 'json');
    }, /es de la versión 20261030.1/);
  });

  it('una versión que no es posterior a la publicada', async () => {
    const prev = writeTestCatalog(tempDir('prev-', dirs), { version: '20261031.1' });
    const next = writeTestCatalog(tempDir('next-', dirs), { version: '20261031.1', salt: 'z' });
    const out = join(tempDir('out-', dirs), 'dist');
    await expect(assemble({ source: next.dir, previous: prev.dir, out })).rejects.toThrow(
      /no es posterior/,
    );
  });

  it('la misma ruta con otro contenido en la versión anterior', async () => {
    const prev = writeTestCatalog(tempDir('prev-', dirs), { version: '20261030.1' });
    const next = writeTestCatalog(tempDir('next-', dirs), { version: '20261031.1', salt: 'w' });
    const nextCore = (manifestFiles(next.manifest).core as { path: string }).path;
    const prevFiles = manifestFiles(prev.manifest);
    // La anterior dice que `core` tiene la ruta de la nueva, con otro SHA-256.
    (prevFiles.core as { path: string }).path = nextCore;
    writeFileSync(join(prev.dir, 'manifest.json'), JSON.stringify(prev.manifest));
    const out = join(tempDir('out-', dirs), 'dist');
    await expect(assemble({ source: next.dir, previous: prev.dir, out })).rejects.toThrow();
  });

  it('más ficheros o más grandes que los límites del plan gratuito', async () => {
    const next = writeTestCatalog(tempDir('next-', dirs), { version: '20261031.1' });
    const out = join(tempDir('out-', dirs), 'dist');
    await expect(
      assemble({ source: next.dir, out, limits: { maxFiles: 3, maxFileBytes: 1 << 20 } }),
    ).rejects.toThrow(/admite 3 por despliegue/);
    await expect(
      assemble({ source: next.dir, out, limits: { maxFiles: 100, maxFileBytes: 100 } }),
    ).rejects.toThrow(/máximo por fichero es 100/);
    expect(existsSync(out)).toBe(false);
  });
});

describe('assemble-catalog: firma del manifest', () => {
  const prodPair = generateKeyPairSync('ed25519');
  const prodKey: CatalogSigningKey = {
    kid: 'prod-test',
    ed25519: prodPair.publicKey.export({ format: 'jwk' }).x as string,
    use: 'prod',
  };
  const keys = [...CATALOG_SIGNING_KEYS, prodKey];

  it('sin firma: vale si es opcional, no si se exige', () => {
    const { manifest } = writeTestCatalog(tempDir('c-', dirs), { version: '20261031.1' });
    expect(checkSignature(manifest, 'optional')).toBe('sin firma');
    expect(() => checkSignature(manifest, 'dev')).toThrow(/no lleva firma/);
    expect(() => checkSignature(manifest, 'prod')).toThrow(/no lleva firma/);
  });

  it('con la clave de desarrollo: vale en dev y nunca en prod', () => {
    const { manifest } = writeTestCatalog(tempDir('c-', dirs), {
      version: '20261031.1',
      sign: { kid: 'dev-1', key: DEV_KEY },
    });
    expect(checkSignature(manifest, 'dev')).toBe('firmado con dev-1 (dev)');
    expect(() => checkSignature(manifest, 'prod')).toThrow(/clave de desarrollo/);
  });

  it('con una clave de producción conocida: vale en prod; manipulada o desconocida, no', () => {
    const { manifest } = writeTestCatalog(tempDir('c-', dirs), {
      version: '20261031.1',
      sign: { kid: 'prod-test', key: prodPair.privateKey },
    });
    expect(checkSignature(manifest, 'prod', keys)).toBe('firmado con prod-test (prod)');
    expect(() => checkSignature({ ...manifest, enrichmentAgeDays: 3 }, 'prod', keys)).toThrow(
      /no es válida/,
    );
    // Sin su pública en CATALOG_SIGNING_KEYS, el cliente la rechazaría.
    expect(() => checkSignature(manifest, 'prod')).toThrow(/no está en CATALOG_SIGNING_KEYS/);
    const wrongKid = signManifest(manifest, 'dev-1', prodPair.privateKey);
    expect(() => checkSignature(wrongKid, 'dev', keys)).toThrow(/no es válida/);
  });

  it('assemble con --signature=prod rechaza la de desarrollo antes de tocar la carpeta', async () => {
    const next = writeTestCatalog(tempDir('next-', dirs), {
      version: '20261031.1',
      sign: { kid: 'dev-1', key: DEV_KEY },
    });
    const out = join(tempDir('out-', dirs), 'dist');
    await expect(assemble({ source: next.dir, out, signature: 'prod' })).rejects.toThrow(
      /clave de desarrollo/,
    );
    expect(existsSync(out)).toBe(false);
    const ok = await assemble({ source: next.dir, out, signature: 'dev' });
    expect(ok.signature).toBe('firmado con dev-1 (dev)');
  });
});

// --- Ayudas para estropear catálogos ---------------------------------------------------------

function rmFile(path: string): void {
  rmSync(path);
}

function shardFiles(dir: string): string[] {
  return readdirSync(join(dir, 'details')).filter((n) => !n.startsWith('index.'));
}

function validDetails(): unknown {
  return [`steam/apps/1/\${FILENAME}`, null, 'header.jpg', [null, 'tba'], [0, 0, 0], 1, 0];
}

/** Sustituye un fichero del manifest por `text` (con su nombre y *hash* nuevos). */
function writeReplaced(
  dir: string,
  m: Record<string, unknown>,
  kind: string,
  text: string,
  prefix: string,
  ext: string,
): void {
  const hash = createHash('sha256').update(text).digest('hex');
  const path = `${prefix}.${hash.slice(0, 16)}.${ext}`;
  writeFileSync(join(dir, ...path.split('/')), text);
  (m.files as Record<string, unknown>)[kind] = {
    path,
    sha256: hash,
    bytes: Buffer.byteLength(text),
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m));
}

/** Pone `text` como el *shard* de `appid` y rehace su nombre y el índice. */
function replaceShard(dir: string, m: Record<string, unknown>, appid: number, text: string): void {
  const n = detailShardOf(appid);
  const hash = createHash('sha256').update(text).digest('hex').slice(0, 16);
  writeFileSync(join(dir, 'details', `${String(n).padStart(4, '0')}.${hash}.json`), text);
  const spec = (m.files as Record<string, { path: string }>).details as { path: string };
  const index = JSON.parse(readFileSync(join(dir, ...spec.path.split('/')), 'utf8'));
  index.shards[n] = hash;
  writeReplaced(dir, m, 'details', `${JSON.stringify(index)}\n`, 'details/index', 'json');
}
