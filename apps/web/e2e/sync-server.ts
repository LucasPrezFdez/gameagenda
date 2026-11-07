// Ayudantes de los E2E de sincronización (M4: CA4.2, CA4.3 y CA4.7). La vista previa del modo
// `e2e` sirve la micro-API real en `/api/*` y unas rutas de apoyo en `/__e2e/*` (ver
// `e2e-api-plugin.ts` y `e2e-api-server.ts`). Con el `test` de aquí, cada prueba tiene su mundo:
// una D1 y un reloj propios, que comparten todos sus contextos (sus «dispositivos»).
//
// Origen: las *cookies* de la micro-API son `__Host-`, con `Secure`. Chromium las trata igual por
// `http://127.0.0.1` (lo considera seguro), así que va por la vista previa de siempre. El WebKit de
// Playwright las guarda por HTTP, pero ni las envía ni las deja leer en `document.cookie`, así que
// va por el espejo HTTPS (`https://127.0.0.1:<puerto + 10 000>`, certificado autofirmado y
// `ignoreHTTPSErrors`). En Chromium no vale el espejo: con un certificado no válido no registra el
// Service Worker (comprobado el 07-11-2026).
import { randomUUID } from 'node:crypto';
import { DEFAULT_MIN_AGE, DEVICE_COOKIE, SYNC_HINT_COOKIE } from '@gameagenda/core/api';
import { formatHlc, type JsonValue, type Op } from '@gameagenda/core/sync';
import {
  type APIRequestContext,
  type BrowserContext,
  test as base,
  type Cookie,
  expect,
  type Page,
} from '@playwright/test';
import { v7 as uuidv7 } from 'uuid';
import { E2E_API_COOKIE, e2eHttpsPort } from '../e2e-api-plugin.ts';
import type { E2eAgendaReport, E2eState } from '../e2e-api-server.ts';

export type { E2eAgendaReport, E2eState };

export const DEVICE_COOKIE_NAME = `__Host-${DEVICE_COOKIE}`;
export const SYNC_HINT_COOKIE_NAME = `__Host-${SYNC_HINT_COOKIE}`;

/** El espejo HTTPS de la vista previa que escucha en `baseURL`. */
export function httpsMirror(baseURL: string): string {
  const url = new URL(baseURL);
  return `https://${url.hostname}:${e2eHttpsPort(Number(url.port))}`;
}

/** Mete el contexto en el mundo `world`: la *cookie* que lee la vista previa (y no la app). */
export async function joinWorld(context: BrowserContext, world: string, baseURL: string) {
  await context.addCookies([
    { name: E2E_API_COOKIE, value: world, url: baseURL, httpOnly: true, sameSite: 'Lax' },
  ]);
}

export interface SyncFixtures {
  /** El mundo de la prueba en la vista previa: su D1 y su reloj. */
  syncWorld: string;
  /**
   * Otro dispositivo: un contexto nuevo, con las opciones del proyecto (WebKit, el iPhone 15) y
   * en el mismo mundo. Se cierra al acabar la prueba.
   */
  newDevice: () => Promise<Page>;
}

export const test = base.extend<SyncFixtures>({
  baseURL: async ({ baseURL, browserName }, use) => {
    await use(browserName === 'webkit' && baseURL !== undefined ? httpsMirror(baseURL) : baseURL);
  },
  ignoreHTTPSErrors: async ({ browserName }, use) => {
    await use(browserName === 'webkit');
  },
  // biome-ignore lint/correctness/noEmptyPattern: Playwright exige desestructurar los fixtures.
  syncWorld: async ({}, use) => {
    await use(randomUUID());
  },
  context: async ({ context, syncWorld, baseURL }, use) => {
    await joinWorld(context, syncWorld, baseURL ?? '');
    await use(context);
  },
  newDevice: async ({ browser, syncWorld, baseURL }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async () => {
      const context = await browser.newContext();
      contexts.push(context);
      await joinWorld(context, syncWorld, baseURL ?? '');
      return context.newPage();
    });
    for (const context of contexts) await context.close();
  },
});

export { expect };

// --- La micro-API, desde la página (con sus *cookies*, su `Origin` y su CSP) ---

export interface PageApiResponse<T> {
  status: number;
  json: T;
  headers: Record<string, string>;
}

/**
 * Una petición a la micro-API con `fetch()` desde la página, como la haría la app: POST con JSON
 * (`{}` si no hay cuerpo), y el navegador pone el `Origin` y las *cookies*. La página tiene que
 * estar ya en la app. Ojo: Chromium y WebKit anotan en la consola cada 4xx o 5xx («Failed to load
 * resource: the server responded with a status of 401»), y `setup().expectClean()` los cuenta
 * como errores (comprobado el 07-11-2026).
 */
