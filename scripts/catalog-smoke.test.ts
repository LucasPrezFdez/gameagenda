import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assemble } from './assemble-catalog.ts';
import type { FetchLike } from './catalog-live.ts';
import { smoke } from './catalog-smoke.ts';
import { cleanup, DEV_KEY, tempDir, writeTestCatalog } from './test-helpers.ts';

const dirs: string[] = [];
afterEach(() => cleanup(dirs));

const WEB = 'https://ga-web.gameagenda.workers.dev';
const URL_ = 'https://ga-catalog.example.workers.dev';

/** `ga-catalog` simulado: sirve `dist` con las cabeceras de `_headers` (resumidas). */
function cdn(dist: string, tweak: (path: string, h: Headers) => void = () => {}): FetchLike {
  return async (url) => {
    const path = new URL(url).pathname.slice(1);
    const h = new Headers({ 'access-control-allow-origin': WEB });
    const full = join(dist, ...path.split('/'));
    if (path === '_headers' || !existsSync(full)) {
      h.set('cache-control', 'public, max-age=31536000, immutable');
      tweak(path, h);
      return new Response('', { status: 404, headers: h });
    }
    if (path === 'manifest.json') h.set('cache-control', 'no-cache');
    else h.set('cache-control', 'public, max-age=31536000, immutable');
    if (path.endsWith('.tsv')) {
      h.set('content-type', 'text/plain; charset=utf-8');
      h.set('content-encoding', 'gzip');
    }
    tweak(path, h);
    return new Response(readFileSync(full), { status: 200, headers: h });
  };
}

async function deployed(): Promise<string> {
  const prev = writeTestCatalog(tempDir('prev-', dirs), {
    version: '20261030.1',
    appids: [730, 10],
    sign: { kid: 'dev-1', key: DEV_KEY },
  });
  const next = writeTestCatalog(tempDir('next-', dirs), {
    version: '20261031.1',
    sign: { kid: 'dev-1', key: DEV_KEY },
  });
  const dist = join(tempDir('dist-', dirs), 'dist');
  await assemble({ source: next.dir, previous: prev.dir, out: dist, signature: 'dev' });
  return dist;
}

describe('catalog-smoke: lo publicado es lo montado (CA2.4)', () => {
  it('todo correcto: manifest firmado y los ficheros de las dos versiones con CORS', async () => {
    const dist = await deployed();
    const r = await smoke({
      url: URL_,
      dist,
      webOrigin: WEB,
      signature: 'dev',
      fetchImpl: cdn(dist),
    });
    expect(r.problems).toEqual([]);
    expect(r.version).toBe('20261031.1');
    expect(r.rows[0]?.path).toBe('manifest.json');
    expect(r.rows.at(-1)).toMatchObject({ path: 'core.0000000000000000.tsv', status: 404 });
  });

  it('con signature=prod, una firma de desarrollo es un problema', async () => {
    const dist = await deployed();
    const r = await smoke({ url: URL_, dist, webOrigin: WEB, fetchImpl: cdn(dist) });
    expect(r.problems.join('\n')).toMatch(/clave de desarrollo/);
  });

  it('detecta CORS, Content-Type y caché que no son los de _headers', async () => {
    const dist = await deployed();
    const fetchImpl = cdn(dist, (path, h) => {
      if (path.startsWith('aliases.')) h.delete('access-control-allow-origin');
      if (path.startsWith('core.') && path !== 'core.0000000000000000.tsv') {
        h.set('content-type', 'text/tab-separated-values');
        h.delete('content-encoding');
      }
      if (path === 'manifest.json') h.set('cache-control', 'max-age=60');
      if (path === 'core.0000000000000000.tsv') h.delete('access-control-allow-origin');
    });
    const r = await smoke({ url: URL_, dist, webOrigin: WEB, signature: 'dev', fetchImpl });
    const all = r.problems.join('\n');
    expect(all).toMatch(/aliases\..* sin CORS/);
    expect(all).toMatch(/core\..* no es text\/plain/);
    expect(all).toMatch(/manifest.json sin Cache-Control: no-cache/);
    expect(all).toMatch(/el 404 no lleva CORS/);
    expect(r.warnings.join('\n')).toMatch(/sin Content-Encoding/);
  });

  it('detecta un fichero que falta o distinto, y un manifest que no es el nuevo', async () => {
    const dist = await deployed();
    const base = cdn(dist);
    const fetchImpl: FetchLike = async (url, init) => {
      const path = new URL(url).pathname.slice(1);
      if (path.startsWith('recent.')) return new Response('', { status: 404 });
      if (path.startsWith('details/index.')) return new Response('{}', { status: 200 });
      if (path === 'manifest.json') {
        const res = await base(url, init);
        return new Response('{"version":"20261030.1"}', { status: 200, headers: res.headers });
      }
      return base(url, init);
    };
    const r = await smoke({
      url: URL_,
      dist,
      webOrigin: WEB,
      signature: 'dev',
      fetchImpl,
      waitMs: 10,
      pollMs: 1,
    });
    const all = r.problems.join('\n');
    expect(all).toMatch(/recent\..* responde 404/);
    expect(all).toMatch(/details\/index\..*: lo servido no es el fichero montado/);
    expect(all).toMatch(/manifest.json no es el montado/);
  });

  it('avisa si wrangler ha publicado en otro origen que CATALOG_ORIGIN', async () => {
    const dist = await deployed();
    const r = await smoke({
      url: URL_,
      dist,
      webOrigin: WEB,
      signature: 'dev',
      expectOrigin: 'https://ga-catalog.gameagenda.workers.dev',
      fetchImpl: cdn(dist),
    });
    expect(r.problems.join('\n')).toMatch(/cambia la variable CATALOG_ORIGIN/);
  });
});
