// Cuándo se sincroniza (RF-26: nunca pregunta). La §5.3 nombra foco, red y visibilidad; además:
// - al arrancar (la fachada carga el motor tras el primer pintado y en un rato ocioso);
// - al ocultarse la página, para subir lo pendiente antes de que el sistema la congele;
// - unos 2 s después de la última escritura local, para que el otro dispositivo lo vea pronto sin
//   una petición por pulsación.
// Sin red (`navigator.onLine === false`) no lo intenta: espera a `online`. Con la página oculta no
// hay temporizadores (ni la espera de 2 s ni los reintentos): al volver a la vista, sincroniza.
// Tras un fallo que se puede reintentar (429, 503 `busy`, 5xx, red con conexión, respuesta rara),
// espera de forma exponencial, de unos 5 s a unos 5 min, mientras la página esté visible; `online`
// vuelve a empezar la cuenta. `sync_disabled` y los demás 4xx no se reintentan en bucle.

export type SyncTrigger =
  | 'start'
  | 'focus'
  | 'online'
  | 'visible'
  | 'hidden'
  | 'local-write'
  | 'retry'
  | 'more'
  | 'manual';

/** Resultado de una ronda, según el que decide el siguiente paso. */
export type RoundOutcome =
  /** Correcta; `complete: false` si llegó al tope de peticiones con trabajo pendiente. */
  | { readonly kind: 'ok'; readonly complete: boolean }
  /**
   * No ha hecho nada: otra pestaña tenía el Web Lock (también al reintentar), y ella sube lo que
   * haya; o se ocultaba la página sin nada pendiente.
   */
  | { readonly kind: 'skipped' }
  /** Sin red: se espera a `online`. */
  | { readonly kind: 'offline' }
  /** Se reintenta con espera exponencial. */
  | { readonly kind: 'retry' }
  /** No se reintenta en bucle (`sync_disabled`, 4xx): solo con el siguiente disparador. */
  | { readonly kind: 'stop' }
  /** Desemparejado (401): no hay nada más que hacer. */
  | { readonly kind: 'unpaired' };

export interface SchedulerTimings {
  /** Espera tras la última escritura local. */
  readonly debounceMs: number;
  readonly backoffMinMs: number;
  readonly backoffMaxMs: number;
  /** Con la ronda incompleta (tope de peticiones), la siguiente. */
  readonly moreDelayMs: number;
  /** Foco y visibilidad no repiten una ronda correcta de hace menos de esto. */
  readonly minGapMs: number;
}

export const DEFAULT_TIMINGS: SchedulerTimings = {
  debounceMs: 2000,
  backoffMinMs: 5000,
  backoffMaxMs: 5 * 60_000,
  moreDelayMs: 1000,
  minGapMs: 3000,
};

/** Lo que el planificador necesita del navegador (inyectable en las pruebas). */
export interface SchedulerEnv {
  /** `window`: `focus` y `online`. */
  readonly window: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  /** `document`: `visibilitychange` y `visibilityState`. */
  readonly document: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> & {
    readonly visibilityState: DocumentVisibilityState;
  };
  isOnline(): boolean;
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /** En [0, 1): reparte los reintentos de varios dispositivos. */
  random(): number;
}

export interface Scheduler {
  /** Empieza a escuchar y sincroniza (`start`). */
  start(): void;
  /** Deja de escuchar y quita los temporizadores (la ronda en marcha acaba). */
  stop(): void;
  /** «Reintentar ahora» y los ganchos de E2E: una ronda ya, aunque haya otra pendiente. */
  syncNow(): Promise<void>;
  /** La agenda ha escrito en la `outbox`. */
  localWrite(): void;
  /** Se resuelve cuando no hay ronda en marcha. */
  idle(): Promise<void>;
}

