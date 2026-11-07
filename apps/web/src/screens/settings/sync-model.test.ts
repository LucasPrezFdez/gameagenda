import { DEVICE_LABEL_MAX, deviceLabelSchema, formatCode } from '@gameagenda/core/api';
import { describe, expect, it } from 'vitest';
import type { DeviceInfo, SyncState } from '../../sync/types.ts';
import {
  cleanDeviceLabel,
  codeGroups,
  dayAgo,
  deviceDetails,
  formatCountdown,
  isDesktopApp,
  newDevices,
  pendingText,
  readCode,
  remainingMs,
  sortDevices,
  statusLine,
  suggestedDeviceLabel,
  syncErrorText,
  syncViewOf,
  timeAgo,
} from './sync-model.ts';

const CANONICAL = 'GXENQ32VABCDEFGHJKMNPQRSTVWX';

function state(patch: Partial<SyncState> = {}): SyncState {
  return {
    ready: true,
    status: 'paired',
    activity: 'idle',
    error: null,
    unpairedReason: null,
    deviceId: 'd1',
    pending: 0,
    lastSyncAt: null,
    ...patch,
  };
}

function device(patch: Partial<DeviceInfo>): DeviceInfo {
  return {
    id: 'd',
    kind: 'app',
    label: 'Chrome en Windows',
    createdAt: '2026-11-01T10:00:00.000Z',
    lastSeenAt: '2026-11-07T10:00:00.000Z',
    current: false,
    ...patch,
  };
}

describe('syncViewOf', () => {
  it('no pinta nada definitivo hasta leer el estado guardado', () => {
    expect(syncViewOf(state({ ready: false, status: 'paired' }))).toBe('loading');
    expect(syncViewOf(state({ ready: false, status: 'off' }))).toBe('loading');
  });

  it('cada estado tiene su vista; restaurar es estar emparejado', () => {
    expect(syncViewOf(state({ status: 'off' }))).toBe('off');
    expect(syncViewOf(state({ status: 'paired' }))).toBe('paired');
    expect(syncViewOf(state({ status: 'restoring' }))).toBe('paired');
    expect(syncViewOf(state({ status: 'unpaired', unpairedReason: 'cookies' }))).toBe('unpaired');
  });
});

describe('nombre del dispositivo', () => {
  const chrome =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
  const webview2 = `${chrome} Edg/142.0.0.0`;

  it('la app de escritorio se llama así; el navegador, por su nombre y su sistema', () => {
    expect(suggestedDeviceLabel(webview2, true)).toBe('App de escritorio');
    expect(suggestedDeviceLabel(webview2, false)).toBe('Edge en Windows');
    expect(suggestedDeviceLabel(chrome, false)).toBe('Chrome en Windows');
  });

  it('reconoce la app de escritorio por `isTauri` (Tauri 2), y nada más', () => {
    expect(isDesktopApp({ isTauri: true })).toBe(true);
    expect(isDesktopApp({ isTauri: 'true' })).toBe(false);
    expect(isDesktopApp({ __TAURI__: {} })).toBe(false);
    expect(isDesktopApp({})).toBe(false);
  });

  it('lo deja como lo pide la micro-API: sin controles, sin espacios a los lados, ≤60', () => {
    expect(cleanDeviceLabel('  Móvil\tde\nLucas  ')).toBe('Móvil de Lucas');
    expect(cleanDeviceLabel('   ')).toBe('');
    const long = 'x'.repeat(80);
    expect(cleanDeviceLabel(long)).toHaveLength(DEVICE_LABEL_MAX);
    // Un emoji en el límite no se parte en dos mitades sueltas.
    const emoji = `${'a'.repeat(59)}🎮`;
    expect(cleanDeviceLabel(emoji)).toBe('a'.repeat(59));
    for (const input of ['Chrome en Windows', long, emoji, ' \u0007PC\u001b ']) {
      expect(deviceLabelSchema.safeParse(cleanDeviceLabel(input)).success).toBe(true);
    }
  });
});

describe('códigos', () => {
  it('acepta minúsculas, espacios, guiones y O, I y L por 0 y 1', () => {
    expect(readCode(formatCode(CANONICAL))).toBe(CANONICAL);
    expect(readCode('gxen q32v abcd efgh jkmn pqrs tvwx')).toBe(CANONICAL);
    expect(readCode(' GXEN-Q32V-ABCD-EFGH-JKMN-PQRS-TVWX ')).toBe(CANONICAL);
    expect(readCode('OOOO-IIII-LLLL-0000-1111-2222-3333')).toBe('0000111111110000111122223333');
  });

  it('rechaza lo incompleto, lo que sobra y los símbolos que no existen', () => {
    expect(readCode('')).toBeNull();
    expect(readCode(CANONICAL.slice(1))).toBeNull();
    expect(readCode(`${CANONICAL}A`)).toBeNull();
    expect(readCode(CANONICAL.replace('G', 'U'))).toBeNull();
    expect(readCode(CANONICAL.replace('G', '#'))).toBeNull();
  });

  it('se pinta en 7 grupos de 4', () => {
    expect(codeGroups(formatCode(CANONICAL))).toEqual([
      'GXEN',
      'Q32V',
      'ABCD',
      'EFGH',
      'JKMN',
      'PQRS',
      'TVWX',
    ]);
    expect(codeGroups(CANONICAL)).toHaveLength(7);
  });
});

