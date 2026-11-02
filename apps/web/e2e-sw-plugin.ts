// Solo en `vite preview --mode e2e` (§12.3): «despliega» una versión nueva del Service Worker para
// una prueba. Con la *cookie* `ga-e2e-sw`, `/sw.js` sale con un comentario más al final, como un
// `sw.js` de otro *build*. Playwright no puede interceptar la petición con la que el navegador
// busca una versión nueva, y las *cookies* van por contexto: las pruebas en paralelo no se pisan.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

export const E2E_SW_COOKIE = 'ga-e2e-sw';

/** El valor de la *cookie*, si viene y es corto y sin rarezas. */
export function e2eSwVersion(cookieHeader: string | undefined): string | null {
  for (const part of (cookieHeader ?? '').split(';')) {
    const [name, value] = part.trim().split('=');
    if (name === E2E_SW_COOKIE && value && /^[A-Za-z0-9_-]{1,32}$/.test(value)) return value;
  }
  return null;
}

export function e2eServiceWorkerPlugin(): Plugin {
  return {
    name: 'gameagenda:e2e-sw',
    apply: (_config, env) => env.mode === 'e2e',
    configurePreviewServer(server) {
      const outDir = path.resolve(server.config.root, server.config.build.outDir);
      server.middlewares.use((req, res, next) => {
        const version = e2eSwVersion(req.headers.cookie);
        if (req.method !== 'GET' || version === null || req.url?.split('?')[0] !== '/sw.js') {
          return next();
        }
        const body = `${readFileSync(path.join(outDir, 'sw.js'), 'utf8')}\n// e2e: ${version}\n`;
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(body);
      });
    },
  };
}
