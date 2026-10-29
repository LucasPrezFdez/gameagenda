// Reloj, espera y azar reales (las pruebas inyectan los suyos) y fechas en Europe/Madrid.

export interface Runtime {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly random: () => number;
}

export const realRuntime: Runtime = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: () => Math.random(),
};

const MADRID = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Madrid',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Fecha `AAAA-MM-DD` en Europe/Madrid (la del cron de la §4.5). */
export function madridDate(ms: number): string {
  return MADRID.format(new Date(ms));
}

/** ISO 8601 en UTC sin milisegundos (`generatedAt` del *manifest*). */
export function isoSeconds(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');
}
