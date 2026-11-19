// Micro-API de `ga-web` (§5.2; ADR-011): Hono en `/api/v1/*`, en el mismo origen que la SPA. El
// *script* solo corre en `/api/*` (`run_worker_first`); si llega otra petición (un fichero que no
// existe, por ejemplo), se la devuelve a los *assets*, que aplican el *fallback* de la SPA, salvo
// en `/assets/`, donde un fichero que no existe da 404.

import { API_BASE } from '@gameagenda/core/api';
import { Hono } from 'hono';
import type { AppEnv, Deps } from './env.ts';
import { apiError, apiHeaders, killSwitch, requestRules } from './http.ts';
import { agendaRoutes } from './routes/agenda.ts';
import { deviceRoutes } from './routes/devices.ts';
import { inboxRoutes } from './routes/inbox.ts';
import { pairingRoutes } from './routes/pairing.ts';
import { resolveRoutes } from './routes/resolve.ts';
import { steamRoutes } from './routes/steam.ts';
import { syncRoutes } from './routes/sync.ts';

export function createApp(deps: Deps = { now: Date.now }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('/api/*', apiHeaders, killSwitch, requestRules);

  const api = new Hono<AppEnv>();
  agendaRoutes(api, deps);
  deviceRoutes(api);
  pairingRoutes(api, deps);
  inboxRoutes(api, deps);
  resolveRoutes(api, deps);
  steamRoutes(api, deps);
  syncRoutes(api, deps);
  app.route(API_BASE, api);

  app.all('/api/*', (c) => apiError(c, 'not_found'));
  // Un fichero de `/assets/` que no existe (el *chunk* de una versión anterior, pedido por una
  // pestaña vieja) da 404 y no el `index.html` del *fallback*: servido como 200 en esa ruta,
  // `_headers` lo cacheaba un año como `immutable` (revisión del 16-11-2026). Vite no deja HTML en
  // `/assets/`, así que un HTML ahí solo puede ser el *fallback*.
  // OJO: en producción no llega aquí. Con `run_worker_first` en forma de lista, Static Assets no
  // mira `Sec-Fetch-Mode` y lo que no está en la lista recibe el *fallback* sin pasar por el Worker
  // (comprobado el 16-11-2026). Haría falta `/assets/*` en `run_worker_first`, y antes comprobar
  // que `_headers` sigue valiendo para lo que sirve `ASSETS.fetch()` (DECISIONES §10.47).
  app.all('/assets/*', async (c) => {
    const response = await c.env.ASSETS.fetch(c.req.raw);
    if (!response.headers.get('Content-Type')?.startsWith('text/html')) return response;
    return c.text('No encontrado', 404, { 'Cache-Control': 'no-store' });
  });
  app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

  // Sin cuerpos ni *tokens* en el registro (§11.4): solo el nombre del error y la ruta.
  app.onError((error, c) => {
    console.error(`micro-API: ${error.name} en ${c.req.method} ${c.req.path}`);
    return c.req.path.startsWith('/api/') ? apiError(c, 'internal') : c.text('Error interno', 500);
  });
  return app;
}
