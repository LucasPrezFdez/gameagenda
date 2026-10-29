// Trabajo cooperativo: tareas largas partidas en trozos pequeños para que el Worker de búsqueda
// ceda el turno entre bloques (§8.8). El reloj se recibe como parámetro (§14.3).

/** Reloj monótono en milisegundos (en el Worker, `performance.now`). */
export type Clock = () => number;

/** Tarea que avanza a trozos: cada `step()` trabaja hasta su plazo y devuelve el control. */
export interface CooperativeTask<T> {
  /**
   * Trabaja hasta que el reloj llega a `deadline` (en ms del mismo reloj) o hasta acabar; un
   * bloque se pasa del plazo como mucho un trozo (≪1 ms). Devuelve `true` al terminar.
   */
  step(deadline: number): boolean;
  /** Fracción del trabajo hecha, de 0 a 1. */
  readonly progress: number;
  /** El resultado, o `null` mientras no ha terminado. */
  readonly result: T | null;
}

/** Trabajo interno: un generador que cede (`yield`) entre trozos e informa de su avance. */
export interface Work<T> {
  readonly gen: Generator<void, T, void>;
  readonly progress: () => number;
}

/** Envuelve un generador en una tarea cooperativa con el reloj dado. */
export function cooperate<T>(work: Work<T>, now: Clock): CooperativeTask<T> {
  let result: T | null = null;
  // Al terminar se suelta el generador: lo que solo hacía falta para construir se puede liberar.
  let pending: Work<T> | null = work;
  return {
    step(deadline: number): boolean {
      while (pending) {
        const r = pending.gen.next();
        if (r.done) {
          result = r.value;
          pending = null;
          break;
        }
        if (now() >= deadline) break;
      }
      return pending === null;
    },
    get progress() {
      return pending ? Math.min(1, Math.max(0, pending.progress())) : 1;
    },
    get result() {
      return result;
    },
  };
}

/** Ejecuta una tarea cooperativa de una vez (pipeline y pruebas). */
export function runToEnd<T>(task: CooperativeTask<T>): T {
  while (!task.step(Number.POSITIVE_INFINITY)) {
    // sin plazo: step() solo vuelve al terminar
  }
  return task.result as T;
}