/** Espera tras `failures` fallos seguidos: 5 s, 10 s, 20 s… hasta 5 min, con ±20 % de azar. */
export function backoffDelay(failures: number, timings: SchedulerTimings, random: number): number {
  const base = Math.min(
    timings.backoffMaxMs,
    timings.backoffMinMs * 2 ** Math.max(0, Math.min(failures - 1, 30)),
  );
  return Math.round(base * (0.8 + 0.4 * random));
}

export function createScheduler(
  run: (trigger: SyncTrigger) => Promise<RoundOutcome>,
  env: SchedulerEnv,
  timings: SchedulerTimings = DEFAULT_TIMINGS,
): Scheduler {
  let active = false;
  let running: Promise<void> | null = null;
  let again: SyncTrigger | null = null;
  let timer: unknown = null;
  let timerKind: 'debounce' | 'retry' | 'more' | null = null;
  let failures = 0;
  let lastOk = Number.NEGATIVE_INFINITY;
  let removers: Array<() => void> = [];

  const visible = () => env.document.visibilityState === 'visible';

  function clearTimer(): void {
    if (timer !== null) env.clearTimeout(timer);
    timer = null;
    timerKind = null;
  }

  function setTimer(kind: 'debounce' | 'retry' | 'more', ms: number, trigger: SyncTrigger): void {
    if (!active || !visible()) return;
    clearTimer();
    timerKind = kind;
    timer = env.setTimeout(() => {
      timer = null;
      timerKind = null;
      void kick(trigger);
    }, ms);
  }

  function after(outcome: RoundOutcome): void {
    switch (outcome.kind) {
      case 'ok':
        failures = 0;
        lastOk = env.now();
        if (!outcome.complete) setTimer('more', timings.moreDelayMs, 'more');
        return;
      case 'retry':
        failures += 1;
        setTimer('retry', backoffDelay(failures, timings, env.random()), 'retry');
        return;
      case 'offline':
      case 'stop':
      case 'skipped':
        return;
      case 'unpaired':
        stop();
        return;
    }
  }

  async function loop(first: SyncTrigger): Promise<void> {
    let trigger: SyncTrigger | null = first;
    while (trigger !== null && active) {
      again = null;
      // Una ronda nueva sustituye a la espera pendiente (de escritura, reintento o «más»).
      clearTimer();
      after(await run(trigger));
      trigger = again;
    }
  }

  function kick(trigger: SyncTrigger): Promise<void> {
    if (!active) return Promise.resolve();
    if (!env.isOnline() && trigger !== 'manual') return Promise.resolve();
    if (running !== null) {
      again = trigger;
      return running;
    }
    running = loop(trigger).finally(() => {
      running = null;
    });
    return running;
  }

  function soft(trigger: SyncTrigger): void {
    // Foco y visibilidad: sin repetir una ronda correcta recién hecha, ni pisar un reintento.
    if (env.now() - lastOk < timings.minGapMs || timerKind === 'retry') return;
    void kick(trigger);
  }

  function listen(target: SchedulerEnv['window'], type: string, fn: () => void): void {
    target.addEventListener(type, fn);
    removers.push(() => target.removeEventListener(type, fn));
  }

  function stop(): void {
    active = false;
    clearTimer();
    for (const remove of removers) remove();
    removers = [];
  }

  return {
    start() {
      if (active) return;
      active = true;
      listen(env.window, 'focus', () => soft('focus'));
      listen(env.window, 'online', () => {
        failures = 0;
        clearTimer();
        void kick('online');
      });
      listen(env.document, 'visibilitychange', () => {
        if (visible()) {
          soft('visible');
        } else {
          // Sin temporizadores con la página oculta; antes, sube lo pendiente.
          clearTimer();
          void kick('hidden');
        }
      });
      void kick('start');
    },
    stop,
    syncNow() {
      if (!active) return Promise.resolve();
      clearTimer();
      if (running !== null) {
        again = 'manual';
        return running;
      }
      return kick('manual');
    },
    localWrite() {
      if (timerKind === 'retry') return;
      setTimer('debounce', timings.debounceMs, 'local-write');
    },
    async idle() {
      while (running !== null) await running;
    },
  };
}
