import { describe, expect, it } from 'vitest';
import { isValidDay } from '../lib/day.ts';
import { createMemoryAgenda } from './memory-agenda.ts';
import { viewOf } from './types.ts';

const now = () => new Date(2026, 9, 29, 12);

describe('agenda en memoria', () => {
  it('apunta al final, no duplica y deshace', () => {
    const agenda = createMemoryAgenda(now);
    agenda.capture({ id: 'steam:1', title: 'Hades' });
    const second = agenda.capture({ id: 'steam:2', title: 'Hades II' });
    expect(agenda.capture({ id: 'steam:1', title: 'Hades' }).effect.kind).toBe('alreadyInList');
    expect(agenda.getSnapshot().map((e) => e.id)).toEqual(['steam:1', 'steam:2']);
    second.undo?.();
    expect(agenda.getSnapshot().map((e) => e.id)).toEqual(['steam:1']);
  });

  it('Platinado ⇒ Completado con fechas, y un solo Deshacer lo revierte', () => {
    const agenda = createMemoryAgenda(now);
    agenda.capture({ id: 'steam:1', title: 'Hades' });
    const result = agenda.setFlag('steam:1', 'platinum', true);
    expect(result.effect).toMatchObject({ kind: 'flag', autoCompleted: true });
    expect(agenda.getSnapshot()[0]).toMatchObject({
      status: 'completed',
      completedAt: '2026-10-29',
      platinumAt: '2026-10-29',
    });
    result.undo?.();
    expect(agenda.getSnapshot()[0]).toMatchObject({ status: 'want_to_play', completedAt: null });
  });

  it('ordena a mano dentro de la vista', () => {
    const agenda = createMemoryAgenda(now);
    for (const n of [1, 2, 3]) agenda.capture({ id: `steam:${n}`, title: `J${n}` });
    expect(agenda.move('steam:3', 'top').effect).toMatchObject({ position: 1, total: 3 });
    const order = [...agenda.getSnapshot()].sort((a, b) => a.rank.localeCompare(b.rank));
    expect(order.map((e) => e.id)).toEqual(['steam:3', 'steam:1', 'steam:2']);
  });

  it('Próximo solo actúa en Quiero jugar y En pausa', () => {
    expect(viewOf({ status: 'on_hold', flags: { next: true } })).toBe('next');
    expect(viewOf({ status: 'playing', flags: { next: true } })).toBe('playing');
  });
});

describe('isValidDay', () => {
  it('acepta fechas parciales que existen', () => {
    for (const day of ['2019', '2019-05', '2020-02-29']) expect(isValidDay(day)).toBe(true);
    for (const day of ['2019-00', '2019-02-29', '1899', '2019-5', '19']) {
      expect(isValidDay(day)).toBe(false);
    }
  });
});
