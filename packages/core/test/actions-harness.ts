// Reloj y contexto de acciones para las pruebas.

import type { ActionContext, AddContext, Entry } from '../src/entries/index.ts';
import { hlc, TODAY, uuids } from './helpers.ts';

export function harness(startMs = 1_793_178_900_000) {
  let ms = startMs;
  const newOpId = uuids(7);
  const ctx = (today = TODAY): ActionContext => ({ hlc: hlc(ms++), today, newOpId });
  const addCtx = (lastRank: string | null = null, today = TODAY): AddContext => ({
    ...ctx(today),
    lastRank,
  });
  return { ctx, addCtx, newOpId };
}

/** Valores visibles de una entrada: sin HLC y con solo las marcas activas. */
export function values(e: Entry | undefined) {
  if (e === undefined) return undefined;
  const { hlc: _h, lastHlc: _l, flags, ...rest } = e;
  const active = Object.fromEntries(Object.entries(flags).filter(([, v]) => v));
  return { ...rest, flags: active };
}
