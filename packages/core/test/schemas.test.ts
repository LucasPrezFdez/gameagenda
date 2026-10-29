import { describe, expect, it } from 'vitest';
import { skeleton } from '../src/entries/index.ts';
import {
  daySchema,
  entryIdSchema,
  entrySchema,
  noteSchema,
  opSchema,
  partialDateSchema,
} from '../src/schemas/index.ts';
import { hlc, MANUAL_1, UUID_M1 } from './helpers.ts';

describe('ids (§7.3)', () => {
  it('acepta steam:<appid> y manual:<uuidv7>', () => {
    for (const id of ['steam:730', 'steam:1', 'steam:9999999999', MANUAL_1]) {
      expect(entryIdSchema.safeParse(id).success).toBe(true);
    }
  });

  it('rechaza el resto', () => {
    for (const id of [
      'steam:0',
      'steam:0730',
      'steam:730.0',
      'steam:12345678901',
      'manual:hades',
      `manual:${UUID_M1.toUpperCase()}`,
      'manual:0190b6e2-7f3a-4c4e-9d2a-1b2c3d4e5f60',
      'igdb:1',
      730,
    ]) {
      expect(entryIdSchema.safeParse(id).success).toBe(false);
    }
  });
});

describe('fechas parciales (§7.4)', () => {
  it('acepta las que existen', () => {
    for (const d of ['2019', '2019-05', '2020-02-29']) {
      expect(partialDateSchema.safeParse(d).success).toBe(true);
    }
    expect(daySchema.safeParse(null).success).toBe(true);
  });

  it('rechaza las que no existen', () => {
    for (const d of ['2019-00', '2019-02-29', '2019-02-30', '1899', '2101', '2019-5', '']) {
      expect(partialDateSchema.safeParse(d).success).toBe(false);
    }
  });
});

describe('nota', () => {
  it('admite hasta 2000 caracteres', () => {
    expect(noteSchema.safeParse('x'.repeat(2000)).success).toBe(true);
    expect(noteSchema.safeParse('x'.repeat(2001)).success).toBe(false);
  });
});

describe('Entry', () => {
  const h = hlc(1);
  const entry = {
    ...skeleton('steam:730'),
    title: 'Counter-Strike 2',
    rank: 'a0',
    flags: { platinum: false, owned: true },
    hlc: { status: h, title: h, rank: h, 'flags.owned': h },
  };

  it('acepta una entrada válida y descarta los derivados', () => {
    const r = entrySchema.safeParse({ ...entry, view: 'want_to_play', lastHlc: h });
    expect(r.success).toBe(true);
    expect(r.data).not.toHaveProperty('view');
    expect(r.data).not.toHaveProperty('lastHlc');
  });

  it('acepta esqueletos (rank vacío sin HLC)', () => {
    expect(entrySchema.safeParse(skeleton(MANUAL_1)).success).toBe(true);
  });

  it('rechaza valores fuera del modelo', () => {
    const bad = [
      { ...entry, status: 'wishlist' },
      { ...entry, platform: 'wii' },
      { ...entry, note: 'x'.repeat(2001) },
      { ...entry, startedAt: '2019-02-29' },
      { ...entry, rank: 'a00' },
      { ...entry, rank: '' },
      { ...entry, flags: { Owned: true } },
      { ...entry, flags: { owned: 'yes' } },
      { ...entry, hlc: { status: 'ayer' } },
      { ...entry, hlc: { view: h } },
      { ...entry, deletedAt: '28/10/2026' },
      { ...entry, mergedInto: 'steam:730' },
      { ...entry, id: 'steam:0' },
    ];
    for (const e of bad) expect(entrySchema.safeParse(e).success).toBe(false);
  });
});

describe('Op', () => {
  const base = {
    opId: '0190b6e2-7f3a-7c4e-9d2a-1b2c3d4e5f60',
    entryId: 'steam:730',
    hlc: hlc(1),
  };

  it('valida el valor según el campo', () => {
    const ok = [
      { field: 'status', value: 'playing' },
      { field: 'flags.owned', value: true },
      { field: 'flags.mi_marca', value: false },
      { field: 'addedAt', value: '2019-05' },
      { field: 'platform', value: null },
      { field: 'deletedAt', value: '2026-10-28T09:15:00.000Z' },
      { field: 'mergedInto', value: 'steam:1145350' },
    ];
    for (const o of ok) expect(opSchema.safeParse({ ...base, ...o }).success).toBe(true);
    const bad = [
      { field: 'status', value: 'wishlist' },
      { field: 'flags.owned', value: 1 },
      { field: 'addedAt', value: '2019-02-29' },
      { field: 'rank', value: 'a00' },
      { field: 'view', value: 'next' },
    ];
    for (const o of bad) expect(opSchema.safeParse({ ...base, ...o }).success).toBe(false);
    expect(
      opSchema.safeParse({ ...base, field: 'status', value: 'playing', opId: 'x' }).success,
    ).toBe(false);
  });
});
