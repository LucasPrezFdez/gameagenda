import { describe, expect, it } from 'vitest';
import {
  catalogIsLoading,
  hasTextInProgress,
  hasWorkInProgress,
  OPEN_UI,
} from './work-in-progress.ts';

const input = (value: string, extra: Record<string, unknown> = {}) => ({
  tagName: 'INPUT',
  type: 'text',
  readOnly: false,
  value,
  ...extra,
});

describe('hasTextInProgress', () => {
  it('un campo de texto con algo escrito, sí; vacío, no', () => {
    expect(hasTextInProgress(input('hades'))).toBe(true);
    expect(hasTextInProgress(input(''))).toBe(false);
    expect(hasTextInProgress({ tagName: 'TEXTAREA', value: 'Una nota' })).toBe(true);
    expect(hasTextInProgress(input('2026', { type: 'search' }))).toBe(true);
  });

  it('casillas, botones y campos de solo lectura no cuentan', () => {
    expect(hasTextInProgress(input('on', { type: 'checkbox' }))).toBe(false);
    expect(hasTextInProgress(input('x', { type: 'RADIO' }))).toBe(false);
    expect(hasTextInProgress({ tagName: 'TEXTAREA', value: 'informe', readOnly: true })).toBe(
      false,
    );
    expect(hasTextInProgress({ tagName: 'BUTTON', value: 'Apuntar' })).toBe(false);
    expect(hasTextInProgress(null)).toBe(false);
    expect(hasTextInProgress({ tagName: 'BODY' })).toBe(false);
  });

  it('contenido editable con texto, sí', () => {
    expect(hasTextInProgress({ isContentEditable: true, textContent: 'algo' })).toBe(true);
    expect(hasTextInProgress({ isContentEditable: true, textContent: '' })).toBe(false);
  });
});

describe('hasWorkInProgress', () => {
  const doc = (activeElement: unknown, open: unknown = null) => ({
    activeElement,
    querySelector: (selectors: string) => (selectors === OPEN_UI ? open : null),
  });

  it('el foco en un campo con texto, o algo abierto', () => {
    expect(hasWorkInProgress(doc(input('hollow')))).toBe(true);
    expect(hasWorkInProgress(doc(input(''), { role: 'menu' }))).toBe(true);
    expect(hasWorkInProgress(doc(input('')))).toBe(false);
    expect(hasWorkInProgress(doc({ tagName: 'BODY' }))).toBe(false);
  });

  it('busca diálogos, menús y la lista de la paleta abiertos', () => {
    expect(OPEN_UI).toContain('dialog[open]');
    expect(OPEN_UI).toContain('[role="menu"]');
    expect(OPEN_UI).toContain('[role="combobox"][aria-expanded="true"]');
  });
});

describe('catalogIsLoading', () => {
  it('solo en `full` o con error deja recargar', () => {
    expect(catalogIsLoading({ state: 'full', error: null })).toBe(false);
    expect(catalogIsLoading({ state: 'scan', error: null })).toBe(true);
    expect(catalogIsLoading({ state: 'none', error: null })).toBe(true);
    expect(catalogIsLoading({ state: 'none', error: { kind: 'network' } })).toBe(false);
  });
});
