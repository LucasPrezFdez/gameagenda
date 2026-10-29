// Catálogo de desarrollo (ver §13.3 y §13.5): `npm run dev` y `vite preview` sirven el directorio
// `CATALOG_DIR` (variable de entorno o `.env.local` de la raíz; por defecto `fixtures/catalog`) en
// `/catalog-dev/`, en el mismo origen que la app (`connect-src 'self'`, ver §11.3). Como
// `ga-catalog` (§7.6): `manifest.json` en `no-cache` y los TSV como `text/plain; charset=utf-8`.
import { createReadStream, statSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import { type Connect, loadEnv, type Plugin } from 'vite';

export const CATALOG_DEV_PATH = '/catalog-dev/';
export const DEFAULT_CATALOG_DIR = 'fixtures/catalog';

// Rutas relativas sin `..` ni barra inicial, como `files.*.path` del *manifest*.
const RE_PATH = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;

function headersFor(file: string): Record<string, string> {
  if (file === 'manifest.json') {
    return { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' };
  }
  const type = file.endsWith('.tsv') ? 'text/plain; charset=utf-8' : 'application/json';
  // El resto lleva el *hash* en el nombre y nunca cambia.
  return { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable' };
}

function notFound(res: ServerResponse): void {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('No está en el catálogo de desarrollo');
}

function catalogMiddleware(dir: () => string): Connect.NextHandleFunction {
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    // `use(CATALOG_DEV_PATH, …)` ya quita el prefijo de `req.url`.
    let relative: string;
    try {
      const { pathname } = new URL(req.url ?? '/', 'http://localhost');
      relative = decodeURIComponent(pathname).replace(/^\/+/, '');
    } catch {
      return notFound(res);
    }
    if (!RE_PATH.test(relative)) return notFound(res);
    const root = dir();
    const file = path.resolve(root, relative);
    if (!file.startsWith(`${root}${path.sep}`)) return notFound(res);
    let size: number;
    try {
      const stat = statSync(file);
      if (!stat.isFile()) return notFound(res);
      size = stat.size;
    } catch {
      return notFound(res);
    }
    res.statusCode = 200;
    for (const [name, value] of Object.entries(headersFor(relative))) res.setHeader(name, value);
    res.setHeader('Content-Length', String(size));
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
  };
}

/** *Plugin* de Vite que sirve `CATALOG_DIR` en `/catalog-dev/` con `dev` y con `vite preview`. */
export function catalogDevPlugin(repoRoot: string): Plugin {
  let dir = path.resolve(repoRoot, DEFAULT_CATALOG_DIR);
  return {
    name: 'gameagenda:catalog-dev',
    configResolved(config) {
      // `process.env` manda sobre `.env.local` (así lo hace `loadEnv`).
      const env = loadEnv(config.mode, repoRoot, 'CATALOG_');
      dir = path.resolve(repoRoot, env.CATALOG_DIR || DEFAULT_CATALOG_DIR);
    },
    configureServer(server) {
      server.config.logger.info(`  Catálogo de desarrollo: ${dir} → ${CATALOG_DEV_PATH}`);
      server.middlewares.use(
        CATALOG_DEV_PATH,
        catalogMiddleware(() => dir),
      );
    },
    configurePreviewServer(server) {
      server.config.logger.info(`  Catálogo de desarrollo: ${dir} → ${CATALOG_DEV_PATH}`);
      server.middlewares.use(
        CATALOG_DEV_PATH,
        catalogMiddleware(() => dir),
      );
    },
  };
}
