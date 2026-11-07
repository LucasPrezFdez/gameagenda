// Solo en `vite preview --mode e2e` (§12.3): la micro-API real (`worker/app.ts`) en `/api/*` y las
// rutas de apoyo de los E2E en `/__e2e/*`, para las pruebas de sincronización con dos contextos de
// navegador (CA4.2 y CA4.3). Lo demás sigue como siempre. El servidor está en `e2e-api-server.ts`
// y se carga al arrancar la vista previa: ni `vite build` ni `vite dev` cargan la micro-API ni
// `node:sqlite`. Node lo ejecuta tal cual, sin *bundler* (con la eliminación de tipos de Node 24).
//
// Espejo HTTPS: la misma vista previa (los mismos *middlewares* y la misma micro-API) también por
// `https://127.0.0.1:<E2E_HTTPS_PORT>`, con un certificado autofirmado nuevo en cada arranque. Las
// *cookies* de la micro-API son `__Host-`, así que llevan `Secure`: Chromium las trata igual por
// `http://127.0.0.1`, pero el WebKit de Playwright las guarda y luego ni las envía ni las deja leer
// por HTTP (comprobado el 07-11-2026). Las pruebas de sincronización van por el espejo
// (`e2e/sync-server.ts`); las demás, por HTTP como siempre.
import { once } from 'node:events';
import { createServer } from 'node:https';
import type { Plugin } from 'vite';
import { selfSignedCertificate } from './e2e-https.ts';

type E2eApiServer = typeof import('./e2e-api-server.ts');

/** La *cookie* que elige el mundo (D1 y reloj propios) de una prueba; ver `e2e-api-server.ts`. */
export const E2E_API_COOKIE = 'ga-e2e-api';
export const E2E_ROUTES_PREFIX = '/__e2e/';
/** Por defecto, el espejo HTTPS escucha en el puerto de la vista previa más este. */
export const E2E_HTTPS_PORT_OFFSET = 10_000;

/** El puerto del espejo HTTPS para una vista previa en `port` (o el de `E2E_HTTPS_PORT`). */
export function e2eHttpsPort(port: number, env: NodeJS.ProcessEnv = process.env): number {
  return Number(env.E2E_HTTPS_PORT ?? port + E2E_HTTPS_PORT_OFFSET);
}

export function e2eApiPlugin(): Plugin {
  return {
    name: 'gameagenda:e2e-api',
    apply: (_config, env) => env.mode === 'e2e',
    async configurePreviewServer(server) {
      // La ruta no es literal para que el *bundler* de la configuración no la meta en ella.
      const href = new URL('./e2e-api-server.ts', import.meta.url).href;
      const { e2eApiMiddleware }: E2eApiServer = await import(/* @vite-ignore */ href);
      server.middlewares.use(e2eApiMiddleware());

      const host = '127.0.0.1';
      const port = e2eHttpsPort(server.config.preview.port ?? 4173);
      const mirror = createServer(selfSignedCertificate(), server.middlewares);
      mirror.listen(port, host);
      await once(mirror, 'listening');
      server.httpServer.once('close', () => mirror.close());
      server.config.logger.info(
        `  micro-API de los E2E en /api/* y /__e2e/*; espejo HTTPS en https://${host}:${port}/`,
      );
    },
  };
}
