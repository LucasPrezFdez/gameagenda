import { describe, expect, it } from 'vitest';
import {
  backoffDelay,
  createScheduler,
  DEFAULT_TIMINGS,
  type RoundOutcome,
  type SchedulerEnv,
  type SyncTrigger,
} from './scheduler.ts';

/** Navegador falso: eventos a mano y temporizadores que solo corren con `run()`. */
function fakeEnv() {
  const timers: Array<{ id: number; ms: number; fn: () => void }> = [];
  let nextId = 1;
  const doc = Object.assign(new EventTarget(), {
    visibilityState: 'visible' as DocumentVisibilityState,
  });
  const win = new EventTarget();
  const env: SchedulerEnv & { online: boolean; clock: number } = {
    window: win,
    document: doc,
    online: true,
    clock: 0,
    isOnline: () => env.online,
    now: () => env.clock,
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.push({ id, ms, fn });
      return id;
    },
    clearTimeout(handle) {
      const i = timers.findIndex((t) => t.id === handle);
      if (i >= 0) timers.splice(i, 1);
    },
    random: () => 0.5,
  };
  return {
    env,
    doc,
    timers,
    fire(type: string) {
      win.dispatchEvent(new Event(type));
    },
    visibility(state: DocumentVisibilityState) {
      doc.visibilityState = state;
      doc.dispatchEvent(new Event('visibilitychange'));
    },
    run() {
      for (const t of timers.splice(0)) t.fn();
    },
  };
}

