import { describe, expect, it } from 'vitest';
import {
  isEntryId,
  isFullDate,
  isValidDay,
  manualEntryId,
  parseEntryId,
  steamEntryId,
} from '../src/entries/index.ts';

const UUID = '0190b6e2-7f3a-7c4e-9d2a-1b2c3d4e5f60';

describe('steamEntryId', () => {
  it('construye el id con un entero seguro positivo', () => {
    expect(steamEntryId(730)).toBe('steam:730');
    expect(steamEntryId(1)).toBe('steam:1');
    expect(steamEntryId(9_999_999_999)).toBe('steam:9999999999');
  });

  it('rechaza lo que no es un appid', () => {
    for (const n of [0, -1, 1.5, 730.0000001, Number.NaN, Infinity, 2 ** 53, 10_000_000_000]) {
      expect(() => steamEntryId(n)).toThrow(RangeError);
    }
  });

  it('730.0 es el entero 730 en JavaScript: nunca da «steam:730.0»', () => {
    expect(steamEntryId(730.0)).toBe('steam:730');
  });
});

describe('manualEntryId', () => {
  it('acepta un uuidv7 en minúsculas', () => {
    expect(manualEntryId(UUID)).toBe(`manual:${UUID}`);
  });

  it('rechaza otras versiones, mayúsculas y basura', () => {
    expect(() => manualEntryId('0190b6e2-7f3a-4c4e-9d2a-1b2c3d4e5f60')).toThrow(TypeError);
    expect(() => manualEntryId(UUID.toUpperCase())).toThrow(TypeError);
    expect(() => manualEntryId('hades')).toThrow(TypeError);
  });
});

describe('parseEntryId e isEntryId', () => {
  it('distingue los dos tipos', () => {
    expect(parseEntryId('steam:1145350')).toEqual({ kind: 'steam', appid: 1145350 });
    expect(parseEntryId(`manual:${UUID}`)).toEqual({ kind: 'manual', uuid: UUID });
  });

  it('rechaza ids mal formados', () => {
    for (const id of ['steam:0', 'steam:0730', 'steam:730.0', 'steam:', 'manual:x', 'igdb:1']) {
      expect(parseEntryId(id)).toBeNull();
      expect(isEntryId(id)).toBe(false);
    }
  });
});

describe('fechas parciales', () => {
  it('acepta fechas que existen', () => {
    for (const d of ['2019', '2019-05', '2020-02-29', '1900', '2100-12-31', '2026-10-28']) {
      expect(isValidDay(d)).toBe(true);
    }
  });

  it('rechaza fechas que no existen o fuera de 1900–2100', () => {
    for (const d of ['2019-00', '2019-02-29', '2019-02-30', '2019-13', '2019-04-31', '1899']) {
      expect(isValidDay(d)).toBe(false);
    }
    for (const d of ['2101', '2019-5', '2019-05-1', '19', '', '2019-05-01T00:00', 2019, null]) {
      expect(isValidDay(d)).toBe(false);
    }
  });

  it('la fecha de hoy tiene que ser completa', () => {
    expect(isFullDate('2026-10-28')).toBe(true);
    expect(isFullDate('2026-10')).toBe(false);
    expect(isFullDate('2026-02-30')).toBe(false);
  });
});
