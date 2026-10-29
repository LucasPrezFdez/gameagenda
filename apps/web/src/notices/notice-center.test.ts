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

describe('aviso con acciones', () => {
  it('lleva sus botones y no entra en la pila de Deshacer', () => {
    const center = createNoticeCenter();
    const ran: string[] = [];
    center.notify('Guardado fallido', {
      actions: [
        { label: 'Exportar', run: () => ran.push('exportar') },
        { label: 'Reintentar', run: () => ran.push('reintentar') },
      ],
    });
    const notice = center.getSnapshot();
    expect(notice?.undoId).toBeNull();
    expect(notice?.actions.map((action) => action.label)).toEqual(['Exportar', 'Reintentar']);
    notice?.actions[1]?.run();
    expect(ran).toEqual(['reintentar']);
    center.undoLast();
    expect(center.getSnapshot()?.message).toBe('No hay ningún cambio que deshacer.');
  });
});