function recorder(outcomes: RoundOutcome[] = []) {
  const triggers: SyncTrigger[] = [];
  const run = async (trigger: SyncTrigger): Promise<RoundOutcome> => {
    triggers.push(trigger);
    return outcomes.shift() ?? { kind: 'ok', complete: true };
  };
  return { run, triggers };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('disparadores', () => {
  it('al empezar, con el foco, la red y al volver a la vista o al ocultarse', async () => {
    const f = fakeEnv();
    const r = recorder();
    const s = createScheduler(r.run, f.env);
    s.start();
    await s.idle();
    f.env.clock += 10_000;
    f.fire('focus');
    await s.idle();
    f.env.clock += 10_000;
    f.fire('online');
    await s.idle();
    f.env.clock += 10_000;
    f.visibility('hidden');
    await s.idle();
    f.env.clock += 10_000;
    f.visibility('visible');
    await s.idle();
    expect(r.triggers).toEqual(['start', 'focus', 'online', 'hidden', 'visible']);
    s.stop();
    f.fire('focus');
    f.fire('online');
    await flush();
    expect(r.triggers).toHaveLength(5);
  });

  it('el foco no repite una ronda correcta recién hecha', async () => {
    const f = fakeEnv();
    const r = recorder();
    const s = createScheduler(r.run, f.env);
    s.start();
    await s.idle();
    f.fire('focus');
    f.env.clock += DEFAULT_TIMINGS.minGapMs - 1;
    f.fire('focus');
    await s.idle();
    expect(r.triggers).toEqual(['start']);
    f.env.clock += 1;
    f.fire('focus');
    await s.idle();
    expect(r.triggers).toEqual(['start', 'focus']);
  });

  it('unos 2 s después de la última escritura local, con un solo temporizador', async () => {
    const f = fakeEnv();
    const r = recorder();
    const s = createScheduler(r.run, f.env);
    s.start();
    await s.idle();
    s.localWrite();
    s.localWrite();
    s.localWrite();
    expect(f.timers.map((t) => t.ms)).toEqual([2000]);
    f.run();
    await s.idle();
    expect(r.triggers).toEqual(['start', 'local-write']);
  });

  it('sin temporizadores con la página oculta', async () => {
    const f = fakeEnv();
    const r = recorder([{ kind: 'ok', complete: true }, { kind: 'retry' }]);
    const s = createScheduler(r.run, f.env);
    s.start();
    await s.idle();
    s.localWrite();
    expect(f.timers).toHaveLength(1);
    // Al ocultarse, sube lo pendiente y quita la espera; el fallo no programa reintento.
    f.visibility('hidden');
    await s.idle();
    expect(r.triggers).toEqual(['start', 'hidden']);
    expect(f.timers).toEqual([]);
    s.localWrite();
    expect(f.timers).toEqual([]);
  });

  it('sin red no lo intenta (salvo «Reintentar ahora») y espera a online', async () => {
    const f = fakeEnv();
    const r = recorder();
    f.env.online = false;
    const s = createScheduler(r.run, f.env);
    s.start();
    f.fire('focus');
    s.localWrite();
    f.run();
    await s.idle();
    expect(r.triggers).toEqual([]);
    await s.syncNow();
    expect(r.triggers).toEqual(['manual']);
    f.env.online = true;
    f.fire('online');
    await s.idle();
    expect(r.triggers).toEqual(['manual', 'online']);
  });

  it('un disparador durante una ronda hace otra al acabar, no dos a la vez', async () => {
    const f = fakeEnv();
    let release = () => {};
    let active = 0;
    let max = 0;
    const triggers: SyncTrigger[] = [];
    const s = createScheduler(async (trigger) => {
      triggers.push(trigger);
      active += 1;
      max = Math.max(max, active);
      if (trigger === 'start') await new Promise<void>((resolve) => (release = resolve));
      active -= 1;
      return { kind: 'ok', complete: true };
    }, f.env);
    s.start();
    const now = s.syncNow();
    f.env.clock += 10_000;
    f.fire('online');
    release();
    await now;
    await s.idle();
    expect(max).toBe(1);
    expect(triggers).toEqual(['start', 'online']);
  });
});

describe('reintentos', () => {
  it('espera exponencial de 5 s a 5 min, con algo de azar', () => {
    const delays = [1, 2, 3, 4, 5, 6, 7, 8, 20].map((n) => backoffDelay(n, DEFAULT_TIMINGS, 0.5));
    expect(delays).toEqual([
      5000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000, 300_000,
    ]);
    expect(backoffDelay(1, DEFAULT_TIMINGS, 0)).toBe(4000);
    expect(backoffDelay(1, DEFAULT_TIMINGS, 0.999)).toBe(5998);
  });

  it('reintenta tras un fallo reintentable; online vuelve a empezar la cuenta', async () => {
    const f = fakeEnv();
    const r = recorder([
      { kind: 'ok', complete: true },
      { kind: 'retry' },
      { kind: 'retry' },
      { kind: 'retry' },
    ]);
    const s = createScheduler(r.run, f.env);
    s.start();
    await s.idle();
    await s.syncNow();
    expect(f.timers.map((t) => t.ms)).toEqual([5000]);
    f.run();
    await s.idle();
    expect(f.timers.map((t) => t.ms)).toEqual([10_000]);
    // Una escritura no pisa el reintento.
    s.localWrite();
    expect(f.timers.map((t) => t.ms)).toEqual([10_000]);
    f.fire('online');
    await s.idle();
    expect(f.timers.map((t) => t.ms)).toEqual([5000]);
    expect(r.triggers).toEqual(['start', 'manual', 'retry', 'online']);
  });

  it('sync_disabled y los 4xx no se reintentan solos; un 401 lo para todo', async () => {
    const f = fakeEnv();
    const r = recorder([{ kind: 'stop' }, { kind: 'unpaired' }]);
    const s = createScheduler(r.run, f.env);
    s.start();
    await s.idle();
    expect(f.timers).toEqual([]);
    await s.syncNow();
    f.env.clock += 10_000;
    f.fire('focus');
    f.fire('online');
    await flush();
    expect(r.triggers).toEqual(['start', 'manual']);
  });

  it('una ronda incompleta (tope de peticiones) sigue enseguida', async () => {
    const f = fakeEnv();
    const r = recorder([{ kind: 'ok', complete: false }]);
    const s = createScheduler(r.run, f.env);
    s.start();
    await s.idle();
    expect(f.timers.map((t) => t.ms)).toEqual([DEFAULT_TIMINGS.moreDelayMs]);
    f.run();
    await s.idle();
    expect(r.triggers).toEqual(['start', 'more']);
  });
});
