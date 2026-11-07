import {
  DEVICE_LABEL_MAX,
  deviceLabelSchema,
  formatCode,
  PAIRING_TTL_MS,
} from '@gameagenda/core/api';
import { describe, expect, it } from 'vitest';
import { es } from '../../i18n/es.ts';
import type { DeviceInfo, SyncState } from '../../sync/types.ts';
import {
  cleanDeviceLabel,
  codeGroups,
  dayAgo,
  deleteServerErrorText,
  deviceDetails,
  focusLost,
  formatClock,
  formatCountdown,
  isDesktopApp,
  isIosBrowserTab,
  isLastAppDevice,
  messageAfterViewChange,
  newDevices,
  nextPairingLink,
  type PairingLink,
  type PanelMessage,
  pairingDeadline,
  pendingText,
  readCode,
  remainingMs,
  sortDevices,
  statusLine,
  suggestedDeviceLabel,
  syncErrorText,
  syncedWhen,
  syncViewOf,
  timeAgo,
  viewHeading,
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
    expect(syncErrorText('age_policy_changed', 'activate')).toMatch(/Cierra GameAgenda/);
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
    expect(remainingMs(now + 600_000, now)).toBe(600_000);
    expect(remainingMs(now - 1, now)).toBe(0);
    expect(remainingMs(Number.NaN, now)).toBe(0);
  });

  it('va con el reloj de este dispositivo, no con el `expiresAt` del servidor', () => {
    // El servidor sella `expiresAt` con su reloj; este dispositivo va 11 min adelantado.
    const serverNow = now;
    const expiresAt = new Date(serverNow + PAIRING_TTL_MS).toISOString();
    const sentAt = serverNow + 11 * 60_000;
    // Con la hora del servidor, el código saldría caducado nada más crearlo…
    expect(Math.max(0, Date.parse(expiresAt) - sentAt)).toBe(0);
    // …con el plazo local, vale lo que dura desde que se pidió.
    const deadline = pairingDeadline(sentAt);
    expect(remainingMs(deadline, sentAt + 1000)).toBe(PAIRING_TTL_MS - 1000);
    expect(remainingMs(deadline, sentAt + PAIRING_TTL_MS)).toBe(0);
    // Y la hora límite que se enseña es la del reloj del usuario.
    expect(formatClock(deadline)).toBe(formatClock(sentAt + PAIRING_TTL_MS));
    expect(formatClock(Number.NaN)).toBe('');
  });

  it('minutos y segundos, redondeando hacia arriba', () => {
    expect(formatCountdown(600_000)).toBe('10:00');
    expect(formatCountdown(581_001)).toBe('9:42');
    expect(formatCountdown(999)).toBe('0:01');
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-5)).toBe('0:00');
  });
});

describe('la hora, con su artículo', () => {
  const at = (h: number, m: number) => new Date(2026, 10, 7, h, m).getTime();

  it('«a la 01:05» (es la una), pero «a las 13:05» y «a las 00:05»', () => {
    expect(syncedWhen(at(1, 5), at(9, 0))).toBe('a la 01:05');
    expect(syncedWhen(at(13, 5), at(14, 0))).toBe('a las 13:05');
    expect(syncedWhen(at(0, 5), at(9, 0))).toBe('a las 00:05');
    const nov3 = (h: number, m: number) => new Date(2026, 10, 3, h, m).getTime();
    expect(syncedWhen(nov3(1, 59), at(9, 0))).toBe('el 3 nov a la 01:59');
    expect(syncedWhen(nov3(18, 42), at(9, 0))).toBe('el 3 nov a las 18:42');
  });

  it('el código de emparejamiento sirve «hasta la 01:05» o «hasta las 13:05»', () => {
    const until = (h: number, m: number) => es.syncPanel.pairValidUntil(formatClock(at(h, m)));
    expect(until(1, 5)).toBe('Sirve una sola vez, hasta la 01:05.');
    expect(until(13, 5)).toBe('Sirve una sola vez, hasta las 13:05.');
    expect(until(10, 15)).toBe('Sirve una sola vez, hasta las 10:15.');
  });
});

describe('el enlace del QR (`/emparejar#…`)', () => {
  const opened: PairingLink = { code: 'GXEN-Q32V', view: null };

  it('se queda en la vista en que se abrió, también mientras se lee el estado', () => {
    expect(nextPairingLink(opened, 'loading')).toBe(opened);
    const fixed = nextPairingLink(opened, 'off');
    expect(fixed).toEqual({ code: 'GXEN-Q32V', view: 'off' });
    expect(nextPairingLink(fixed, 'off')).toBe(fixed);
    expect(nextPairingLink(null, 'off')).toBeNull();
  });

  it('se olvida al cambiar de vista: ni nota en la emparejada ni campo tras un 401', () => {
    // Abierto sin sincronizar y canjeado: en la vista emparejada ya no es «desde el enlace».
    const off = nextPairingLink(opened, 'off');
    const paired = nextPairingLink(off, 'paired');
    expect(paired).toBeNull();
    // Y si después el servidor lo desempareja, el código gastado no vuelve al campo.
    expect(nextPairingLink(paired, 'unpaired')).toBeNull();
    // Abierto ya emparejado: la nota sale ahí, pero no en la vista desemparejada de después.
    const already = nextPairingLink(opened, 'paired');
    expect(already?.view).toBe('paired');
    expect(nextPairingLink(already, 'unpaired')).toBeNull();
    // Activar en vez de canjearlo también lo olvida.
    expect(nextPairingLink(off, 'reveal')).toBeNull();
  });
});

