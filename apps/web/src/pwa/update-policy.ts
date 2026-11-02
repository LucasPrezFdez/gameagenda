// Cuándo entra una versión nueva de la app (§5.2; DECISIONES §10.29). El Service Worker nuevo se
// instala solo y espera; la página le pide que tome el relevo y recarga cuando no se nota: tras un
// rato oculta (una pestaña en segundo plano, o la app de escritorio en la bandeja) y sin nada a
// medias. Además mira si hay versión nueva al poco de arrancar y luego cada hora: la app de
// escritorio puede pasar días sin recargar, y su navegador no lo miraba solo al abrirla (DECISIONES
// §10.29).

/** Oculta al menos este tiempo antes de recargar: un aviso con Deshacer dura 8 s. */
export const HIDDEN_DELAY_MS = 60_000;
/** La primera vez que se mira si hay versión nueva: pasado lo más pesado del arranque. */
export const FIRST_CHECK_MS = 10_000;
/** Y luego, cada cuánto. */
export const CHECK_EVERY_MS = 60 * 60_000;

/** `retry`: no ha podido (otra ventana de la app a la vista); se vuelve a intentar más tarde. */
export type ApplyResult = 'reloading' | 'nothing' | 'retry';

export interface UpdatePolicyDeps {
  isHidden(): boolean;
  onVisibilityChange(listener: () => void): () => void;
  /** Hay algo a medias que una recarga perdería o que se notaría. */
  isBusy(): boolean;
  /** Pone la versión nueva y recarga. */
  apply(): Promise<ApplyResult>;
  /** Pide al navegador que mire si hay una versión nueva (sin esperar la respuesta). */
  check(): void;
  now(): number;
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(timer: unknown): void;
}

export interface UpdatePolicyOptions {
  readonly hiddenDelayMs?: number;
  readonly firstCheckMs?: number;
  readonly checkEveryMs?: number;
}

export interface UpdatePolicy {
  /** Hay una versión nueva esperando, o la página ya va con otra: entra en cuanto no se note. */
  pending(): void;
  dispose(): void;
}

export function createUpdatePolicy(
  deps: UpdatePolicyDeps,
  options: UpdatePolicyOptions = {},
): UpdatePolicy {
  const hiddenDelayMs = options.hiddenDelayMs ?? HIDDEN_DELAY_MS;
  const firstCheckMs = options.firstCheckMs ?? FIRST_CHECK_MS;
  const checkEveryMs = options.checkEveryMs ?? CHECK_EVERY_MS;
  let pending = false;
  let applying = false;
  let applyTimer: unknown = null;
  let checkTimer: unknown = null;
  let lastCheck = deps.now();

  function stopApplyTimer(): void {
    if (applyTimer === null) return;
    deps.clearTimer(applyTimer);
    applyTimer = null;
  }

  /** Cuenta de nuevo desde ahora; solo mientras la página está oculta. */
  function arm(): void {
    stopApplyTimer();
    if (pending && !applying && deps.isHidden()) applyTimer = deps.setTimer(fire, hiddenDelayMs);
  }

  function fire(): void {
    applyTimer = null;
    if (!pending || applying || !deps.isHidden()) return;
    if (deps.isBusy()) {
      arm();
      return;
    }
    applying = true;
    deps.apply().then(
      (result) => {
        applying = false;
        if (result === 'retry') arm();
        else pending = false;
      },
      () => {
        applying = false;
        arm();
      },
    );
  }

  function scheduleCheck(ms: number): void {
    if (checkTimer !== null) deps.clearTimer(checkTimer);
    checkTimer = deps.setTimer(check, ms);
  }

  function check(): void {
    lastCheck = deps.now();
    deps.check();
    scheduleCheck(checkEveryMs);
  }

  scheduleCheck(firstCheckMs);
  const unsubscribe = deps.onVisibilityChange(() => {
    // Al ocultarse, si hace rato que no se mira: así la versión nueva ya está lista al volver.
    if (deps.isHidden() && deps.now() - lastCheck >= checkEveryMs) check();
    arm();
  });

  return {
    pending() {
      pending = true;
      arm();
    },
    dispose() {
      unsubscribe();
      stopApplyTimer();
      if (checkTimer !== null) deps.clearTimer(checkTimer);
      checkTimer = null;
    },
  };
}
