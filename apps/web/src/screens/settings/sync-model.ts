// Ajustes › Sincronización (M4; §9.1, §9.6, §9.9 y §11.4): lo que la pantalla calcula sin React,
// para probarlo con Vitest. Va en el *chunk* diferido de Ajustes. De `@gameagenda/core/api` solo
// usa los códigos y las constantes, que no importan Zod (`api/constants.ts` y `api/codes.ts`).
import { CODE_GROUP, PAIRING_TTL_MS, parseCode } from '@gameagenda/core/api';
import { es } from '../../i18n/es.ts';
import { defaultDeviceLabel, LABEL_MAX } from '../../sync/device-label.ts';
import type { DeviceInfo, SyncErrorCode, SyncState } from '../../sync/types.ts';

/** Qué se ve en la sección, según el estado de la sincronización (sin el código recién creado). */
export type SyncView = 'loading' | 'off' | 'paired' | 'unpaired';

export function syncViewOf(state: SyncState): SyncView {
  if (!state.ready) return 'loading';
  if (state.status === 'off') return 'off';
  if (state.status === 'unpaired') return 'unpaired';
  // `restoring` también: la agenda está llegando y ya se puede emparejar otro dispositivo.
  return 'paired';
}

/**
 * La app de escritorio (Tauri 2; ADR-010) define `window.isTauri = true` en cada página que abre
 * (comprobado en `tauri` 2.12.5, `manager/webview.rs`). La web no le habla (CA3.8): solo lo mira
 * para proponer el nombre del dispositivo.
 */
export function isDesktopApp(scope: object = globalThis): boolean {
  return (scope as { isTauri?: unknown }).isTauri === true;
}

/** Nombre propuesto: «App de escritorio», o el navegador y el sistema («Chrome en Windows»). */
export function suggestedDeviceLabel(userAgent: string, desktop: boolean): string {
  return desktop ? es.syncPanel.desktopLabel : defaultDeviceLabel(userAgent);
}

const CONTROL = /\p{Cc}+/gu;

/**
 * El nombre tal como lo pide la micro-API (`deviceLabelSchema`): sin caracteres de control, sin
 * espacios a los lados y con `LABEL_MAX` (60) unidades UTF-16 como mucho, sin partir un emoji.
 * Vacío si no queda nada.
 */
export function cleanDeviceLabel(input: string): string {
  let out = '';
  for (const char of input.replace(CONTROL, ' ').trim()) {
    if (out.length + char.length > LABEL_MAX) break;
    out += char;
  }
  return out.trim();
}

/** Lo tecleado o pegado → código canónico (`parseCode` de core), o `null` si no lo es. */
export function readCode(input: string): string | null {
  return parseCode(input);
}

/** `XXXX-XXXX-…` (o sin guiones) → los grupos de 4 que se pintan separados. */
export function codeGroups(code: string): string[] {
  const compact = code.replace(/[\s-]/g, '');
  const groups: string[] = [];
  for (let i = 0; i < compact.length; i += CODE_GROUP)
    groups.push(compact.slice(i, i + CODE_GROUP));
  return groups;
}

/** Operaciones de la sección, para dar a cada error el texto que dice qué hacer (§9.9). */
export type SyncOperation =
  | 'activate'
  | 'pair'
  | 'recover'
  | 'createPairing'
  | 'createRecovery'
  | 'devices'
  | 'revoke'
  | 'leave';

export function syncErrorText(code: SyncErrorCode, operation: SyncOperation): string {
  const t = es.syncPanel.errors;
  switch (code) {
    case 'network':
      return t.network;
    case 'rate_limited':
      return t.rateLimited;
    case 'sync_disabled':
      return t.disabled;
    case 'age_policy_changed':
      return t.ageChanged;
    case 'already_paired':
      return t.alreadyPaired;
    case 'invalid_code':
      return operation === 'recover'
        ? t.invalidRecovery
        : t.invalidPairing(Math.round(PAIRING_TTL_MS / 60_000));
    case 'unauthorized':
      return t.unauthorized;
    case 'not_found':
      return operation === 'revoke' ? t.notFound : t.server;
    case 'storage':
      return t.storage;
    case 'unavailable':
      return t.unavailable;
    default:
      return t.server;
  }
}

/** Línea de estado de una agenda emparejada (o restaurándose), con `role="status"`. */
export interface StatusLine {
  readonly text: string;
  /** Para el icono y el color: al día, trabajando, sin conexión o con un problema. */
  readonly tone: 'ok' | 'busy' | 'offline' | 'problem';
}

