import { afterEach, describe, expect, it } from 'vitest';
import {
  type HistoryLike,
  peekPendingPairingCode,
  stashPairingCode,
  takePairingLink,
  takePendingPairingCode,
} from './pairing-link.ts';

function fakeHistory(state: unknown = { idx: 3 }) {
  const calls: { data: unknown; url: string | URL | null | undefined }[] = [];
  const history: HistoryLike = {
    state,
    replaceState(data, _unused, url) {
      calls.push({ data, url });
    },
  };
  return { history, calls };
}

afterEach(() => {
  takePendingPairingCode();
});

describe('takePairingLink (M4; §11.4)', () => {
  it('guarda el código y cambia la URL por la de Ajustes › Sincronización, sin fragmento', () => {
    const { history, calls } = fakeHistory();
    const taken = takePairingLink({ pathname: '/emparejar', hash: '#ABCD-EFGH' }, history);
    expect(taken).toBe(true);
    expect(calls).toEqual([{ data: { idx: 3 }, url: '/ajustes/sincronizacion' }]);
    // Mirarlo no lo gasta; recogerlo, sí.
    expect(peekPendingPairingCode()).toBe('ABCD-EFGH');
    expect(takePendingPairingCode()).toBe('ABCD-EFGH');
    // Una sola vez: no se vuelve a poner en otro campo.
    expect(takePendingPairingCode()).toBeNull();
  });

  it('también con barra final y sin código (el campo queda vacío)', () => {
    const { history, calls } = fakeHistory(null);
    expect(takePairingLink({ pathname: '/emparejar/', hash: '' }, history)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(takePendingPairingCode()).toBeNull();
  });

  it('en cualquier otra ruta no toca nada', () => {
    const { history, calls } = fakeHistory();
    stashPairingCode('ANTES');
    for (const pathname of ['/', '/ajustes/sincronizacion', '/emparejar/otra', '/juego/steam:1']) {
      expect(takePairingLink({ pathname, hash: '#ABCD' }, history)).toBe(false);
    }
    expect(calls).toEqual([]);
    expect(takePendingPairingCode()).toBe('ANTES');
  });
});
