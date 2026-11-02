import { describe, expect, it } from 'vitest';
import { type ApplyResult, createUpdatePolicy } from './update-policy.ts';

const DELAY = 60_000;
const FIRST = 10_000;
const EVERY = 3_600_000;

/** Reloj y temporizadores a mano, visibilidad y lo que haya a medias. */
function harness(results: ApplyResult[] = ['reloading']) {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const listeners = new Set<() => void>();
  const state = { hidden: false, busy: false, applies: 0, checks: 0 };
  const policy = createUpdatePolicy(
    {
      isHidden: () => state.hidden,
      onVisibilityChange(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      isBusy: () => state.busy,
      apply() {
        state.applies++;
        return Promise.resolve(results.shift() ?? 'reloading');
      },
      check: () => void state.checks++,
      now: () => now,
      setTimer(callback, ms) {
        const id = nextId++;
        timers.set(id, { at: now + ms, callback });
        return id;
      },
      clearTimer: (id) => void timers.delete(id as number),
    },
    { hiddenDelayMs: DELAY, firstCheckMs: FIRST, checkEveryMs: EVERY },
  );
  return {
    policy,
    state,
    setHidden(hidden: boolean) {
      state.hidden = hidden;
      for (const listener of listeners) listener();
    },
    /** Avanza el reloj y dispara lo que toque, en orden. */
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].callback();
        await Promise.resolve();
        await Promise.resolve();
      }
      now = end;
    },
    listeners,
    timers,
  };
}

describe('createUpdatePolicy', () => {
  it('con una versión nueva esperando, la pone tras 1 minuto oculta', async () => {
    const h = harness();
    h.policy.pending();
    h.setHidden(true);
    await h.advance(DELAY - 1);
    expect(h.state.applies).toBe(0);
    await h.advance(1);
    expect(h.state.applies).toBe(1);
  });

  it('a la vista no hace nada, y volver a la vista antes de tiempo empieza la cuenta de cero', async () => {
    const h = harness();
    h.policy.pending();
    await h.advance(10 * DELAY);
    expect(h.state.applies).toBe(0);
    h.setHidden(true);
    await h.advance(DELAY / 2);
    h.setHidden(false);
    h.setHidden(true);
    await h.advance(DELAY / 2);
    expect(h.state.applies).toBe(0);
    await h.advance(DELAY / 2);
    expect(h.state.applies).toBe(1);
  });

  it('si la versión llega con la página ya oculta, también cuenta desde entonces', async () => {
    const h = harness();
    h.setHidden(true);
    await h.advance(5 * DELAY);
    h.policy.pending();
    await h.advance(DELAY);
    expect(h.state.applies).toBe(1);
  });

  it('con algo a medias espera, y lo vuelve a mirar cada minuto', async () => {
    const h = harness();
    h.state.busy = true;
    h.policy.pending();
    h.setHidden(true);
    await h.advance(3 * DELAY);
    expect(h.state.applies).toBe(0);
    h.state.busy = false;
    await h.advance(DELAY);
    expect(h.state.applies).toBe(1);
  });

  it('si no ha podido (otra ventana a la vista), lo reintenta; si no había nada, se olvida', async () => {
    const h = harness(['retry', 'nothing']);
    h.policy.pending();
    h.setHidden(true);
    await h.advance(DELAY);
    expect(h.state.applies).toBe(1);
    await h.advance(DELAY);
    expect(h.state.applies).toBe(2);
    await h.advance(10 * DELAY);
    expect(h.state.applies).toBe(2);
  });

  it('sin versión nueva no recarga nunca', async () => {
    const h = harness();
    h.setHidden(true);
    await h.advance(3 * EVERY);
    expect(h.state.applies).toBe(0);
  });

  it('mira si hay versión nueva a los 10 s de arrancar, luego cada hora, y al ocultarse si hace más de una hora', async () => {
    const h = harness();
    await h.advance(FIRST - 1);
    expect(h.state.checks).toBe(0);
    await h.advance(1);
    expect(h.state.checks).toBe(1);
    await h.advance(EVERY - 1);
    expect(h.state.checks).toBe(1);
    await h.advance(1);
    expect(h.state.checks).toBe(2);
    // Ocultarse a la media hora de mirar no vuelve a mirar.
    await h.advance(EVERY / 2);
    h.setHidden(true);
    expect(h.state.checks).toBe(2);
    h.setHidden(false);
    await h.advance(EVERY / 2 - 1);
    expect(h.state.checks).toBe(2);
    // Más de una hora sin mirar (el temporizador se ha retrasado, como en una pestaña oculta).
    h.timers.clear();
    await h.advance(EVERY);
    h.setHidden(true);
    expect(h.state.checks).toBe(3);
    // Y la cuenta de la hora vuelve a empezar desde ahí.
    await h.advance(EVERY - 1);
    expect(h.state.checks).toBe(3);
    await h.advance(1);
    expect(h.state.checks).toBe(4);
  });

  it('dispose quita el oyente y los temporizadores', () => {
    const h = harness();
    h.policy.pending();
    h.setHidden(true);
    h.policy.dispose();
    expect(h.listeners.size).toBe(0);
    expect(h.timers.size).toBe(0);
  });
});
