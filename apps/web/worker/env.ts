// Lo que la micro-API usa del entorno de Workers, escrito a mano (ADR-011): son seis métodos de D1,
// el *binding* de límites y el de *assets*. Así las pruebas, en Node, implementan la misma interfaz
// sobre `node:sqlite` sin mezclar los tipos de `@cloudflare/workers-types` con los de Node. Las
// firmas siguen la API de Workers: https://developers.cloudflare.com/d1/worker-api/

export type D1Value = string | number | boolean | null | ArrayBuffer;

export interface D1Meta {
  changes: number;
  last_row_id: number;
  duration: number;
}

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: D1Meta;
}

export interface D1PreparedStatement {
  bind(...values: D1Value[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  /** En serie y de forma atómica: si falla una sentencia, no queda ninguna (§7.7). */
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

/** *Binding* `ratelimits` (§11.4): aproximado y por ubicación de Cloudflare. */
export interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  DB: D1Database;
  /** Los ficheros de la SPA (`assets.binding` en `wrangler.jsonc`). */
  ASSETS: Fetcher;
  /** Crear agenda, por IP. */
  RL_AGENDA: RateLimit;
  /** Canjear un código de emparejamiento o de recuperación, por IP. */
  RL_REDEEM: RateLimit;
  /** `'1'` activa la micro-API; con otro valor responde 503 (CA4.7: no antes de los textos legales). */
  SYNC_ENABLED: string;
  /** Edad mínima que se declara al activar la sincronización (14; R-10). */
  MIN_AGE: string;
}

export interface DeviceAuth {
  deviceId: string;
  agendaId: string;
}

/** Lo que se inyecta en las rutas: el reloj, para probar las caducidades. */
export interface Deps {
  now: () => number;
}

/** Tipos de Hono para la app: `c.env` y `c.var`. */
export interface AppEnv {
  Bindings: Env;
  Variables: { device: DeviceAuth };
}
