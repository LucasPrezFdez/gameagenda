// Preparar la micro-API al arrancar el *isolate* (CA4.6; DECISIONES §10.60). La primera petición
// de cada *isolate* pagaba montar el *router* de Hono y preparar los esquemas de Zod: en local,
// 7,5 ms frente a 1,0 ms de la segunda; en producción, de 9 a 16 ms
// (`docs/medidas/ca4.6-20261127-produccion.md`). Hecho en el ámbito global, ese trabajo cuenta como
// arranque, que tiene su propio límite (1 s) y su propia cifra en la analítica
// (`startupCpuTimeUs`), y no como CPU de la petición.
//
// Solo código sin E/S: en el ámbito global, `workerd` no deja hacer `fetch`, poner temporizadores
// ni generar números aleatorios. Por eso no se lanzan peticiones de mentira (en local habrían
// dejado la primera en 2,7 ms, pero leen cuerpos y crean respuestas).

import {
  API_BASE,
  accountCreateRequestSchema,
  accountLoginRequestSchema,
  createAgendaRequestSchema,
  deleteAgendaRequestSchema,
  emptyRequestSchema,
  inboxRequestSchema,
  inboxTokenRequestSchema,
  loginDetailsRequestSchema,
  passkeyCreateRequestSchema,
  passkeyRedeemRequestSchema,
  redeemRequestSchema,
  steamAchievementsRequestSchema,
  steamItemsResponseSchema,
  steamRedeemRequestSchema,
  steamStartRequestSchema,
  steamTypesRequestSchema,
  syncRequestSchema,
} from '@gameagenda/core/api';
import { strictOpSchema } from '@gameagenda/core/schemas';
import type { Hono } from 'hono';
import type { AppEnv } from './env.ts';
import type { Schema } from './http.ts';

/**
 * Los esquemas con los que la micro-API valida lo que le llega (`parseBody` y los `safeParse`
 * directos). `test/warm-up.test.ts` comprueba que no falta ninguno.
 */
export const WARM_SCHEMAS: readonly Schema<unknown>[] = [
  accountCreateRequestSchema,
  accountLoginRequestSchema,
  createAgendaRequestSchema,
  deleteAgendaRequestSchema,
  emptyRequestSchema,
  inboxRequestSchema,
  inboxTokenRequestSchema,
  loginDetailsRequestSchema,
  passkeyCreateRequestSchema,
  passkeyRedeemRequestSchema,
  redeemRequestSchema,
  steamAchievementsRequestSchema,
  steamItemsResponseSchema,
  steamRedeemRequestSchema,
  steamStartRequestSchema,
  steamTypesRequestSchema,
  strictOpSchema,
  syncRequestSchema,
];

/** Monta el *router* y prepara los esquemas. Se llama una vez, al cargar `index.ts`. */
export function warmUp(app: Hono<AppEnv>): void {
  // El primer `match` monta el *router* entero (SmartRouter elige y compila el RegExpRouter con
  // todas las rutas); las siguientes peticiones ya lo encuentran hecho.
  app.router.match('POST', `${API_BASE}/sync`);
  // Zod prepara cada objeto la primera vez que valida. Con `{}` falla, pero queda preparado.
  for (const schema of WARM_SCHEMAS) schema.safeParse({});
}
