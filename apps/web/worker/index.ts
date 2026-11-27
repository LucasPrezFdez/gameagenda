// Punto de entrada del Worker `ga-web` (`main` en `wrangler.jsonc`): la micro-API y los dos Cron
// Triggers de `triggers.crons`: el mantenimiento diario de D1 y, cada 5 min, la purga de los
// tickets de Steam caducados (ADR-012).

import { createApp } from './app.ts';
import type { Env, ExecutionContext, ScheduledController } from './env.ts';
import { purgeSteamTickets, runMaintenance, STEAM_PURGE_CRON } from './maintenance.ts';
import { warmUp } from './warm-up.ts';

const app = createApp();
// Al arrancar el *isolate*, no en su primera petición (CA4.6; DECISIONES §10.60).
warmUp(app);

export default {
  fetch: app.fetch,
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    const task = controller.cron === STEAM_PURGE_CRON ? purgeSteamTickets : runMaintenance;
    ctx.waitUntil(task(env.DB, controller.scheduledTime));
  },
};
