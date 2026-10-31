// Recientes (§7.6): altas y renombrados de los últimos 14 días, con sus valores de hoy. El cliente
// los aplica siempre sobre su núcleo local, que renueva a los 7 días, así que cubren de sobra el
// hueco entre su núcleo y el de hoy.
//
// No hacen falta los núcleos de cada día: el estado (§4.6) ya trae los nombres de la versión
// anterior, y cada fila guarda el día de su alta (`addedOn`) y de su último cambio de nombre
// (`renamedOn`) mientras caigan en la ventana. Así, un juego renombrado dos veces en la ventana
// sigue en `recent`, aunque al final vuelva a su nombre de hace 14 días.

import { daysBetween } from './clock.ts';
import type { Game, StateRow } from './derive.ts';

/** Días que cubre `recent`, con el de hoy: un núcleo local de hasta 13 días antes. */
export const RECENT_DAYS = 14;

/** `true` si el día `on` (`AAAA-MM-DD`) cae en la ventana que acaba en `today`. */
export function inRecentWindow(on: string | undefined, today: string): on is string {
  if (!on) return false;
  const d = daysBetween(on, today);
  return d >= 0 && d < RECENT_DAYS;
}

/**
 * Marca las altas y los renombrados de hoy frente al estado (la versión anterior) y conserva los de
 * los días anteriores que siguen en la ventana. Sin estado (primera versión) no hay altas: todo es
 * núcleo. Un renombrado es un cambio de `name` o de `nameEs`, los dos nombres que se buscan (§8).
 */
export function markRecent(
  games: readonly Game[],
  state: ReadonlyMap<number, StateRow>,
  today: string,
): Game[] {
  const first = state.size === 0;
  return games.map((g) => {
    const s = state.get(g.appid);
    const { addedOn: _a, renamedOn: _r, ...rest } = g;
    const addedOn = s ? s.addedOn : first ? undefined : today;
    const renamed = s !== undefined && (s.name !== g.name || (s.nameEs ?? '') !== g.nameEs);
    const renamedOn = renamed ? today : s?.renamedOn;
    return {
      ...rest,
      ...(inRecentWindow(addedOn, today) ? { addedOn } : {}),
      ...(inRecentWindow(renamedOn, today) ? { renamedOn } : {}),
    };
  });
}

/** Juegos de `recent`, en el orden del núcleo (rango estático). */
export function recentGames(games: readonly Game[], today: string): Game[] {
  return games.filter(
    (g) => inRecentWindow(g.addedOn, today) || inRecentWindow(g.renamedOn, today),
  );
}
