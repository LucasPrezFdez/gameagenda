// Cliente HTTP de la micro-API (§5.2 y §11.4; ADR-011), en el mismo origen que la SPA: la cookie
// `__Host-ga_device` va sola (`credentials: 'same-origin'`). Todo lo que no es GET lleva
// `Content-Type: application/json` y un cuerpo JSON (`{}` en las rutas sin datos); el navegador
// pone `Origin`. Las respuestas pasan por los esquemas de `@gameagenda/core/api` (con Zod: este
// módulo solo va en el *chunk* diferido del motor). Los errores son `SyncError` con el código de la
// micro-API, `network` o `bad_response`.
import {
  API_BASE,
  API_ERRORS,
  type ApiErrorCode,
  type CreateAgendaResponse,
  createAgendaResponseSchema,
  type DevicesResponse,
  devicesResponseSchema,
  okResponseSchema,
  type PairingResponse,
  pairingResponseSchema,
  type RecoveryResponse,
  type RedeemResponse,
  recoveryResponseSchema,
  redeemResponseSchema,
  type SyncRequest,
  type SyncResponse,
  syncResponseSchema,
} from '@gameagenda/core/api';
import type { Op } from '@gameagenda/core/sync';
import { SyncError } from './types.ts';

/** Una petición que no contesta en este tiempo cuenta como fallo de red. */
export const REQUEST_TIMEOUT_MS = 30_000;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  /** `fetch` del navegador por defecto; las pruebas pasan uno que llama a la app de Hono. */
  readonly fetch?: FetchLike;
  /** Origen delante de `/api/v1` (`''`: el mismo origen). */
  readonly origin?: string;
  readonly timeoutMs?: number;
}

/** `POST /api/v1/sync` con las operaciones ya tipadas (el esquema de la petición las admite así). */
export interface SyncCall extends Omit<SyncRequest, 'ops'> {
  readonly ops: readonly Op[];
}

export interface SyncApi {
  createAgenda(input: { minAge: number; label: string }): Promise<CreateAgendaResponse>;
  redeemPairing(input: { code: string; label: string }): Promise<RedeemResponse>;
  redeemRecovery(input: { code: string; label: string }): Promise<RedeemResponse>;
  createPairing(): Promise<PairingResponse>;
  createRecovery(): Promise<RecoveryResponse>;
  devices(): Promise<DevicesResponse>;
  revokeDevice(id: string): Promise<void>;
  deleteAgenda(): Promise<void>;
  sync(request: SyncCall): Promise<SyncResponse>;
}

interface Schema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && Object.hasOwn(API_ERRORS, value);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export function createApiClient(options: ApiClientOptions = {}): SyncApi {
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const origin = options.origin ?? '';
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  async function call<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    schema: Schema<T>,
  ): Promise<T> {
    const init: RequestInit = {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      // Sin `Referer`: con la política del documento (`strict-origin-when-cross-origin`), una
      // petición al mismo origen llevaría la ruta y la consulta de la página (lo buscado, los
      // filtros, la ficha abierta), y la micro-API no lo necesita: valida `Origin` (§11.2).
      referrerPolicy: 'no-referrer',
      headers: method === 'POST' ? { 'Content-Type': 'application/json' } : {},
    };
    if (method === 'POST') init.body = JSON.stringify(body ?? {});
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      init.signal = AbortSignal.timeout(timeoutMs);
    }
    let response: Response;
    try {
      response = await doFetch(`${origin}${API_BASE}${path}`, init);
    } catch {
      throw new SyncError('network');
    }
    const json = await readJson(response);
    if (!response.ok) {
      const code = (json as { error?: unknown } | undefined)?.error;
      throw new SyncError(isApiErrorCode(code) ? code : 'bad_response', response.status);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new SyncError('bad_response', response.status);
    return parsed.data;
  }

  const post = <T>(path: string, body: unknown, schema: Schema<T>) =>
    call('POST', path, body, schema);

  return {
    createAgenda: ({ minAge, label }) =>
      post('/agenda', { ageConfirmed: true, minAge, label }, createAgendaResponseSchema),
    redeemPairing: (input) => post('/pairing/redeem', input, redeemResponseSchema),
    redeemRecovery: (input) => post('/recovery/redeem', input, redeemResponseSchema),
    createPairing: () => post('/pairing', {}, pairingResponseSchema),
    createRecovery: () => post('/recovery', {}, recoveryResponseSchema),
    devices: () => call('GET', '/devices', undefined, devicesResponseSchema),
    async revokeDevice(id) {
      await post(`/devices/${encodeURIComponent(id)}/revoke`, {}, okResponseSchema);
    },
    async deleteAgenda() {
      await post('/agenda/delete', { confirm: true }, okResponseSchema);
    },
    sync: (request) => post('/sync', request, syncResponseSchema),
  };
}