export async function callApi<T = unknown>(
  page: Page,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<PageApiResponse<T>> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const init: RequestInit = { method };
      if (method !== 'GET') {
        init.headers = { 'Content-Type': 'application/json' };
        init.body = JSON.stringify(body ?? {});
      }
      const response = await fetch(path, init);
      const text = await response.text();
      let json: unknown = null;
      try {
        json = text === '' ? null : JSON.parse(text);
      } catch {
        json = text;
      }
      return {
        status: response.status,
        json: json as T,
        headers: Object.fromEntries(response.headers),
      };
    },
    { method, path, body },
  );
}

/** Activa la sincronización desde la página, con la declaración de edad que pide el servidor. */
export async function createAgendaFromPage(page: Page, label = 'Navegador de prueba') {
  const response = await callApi<{ deviceId: string; recoveryCode: string }>(
    page,
    'POST',
    '/api/v1/agenda',
    { ageConfirmed: true, minAge: DEFAULT_MIN_AGE, label },
  );
  expect(response.status, 'POST /api/v1/agenda').toBe(201);
  return response.json;
}

/** Las *cookies* de la micro-API que guarda el contexto, por nombre. */
export async function deviceCookies(context: BrowserContext): Promise<Cookie[]> {
  return (await context.cookies())
    .filter((c) => c.name === DEVICE_COOKIE_NAME || c.name === SYNC_HINT_COOKIE_NAME)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Lo que ve la app en `document.cookie`: el indicio `__Host-ga_sync=1`, o nada. */
export async function pageCookies(page: Page): Promise<string> {
  return page.evaluate(() => document.cookie);
}

/** Operaciones de ejemplo, válidas para `POST /api/v1/sync` (todas con la misma HLC). */
export function exampleOps(
  entryId: string,
  fields: Readonly<Record<string, JsonValue>>,
  ms = Date.now(),
  node = 'e2e0e2e0',
): Op[] {
  const hlc = formatHlc({ ms, counter: 0, node });
  return Object.entries(fields).map(([field, value]) => ({
    opId: uuidv7(),
    entryId,
    field,
    value,
    hlc,
  }));
}

// --- Rutas de apoyo `/__e2e/*`, del mundo del contexto (vale una `Page` o un `BrowserContext`) ---

type WithRequest = { readonly request: APIRequestContext };

async function e2eJson<T>(
  target: WithRequest,
  method: 'GET' | 'POST',
  path: string,
  data?: object,
) {
  const response =
    method === 'GET'
      ? await target.request.get(path)
      : await target.request.post(path, { data: data ?? {} });
  return { status: response.status(), json: (await response.json()) as T };
}

async function e2eOk<T>(target: WithRequest, method: 'GET' | 'POST', path: string, data?: object) {
  const { status, json } = await e2eJson<T>(target, method, path, data);
  expect(status, `${method} ${path}: ${JSON.stringify(json)}`).toBe(200);
  return json;
}

/** El mundo, la hora de su micro-API, el interruptor y la edad que pide. */
export function serverState(target: WithRequest): Promise<E2eState> {
  return e2eOk<E2eState>(target, 'GET', '/__e2e/state');
}

/** Mueve el reloj de la micro-API del mundo (caducidad de los códigos, desfase de la HLC). */
export function moveServerClock(
  target: WithRequest,
  move: { advanceMs: number } | { offsetMs: number },
): Promise<E2eState> {
  return e2eOk<E2eState>(target, 'POST', '/__e2e/clock', move);
}

/** El interruptor (`SYNC_ENABLED`) y la edad que pide el servidor (`MIN_AGE`). */
export function configureServer(
  target: WithRequest,
  config: { syncEnabled?: boolean; minAge?: number },
): Promise<E2eState> {
  return e2eOk<E2eState>(target, 'POST', '/__e2e/config', config);
}

/**
 * El mantenimiento diario de D1, por defecto en el primer lunes a las 03:17 UTC desde ahora más
 * `afterDays` días (con la purga semanal); con `monday: false`, en ese instante. No mueve el reloj.
 */
export function runServerMaintenance(
  target: WithRequest,
  options: { afterDays?: number; at?: string; monday?: boolean } = {},
): Promise<{ ranAt: string }> {
  return e2eOk<{ ranAt: string }>(target, 'POST', '/__e2e/maintenance', options);
}

/**
 * La agenda de un dispositivo (o por su id) en D1, o `null` si no la encuentra. Tras «Borrar
 * todos mis datos» el dispositivo ya no existe: hay que buscarla por `agenda`.
 */
export async function serverAgenda(
  target: WithRequest,
  key: { device: string } | { agenda: string },
  options: { entries?: boolean } = {},
): Promise<E2eAgendaReport | null> {
  const params = new URLSearchParams(
    'device' in key ? { device: key.device } : { agenda: key.agenda },
  );
  if (options.entries) params.set('entries', '1');
  const { status, json } = await e2eJson<E2eAgendaReport>(target, 'GET', `/__e2e/agenda?${params}`);
  if (status === 404) return null;
  expect(status, `GET /__e2e/agenda: ${JSON.stringify(json)}`).toBe(200);
  return json;
}
