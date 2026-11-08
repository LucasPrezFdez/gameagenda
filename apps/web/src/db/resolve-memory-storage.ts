// `meta.resolveAsked` (M4; CA4.5): a cuándo se preguntó a `resolve` por cada `appid` que no está en
// el catálogo, para no repetirlo en cada arranque (`catalog-refresh.ts` lo vuelve a preguntar a los
// 7 días). Es de este dispositivo: no va en la copia ni se sincroniza, y «Borrar todos mis datos» lo
// borra con el resto de `meta`. Se guarda en segundo plano; un fallo solo va al registro.
import type { ResolveMemory } from '../agenda/catalog-refresh.ts';
import { type GameAgendaDb, META_KEYS } from './database.ts';

/** Más que esto no se guarda (los más recientes): con un juego retirado por entrada, sobra. */
export const RESOLVE_MEMORY_MAX = 2000;

/** `meta.resolveAsked` (`{ "<appid>": ms }`) solo con lo que tiene la forma esperada. */
export function parseResolveAsked(value: unknown): Map<number, number> {
  const out = new Map<number, number>();
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return out;
  for (const [key, at] of Object.entries(value)) {
    if (!/^[1-9][0-9]{0,9}$/.test(key) || typeof at !== 'number' || !Number.isFinite(at)) continue;
    out.set(Number(key), at);
  }
  return out;
}

export function createDexieResolveMemory(
  db: GameAgendaDb,
  onError: (error: unknown) => void,
): ResolveMemory {
  let chain: Promise<void> = Promise.resolve();
  return {
    async load() {
      return parseResolveAsked((await db.meta.get(META_KEYS.resolveAsked))?.value);
    },
    save(asked) {
      const recent = [...asked].sort((a, b) => b[1] - a[1]).slice(0, RESOLVE_MEMORY_MAX);
      const value = Object.fromEntries(recent.map(([appid, at]) => [String(appid), at]));
      chain = chain
        .then(async () => {
          await db.meta.put({ key: META_KEYS.resolveAsked, value });
        })
        .catch(onError);
    },
  };
}