describe('el aviso de arriba de la sección', () => {
  const joined: PanelMessage = { id: 1, text: es.syncPanel.joined, view: 'paired' };

  it('se borra al cambiar a otra vista (un 401 tras unirse), no en la suya', () => {
    expect(messageAfterViewChange(joined, 'paired')).toBe(joined);
    expect(messageAfterViewChange(joined, 'unpaired')).toBeNull();
    expect(messageAfterViewChange(joined, 'reveal')).toBeNull();
    expect(messageAfterViewChange(null, 'off')).toBeNull();
  });
});

describe('el foco al cambiar de vista', () => {
  const body = { isConnected: true };

  it('cada vista tiene su encabezado; «cargando», ninguno', () => {
    expect(viewHeading('off')).toBe('off');
    expect(viewHeading('paired')).toBe('status');
    expect(viewHeading('unpaired')).toBe('unpaired');
    expect(viewHeading('reveal')).toBe('reveal');
    expect(viewHeading('loading')).toBeNull();
  });

  it('solo se mueve si se ha perdido: en `body`, en nada o en un nodo que ya no está', () => {
    expect(focusLost(body, body)).toBe(true);
    expect(focusLost(null, body)).toBe(true);
    expect(focusLost({ isConnected: false }, body)).toBe(true);
    // En la navegación o en cualquier otro sitio de la página, no se le quita.
    expect(focusLost({ isConnected: true }, body)).toBe(false);
  });
});

describe('Safari de iPhone o iPad fuera de la pantalla de inicio', () => {
  it('solo con `navigator.standalone === false`', () => {
    expect(isIosBrowserTab({ standalone: false })).toBe(true);
    expect(isIosBrowserTab({ standalone: true })).toBe(false);
    expect(isIosBrowserTab({})).toBe(false);
    expect(isIosBrowserTab(undefined)).toBe(false);
  });
});

describe('desemparejar el último dispositivo con la agenda', () => {
  const self = device({ id: 'a', current: true });

  it('lo es si en la lista no hay otro `app` (el buzón del Atajo de iOS no cuenta)', () => {
    expect(isLastAppDevice([self])).toBe(true);
    expect(isLastAppDevice([self, device({ id: 'i', kind: 'inbox' })])).toBe(true);
    expect(isLastAppDevice([self, device({ id: 'b' })])).toBe(false);
  });

  it('sin la lista, o sin este dispositivo en ella, no se sabe: el texto de siempre', () => {
    expect(isLastAppDevice(null)).toBe(false);
    expect(isLastAppDevice([device({ id: 'b' })])).toBe(false);
  });

  it('la pregunta dice que la copia sincronizada se queda en el servidor', () => {
    expect(es.syncPanel.leaveConfirmLast).toMatch(/^¿Desemparejar este dispositivo\?/);
    expect(es.syncPanel.leaveConfirmLast).toMatch(/se quedará en el servidor/);
    expect(es.syncPanel.leaveConfirmLast).toMatch(/«Borrar todos mis datos»/);
  });
});

describe('«Borrar todos mis datos» sin poder borrar el servidor', () => {
  it('con un 401 no da la agenda por borrada: no se ha borrado nada', () => {
    const text = deleteServerErrorText('unauthorized');
    expect(text).toBe(es.settings.deleteServerUnpaired);
    expect(text).toMatch(/ya no está emparejado/);
    expect(text).toMatch(/no hemos borrado nada/);
  });

  it('cada causa tiene su texto, y todos dicen que no se ha borrado nada', () => {
    expect(deleteServerErrorText('network')).toBe(es.settings.deleteServerOffline);
    expect(deleteServerErrorText('sync_disabled')).toBe(es.settings.deleteServerDisabled);
    expect(deleteServerErrorText('internal')).toBe(es.settings.deleteServerFailed);
    expect(deleteServerErrorText(null)).toBe(es.settings.deleteServerFailed);
    for (const code of ['network', 'sync_disabled', 'unauthorized', 'internal'] as const) {
      expect(deleteServerErrorText(code)).toMatch(/no hemos borrado nada/);
    }
  });
});

describe('textos que se cumplen', () => {
  it('con otra edad mínima no pide recargar (el Service Worker nuevo espera)', () => {
    const text = syncErrorText('age_policy_changed', 'activate');
    expect(text).not.toMatch(/Recarga/);
    expect(text).toMatch(/Cierra GameAgenda, todas sus ventanas/);
  });

  it('el aviso habla de las dos cookies que se crean', () => {
    expect(es.syncPanel.cookie).toMatch(/guarda dos cookies/);
    expect(es.syncPanel.cookie).not.toMatch(/una cookie/);
  });
});
