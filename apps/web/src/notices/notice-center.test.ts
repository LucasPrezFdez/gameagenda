import { describe, expect, it } from 'vitest';
import { createNoticeCenter } from './notice-center.ts';

describe('aviso con Deshacer', () => {
  it('el aviso deshace su propio cambio aunque haya otros detrás', () => {
    const center = createNoticeCenter();
    const undone: string[] = [];
    center.notify('A', { undo: () => undone.push('A') });
    const first = center.getSnapshot();
    center.notify('B', { undo: () => undone.push('B') });
    if (!first) throw new Error('sin aviso');
    center.undoNotice(first);
    expect(undone).toEqual(['A']);
    center.undoLast();
    expect(undone).toEqual(['A', 'B']);
    center.undoLast();
    expect(center.getSnapshot()?.message).toBe('No hay ningún cambio que deshacer.');
  });
});
