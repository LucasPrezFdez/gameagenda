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
  /** Dejar un enlace en el buzón (Atajo de iOS), por *token*. */
  RL_INBOX: RateLimit;
  /** `resolve` (nombre de un `appid` con `GetItems` de Steam), por IP. */
  RL_RESOLVE: RateLimit;
  /** Importar desde Steam (`start` y `redeem`), por IP (ADR-012). */
  RL_STEAM: RateLimit;
  /** Los lotes de logros de la importación (`achievements`), por IP. */
  RL_STEAM_ACH: RateLimit;
  /** Entrar con email y contraseña (`account/login`), por IP (ADR-014). */
  RL_LOGIN: RateLimit;
  /** `'1'` activa la micro-API; con otro valor responde 503 (CA4.7: no antes de los textos legales). */
  SYNC_ENABLED: string;
  /** Edad mínima que se declara al activar la sincronización (14; R-10). */
  MIN_AGE: string;
  /**
   * `'1'` activa la importación de Steam (`/api/v1/steam/*`); con otro valor, o sin
   * `STEAM_WEB_API_KEY`, responde 503 `steam_disabled` (ADR-012). Va aparte de `SYNC_ENABLED`.
   */
  STEAM_ENABLED: string;
  /**
   * Clave de la Steam Web API (secreto del Worker, `wrangler secret put`; en local, `.dev.vars`).
   * La usan `redeem` y `achievements`, en `x-webapi-key`, y de ella sale la clave del pase de la
   * importación (`steam-token.ts`). Nunca va en la URL, los registros ni el cliente.
   */
  STEAM_WEB_API_KEY?: string;
  /**
   * `'1'` activa las llaves de acceso (`/api/v1/passkeys/*`; ADR-013); con otro valor responden
   * 503 `passkeys_disabled`. Va aparte de `SYNC_ENABLED`, que lo apaga todo.
   */
  PASSKEYS_ENABLED: string;
  /**
   * `'1'` activa las cuentas con email y contraseña (`/api/v1/account/*`) y el vínculo con Steam
   * (`steam/link`, `refresh` y `unlink`; ADR-014). Con otro valor, o sin `ACCOUNT_PEPPER`,
   * responden 503 `accounts_disabled`. Va aparte de `SYNC_ENABLED`, que lo apaga todo.
   */
  ACCOUNTS_ENABLED: string;
  /**
   * Secreto del Worker (`wrangler secret put`; en local, `.dev.vars`): la clave de los HMAC del
   * email y de la contraseña (`account-crypto.ts`). Al menos 32 caracteres. Si se pierde o cambia,
   * nadie puede entrar con email (las llaves y los códigos siguen valiendo). Nunca va en el cliente.
   */
  ACCOUNT_PEPPER?: string;
}

export interface DeviceAuth {
  deviceId: string;
  agendaId: string;
  /** La credencial de la cookie, para renovarla al sincronizar. */
  token: string;
  /** Instante ISO 8601 UTC: la cookie se renueva, como mucho, una vez al día (§11.4). */
  lastSeenAt: string;
}

/** Lo que pasa Cloudflare al *handler* `scheduled` (Cron Trigger). */
export interface ScheduledController {
  scheduledTime: number;
  cron: string;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

/** Lo que `resolve` usa para llamar a Steam: `fetch` (en las pruebas, uno falso). */
export type SteamFetch = (url: string, init: RequestInit) => Promise<Response>;

/** Lo que se inyecta en las rutas: el reloj, para probar las caducidades. */
export interface Deps {
  now: () => number;
  /** Por defecto, el `fetch` del entorno. */
  steamFetch?: SteamFetch;
  /** Cambios por página de `sync` (`SYNC_PAGE_SIZE`); las pruebas la bajan para paginar. */
  pageSize?: number;
  /** Tope diario de llamadas a Steam (`STEAM_DAILY_CALLS`); las pruebas lo bajan. */
  steamDailyCalls?: number;
  /** Tope de lo que pasa `redeem` (`STEAM_IMPORT_MAX_BYTES`); las pruebas lo bajan a 1 MiB. */
  steamImportMaxBytes?: number;
}

/** Tipos de Hono para la app: `c.env` y `c.var`. */
export interface AppEnv {
  Bindings: Env;
  Variables: { device: DeviceAuth };
}
