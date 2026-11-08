// Micro-API de `ga-web` (§5.2; ADR-011): Hono en `/api/v1/*`, en el mismo origen que la SPA. El
// *script* solo corre en `/api/*` (`run_worker_first`); si llega otra petición (un fichero que no
// existe, por ejemplo), se la devuelve a los *assets*, que aplican el *fallback* de la SPA.

import { API_BASE } from '@gameagenda/core/api';
import { Hono } from 'hono';
import type { AppEnv, Deps } from './env.ts';
import { apiError, apiHeaders, killSwitch, requestRules } from './http.ts';
import { agendaRoutes } from './routes/agenda.ts';
import { deviceRoutes } from './routes/devices.ts';
import { inboxRoutes } from './routes/inbox.ts';
import { pairingRoutes } from './routes/pairing.ts';
import { resolveRoutes } from './routes/resolve.ts';
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
  syncRoutes(api, deps);
  app.route(API_BASE, api);

  app.all('/api/*', (c) => apiError(c, 'not_found'));
  app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

  // Sin cuerpos ni *tokens* en el registro (§11.4): solo el nombre del error y la ruta.
  app.onError((error, c) => {
    console.error(`micro-API: ${error.name} en ${c.req.method} ${c.req.path}`);
    return c.req.path.startsWith('/api/') ? apiError(c, 'internal') : c.text('Error interno', 500);
  });
  return app;
}
