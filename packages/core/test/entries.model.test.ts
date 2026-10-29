import { describe, expect, it } from 'vitest';
import {
  type Entry,
  isField,
  isLive,
  isSkeleton,
  isUserField,
  readField,
  STATUSES,
  type Status,
  skeleton,
  type View,
  viewOf,
} from '../src/entries/index.ts';

const H = '1793178900000-0000-k3x9p2qa';

function live(status: Status, next: boolean): Entry {
  return {
    ...skeleton('steam:730'),
    status,
    title: 'Counter-Strike 2',
    flags: { platinum: false, owned: false, next },
    hlc: { status: H, title: H, 'flags.next': H },
  };
}

describe('viewOf', () => {
  // Vectores de la §7.2: los cinco estados, con y sin Próximo.
  const vectors: Array<[Status, boolean, View]> = [
    ['want_to_play', false, 'want_to_play'],
    ['want_to_play', true, 'next'],
    ['playing', false, 'playing'],
    ['playing', true, 'playing'],
    ['on_hold', false, 'on_hold'],
    ['on_hold', true, 'next'],
    ['completed', false, 'completed'],
    ['completed', true, 'completed'],
    ['dropped', false, 'dropped'],
    ['dropped', true, 'dropped'],
  ];

  it.each(vectors)('%s con Próximo=%s → %s', (status, next, view) => {
    expect(viewOf(live(status, next))).toBe(view);
  });

  it('no existe en lápidas', () => {
    for (const status of STATUSES) {
      const e = { ...live(status, true), deletedAt: '2026-10-28T09:15:00.000Z' };
      expect(viewOf(e)).toBeUndefined();
    }
  });

  it('no existe en esqueletos (sin status o sin title)', () => {
    expect(viewOf(skeleton('steam:730'))).toBeUndefined();
    const sinTitle = live('playing', false);
    delete sinTitle.hlc.title;
    expect(viewOf(sinTitle)).toBeUndefined();
    const sinStatus = live('playing', false);
    delete sinStatus.hlc.status;
    expect(viewOf(sinStatus)).toBeUndefined();
  });
});

describe('esqueleto y visibilidad', () => {
  it('el esqueleto tiene valores por defecto y ninguna HLC', () => {
    const e = skeleton('manual:0190b6e2-7f3a-7c4e-9d2a-1b2c3d4e5f60');
    expect(e).toMatchObject({
      status: 'want_to_play',
      flags: {},
      note: '',
      platform: null,
      addedAt: null,
      deletedAt: null,
      mergedInto: null,
      hlc: {},
      lastHlc: '',
    });
    expect(isSkeleton(e)).toBe(true);
    expect(isLive(e)).toBe(false);
  });

  it('una entrada con status y title es visible salvo que sea lápida', () => {
    expect(isLive(live('playing', false))).toBe(true);
    expect(isLive({ ...live('playing', false), deletedAt: '2026-10-28T09:15:00.000Z' })).toBe(
      false,
    );
    expect(isLive(undefined)).toBe(false);
  });
});

describe('campos', () => {
  it('reconoce los campos de Op.field', () => {
    for (const f of ['status', 'rank', 'note', 'platform', 'addedAt', 'ownedAt', 'title']) {
      expect(isField(f)).toBe(true);
    }
    for (const f of ['cover', 'deletedAt', 'mergedInto', 'flags.owned', 'flags.mi_marca']) {
      expect(isField(f)).toBe(true);
    }
    for (const f of ['id', 'view', 'lastHlc', 'hlc', 'flags', 'flags.', 'flags.Owned', 'x']) {
      expect(isField(f)).toBe(false);
    }
  });

  it('los campos de usuario excluyen title, cover, deletedAt y mergedInto', () => {
    for (const f of ['status', 'rank', 'note', 'platform', 'startedAt', 'flags.platinum']) {
      expect(isUserField(f)).toBe(true);
    }
    for (const f of ['title', 'cover', 'deletedAt', 'mergedInto']) {
      expect(isUserField(f)).toBe(false);
    }
  });

  it('una marca ausente se lee como false', () => {
    const e = live('playing', true);
    expect(readField(e, 'flags.next')).toBe(true);
    expect(readField(e, 'flags.mi_marca')).toBe(false);
    expect(readField(e, 'status')).toBe('playing');
  });
});