describe('errores que dicen qué hacer (§9.9)', () => {
  it('el código no válido se explica distinto para emparejar y para recuperar', () => {
    expect(syncErrorText('invalid_code', 'pair')).toMatch(/caducado \(dura 10 minutos\)/);
    expect(syncErrorText('invalid_code', 'recover')).toMatch(/^Este código de recuperación/);
  });

  it('cada error conocido tiene su texto; los del servidor, uno común', () => {
    expect(syncErrorText('network', 'activate')).toMatch(/Comprueba tu conexión/);
    expect(syncErrorText('rate_limited', 'pair')).toMatch(/Espera un minuto/);
    expect(syncErrorText('sync_disabled', 'activate')).toMatch(/aún no está disponible/);
    expect(syncErrorText('age_policy_changed', 'activate')).toMatch(/Recarga la página/);
    expect(syncErrorText('already_paired', 'recover')).toMatch(/desemparéjalo antes/);
    expect(syncErrorText('not_found', 'revoke')).toMatch(/ya no estaba emparejado/);
    expect(syncErrorText('unavailable', 'activate')).toMatch(/ventana privada/);
    for (const code of ['internal', 'busy', 'bad_response', 'invalid_body'] as const) {
      expect(syncErrorText(code, 'activate')).toMatch(/servidor/);
    }
  });
});

describe('estado de la agenda emparejada', () => {
  const now = Date.UTC(2026, 10, 7, 12, 0, 0);

  it('al día, sincronizando, sin red, apagada en el servidor o con un error', () => {
    expect(statusLine(state(), now)).toEqual({ text: 'Aún no se ha sincronizado.', tone: 'ok' });
    expect(statusLine(state({ lastSyncAt: now - 5 * 60_000 }), now).text).toBe(
      'Sincronizado hace 5 minutos.',
    );
    expect(statusLine(state({ activity: 'syncing' }), now)).toEqual({
      text: 'Sincronizando…',
      tone: 'busy',
    });
    expect(statusLine(state({ activity: 'offline', error: 'network' }), now).tone).toBe('offline');
    expect(statusLine(state({ activity: 'disabled', error: 'sync_disabled' }), now).text).toMatch(
      /no está disponible/,
    );
    expect(statusLine(state({ activity: 'error', error: 'internal' }), now).text).toMatch(
      /pulsa «Sincronizar ahora»/,
    );
    expect(statusLine(state({ activity: 'error', error: 'storage' }), now).text).toMatch(
      /Recarga la página/,
    );
    expect(statusLine(state({ activity: 'error', error: 'rate_limited' }), now).text).toMatch(
      /muy ocupado/,
    );
  });

  it('restaurando (CA4.3) dice que la agenda está llegando', () => {
    expect(statusLine(state({ status: 'restoring' }), now).text).toBe(
      'Trayendo tu agenda sincronizada…',
    );
    expect(statusLine(state({ status: 'restoring', activity: 'offline' }), now).text).toMatch(
      /Traeremos tu agenda/,
    );
  });

  it('los cambios pendientes son juegos, con plural', () => {
    expect(pendingText(0)).toBeNull();
    expect(pendingText(1)).toBe('1 juego con cambios sin sincronizar.');
    expect(pendingText(12000)).toBe('12 000 juegos con cambios sin sincronizar.');
  });

  it('hace cuánto', () => {
    expect(timeAgo(now - 10_000, now)).toBe('hace un momento');
    expect(timeAgo(now + 10_000, now)).toBe('hace un momento');
    expect(timeAgo(now - 59 * 60_000, now)).toBe('hace 59 minutos');
    expect(timeAgo(now - 2 * 3_600_000, now)).toBe('hace 2 horas');
    expect(timeAgo(now - 26 * 3_600_000, now)).toBe('ayer');
    expect(timeAgo(now - 3 * 86_400_000, now)).toBe('hace 3 días');
  });
});

describe('dispositivos', () => {
  const now = new Date(2026, 10, 7, 20, 0, 0).getTime();

  it('alta y última vez, por días (el servidor la apunta una vez al día)', () => {
    const d = device({
      createdAt: new Date(2026, 10, 1, 9, 0, 0).toISOString(),
      lastSeenAt: new Date(2026, 10, 6, 23, 30, 0).toISOString(),
    });
    expect(deviceDetails(d, now)).toBe('Desde el 1 nov 2026 · Última vez: ayer');
    expect(dayAgo(new Date(2026, 10, 7, 0, 5).getTime(), now)).toBe('hoy');
    expect(deviceDetails(device({ createdAt: 'x', lastSeenAt: 'y' }), now)).toBe('');
  });

  it('este dispositivo va primero; los demás, en el orden del servidor', () => {
    const list = [device({ id: 'a' }), device({ id: 'b', current: true }), device({ id: 'c' })];
    expect(sortDevices(list).map((d) => d.id)).toEqual(['b', 'a', 'c']);
  });

  it('detecta el dispositivo recién emparejado', () => {
    const before = new Set(['a', 'b']);
    const after = [device({ id: 'a', current: true }), device({ id: 'b' }), device({ id: 'n' })];
    expect(newDevices(before, after).map((d) => d.id)).toEqual(['n']);
    expect(newDevices(new Set(['a', 'b', 'n']), after)).toEqual([]);
  });
});

describe('cuenta atrás del código de emparejamiento', () => {
  const now = Date.UTC(2026, 10, 7, 12, 0, 0);

  it('lo que queda, sin bajar de 0', () => {
    expect(remainingMs(new Date(now + 600_000).toISOString(), now)).toBe(600_000);
    expect(remainingMs(new Date(now - 1).toISOString(), now)).toBe(0);
    expect(remainingMs('no es una fecha', now)).toBe(0);
  });

  it('minutos y segundos, redondeando hacia arriba', () => {
    expect(formatCountdown(600_000)).toBe('10:00');
    expect(formatCountdown(581_001)).toBe('9:42');
    expect(formatCountdown(999)).toBe('0:01');
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-5)).toBe('0:00');
  });
});
