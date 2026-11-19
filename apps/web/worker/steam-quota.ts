// Tope diario de llamadas a Steam de la importación (§11.1 de prototipe.md; ADR-012): los ToU de la
// Steam Web API admiten 100 000 al día en total, con clave o sin ella, y el *pipeline* gasta ≈220.
// Los `ratelimits` de Workers solo cuentan periodos de 10 o 60 s, así que el día lo cuenta D1, en
// `steam_quota`: el día UTC y las llamadas, sin nada de quién las hace. `callback` suma 1
// (`check_authentication`) y `redeem`, 2 (`GetOwnedGames` y `GetWishlist`).

import type { D1Database } from './env.ts';
import { utcDay } from './maintenance.ts';

/** La mitad de los ToU: el resto queda para el *pipeline* y para lo que venga (los logros). */
export const STEAM_DAILY_CALLS = 50_000;

/**
 * Apunta `calls` llamadas en el día de `nowMs` y dice si caben en el tope. Si no caben, no se
 * hacen; el contador ya las ha sumado, pero eso solo adelanta el «mañana».
 */
export async function spendSteamCalls(
  db: D1Database,
  nowMs: number,
  calls: number,
  cap: number,
): Promise<boolean> {
  const row = await db
    .prepare(
      `INSERT INTO steam_quota (day, calls) VALUES (?1, ?2)
       ON CONFLICT (day) DO UPDATE SET calls = calls + excluded.calls
       RETURNING calls`,
    )
    .bind(utcDay(nowMs), calls)
    .first<{ calls: number }>();
  return row !== null && row.calls <= cap;
}
