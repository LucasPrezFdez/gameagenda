// Punto de entrada del Worker `ga-web` (`main` en `wrangler.jsonc`): la micro-API y el
// mantenimiento diario de D1 (`triggers.crons`).

import { createApp } from './app.ts';
import type { Env, ExecutionContext, ScheduledController } from './env.ts';
import { runMaintenance } from './maintenance.ts';

const app = createApp();

export default {
  fetch: app.fetch,
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(runMaintenance(env.DB, controller.scheduledTime));
  },
};
