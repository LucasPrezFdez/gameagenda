import { describe, expect, it } from 'vitest';
import { createUndoStack } from './undo-stack.ts';

describe('pila de Deshacer', () => {
  it('guarda 20 niveles y deshace en orden inverso', () => {
    const stack = createUndoStack();
    const undone: number[] = [];
    for (let i = 1; i <= 25; i += 1) stack.push(`cambio ${i}`, () => undone.push(i));
    expect(stack.size).toBe(20);
    stack.pop()?.undo();
    stack.pop()?.undo();
    expect(undone).toEqual([25, 24]);
  });

  it('saca un cambio concreto sin tocar los demás', () => {
    const stack = createUndoStack();
    const first = stack.push('A', () => undefined);
    stack.push('B', () => undefined);
    expect(stack.take(first.id)?.message).toBe('A');
    expect(stack.has(first.id)).toBe(false);
    expect(stack.pop()?.message).toBe('B');
    expect(stack.pop()).toBeUndefined();
  });
});