export function statusLine(state: SyncState, now: number): StatusLine {
  const t = es.syncPanel;
  const restoring = state.status === 'restoring';
  switch (state.activity) {
    case 'syncing':
      return { text: restoring ? t.restoring : t.syncing, tone: 'busy' };
    case 'offline':
      return { text: restoring ? t.restoringOffline : t.offline, tone: 'offline' };
    case 'disabled':
      return { text: t.disabled, tone: 'problem' };
    case 'error':
      if (state.error === 'storage' || state.error === 'unavailable')
        return { text: t.failedStorage, tone: 'problem' };
      if (state.error === 'rate_limited' || state.error === 'busy')
        return { text: t.failedLater, tone: 'problem' };
      return { text: t.failed, tone: 'problem' };
    default:
      if (restoring) return { text: t.restoring, tone: 'busy' };
      return state.lastSyncAt === null
        ? { text: t.never, tone: 'ok' }
        : { text: t.synced(timeAgo(state.lastSyncAt, now)), tone: 'ok' };
  }
}

/** «1 juego con cambios sin sincronizar.», o `null` sin cambios pendientes. */
export function pendingText(pending: number): string | null {
  return pending > 0 ? es.syncPanel.pending(pending) : null;
}

const relative = new Intl.RelativeTimeFormat('es-ES', { numeric: 'auto' });

/** «hace un momento», «hace 5 minutos», «hace 2 horas», «ayer», «hace 3 días». */
export function timeAgo(then: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 60) return es.syncPanel.justNow;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return relative.format(-minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return relative.format(-hours, 'hour');
  return relative.format(-Math.floor(hours / 24), 'day');
}

const DAY_MS = 86_400_000;
const dayFormat = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const shortDayFormat = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
const clockFormat = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * «a las 18:42» o «el 3 nov a las 18:42»: la última sincronización para el lector de pantalla. No
 * cambia mientras no haya otra, así que la región `status` no anuncia cada minuto que pasa (lo que
 * se ve, «hace 5 minutos», sí avanza).
 */
export function syncedWhen(then: number, now: number): string {
  const time = clockFormat.format(then);
  return startOfLocalDay(then) === startOfLocalDay(now)
    ? es.syncPanel.atTime(time)
    : es.syncPanel.onDay(shortDayFormat.format(then), time);
}

/** «hoy», «ayer», «hace 3 días»: el servidor apunta la última vez como mucho una vez al día. */
export function dayAgo(then: number, now: number): string {
  const days = Math.max(0, Math.round((startOfLocalDay(now) - startOfLocalDay(then)) / DAY_MS));
  return relative.format(-days, 'day');
}

/** «Desde el 7 nov 2026 · Última vez: hoy» (fechas de la micro-API en ISO 8601 UTC). */
export function deviceDetails(device: DeviceInfo, now: number): string {
  const created = Date.parse(device.createdAt);
  const seen = Date.parse(device.lastSeenAt);
  const parts: string[] = [];
  if (Number.isFinite(created)) parts.push(es.syncPanel.deviceSince(dayFormat.format(created)));
  if (Number.isFinite(seen)) parts.push(es.syncPanel.deviceLastSeen(dayAgo(seen, now)));
  return parts.join(' · ');
}

/** Primero este dispositivo y después los demás, por fecha de alta (como los da el servidor). */
export function sortDevices(devices: readonly DeviceInfo[]): DeviceInfo[] {
  return [...devices].sort((a, b) => Number(b.current) - Number(a.current));
}

/** Lo que queda de un código de emparejamiento, en ms (0 si ya ha caducado o no se entiende). */
export function remainingMs(expiresAt: string, now: number): number {
  const end = Date.parse(expiresAt);
  return Number.isFinite(end) ? Math.max(0, end - now) : 0;
}

/** «9:41»: minutos y segundos que quedan, redondeando hacia arriba. */
export function formatCountdown(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** «18:52»: la hora local a la que caduca el código. */
export function formatClock(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? clockFormat.format(ms) : '';
}

/** Dispositivos de `after` que no estaban en `before` (el otro dispositivo ya ha canjeado). */
export function newDevices(
  before: ReadonlySet<string>,
  after: readonly DeviceInfo[],
): DeviceInfo[] {
  return after.filter((d) => !d.current && !before.has(d.id));
}
