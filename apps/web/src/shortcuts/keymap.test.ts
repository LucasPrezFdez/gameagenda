import { describe, expect, it } from 'vitest';
import { FLAGS, STATUSES } from '../agenda/types.ts';
import { es } from '../i18n/es.ts';
import {
  FLAG_SHORTCUTS,
  type KeyInput,
  readShortcut,
  shortcutFor,
  shortcutGroups,
  trackGoSequence,
} from './keymap.ts';

const press = (key: string, extra: Partial<KeyInput> = {}): KeyInput => ({
  key,
  code: extra.code ?? `Key${key.toUpperCase()}`,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  ...extra,
});

describe('readShortcut', () => {
  it('letras sin distinguir mayúsculas', () => {
    expect(readShortcut(press('j'), true)).toEqual({ kind: 'next' });
    expect(readShortcut(press('J', { shiftKey: true }), true)).toEqual({ kind: 'next' });
    expect(readShortcut(press('k'), true)).toEqual({ kind: 'previous' });
    expect(readShortcut(press('n'), true)).toEqual({ kind: 'note' });
    expect(readShortcut(press('v'), true)).toEqual({ kind: 'steam' });
    expect(readShortcut(press('f'), true)).toEqual({ kind: 'filter' });
    expect(readShortcut(press('g'), true)).toEqual({ kind: 'goStart' });
  });

  it('C, P y A: las tres marcas', () => {
    for (const flag of FLAGS) {
      expect(readShortcut(press(FLAG_SHORTCUTS[flag].toLowerCase()), true)).toEqual({
        kind: 'flag',
        flag,
      });
    }
  });

  it('1–5 por `event.code`: también con Mayús o en otro teclado', () => {
    STATUSES.forEach((status, index) => {
      const digit = String(index + 1);
      expect(readShortcut(press(digit, { code: `Digit${digit}` }), true)).toEqual({
        kind: 'status',
        status,
      });
      expect(readShortcut(press(digit, { code: `Numpad${digit}` }), true)).toEqual({
        kind: 'status',
        status,
      });
    });
    // Mayús+1 en el teclado español da «!»; en AZERTY, el 1 sin Mayús da «&».
    expect(readShortcut(press('!', { code: 'Digit1', shiftKey: true }), true)).toEqual({
      kind: 'status',
      status: 'want_to_play',
    });
    expect(readShortcut(press('&', { code: 'Digit1' }), true)).toEqual({
      kind: 'status',
      status: 'want_to_play',
    });
    expect(readShortcut(press('6', { code: 'Digit6' }), true)).toBeNull();
    expect(readShortcut(press('0', { code: 'Digit0' }), true)).toBeNull();
  });

  it("`?` con Mayús (en el teclado español es Mayús+'), `+` y Supr", () => {
    expect(readShortcut(press('?', { code: 'Minus', shiftKey: true }), true)).toEqual({
      kind: 'help',
    });
    expect(readShortcut(press('+', { code: 'BracketRight' }), true)).toEqual({ kind: 'capture' });
    expect(readShortcut(press('Delete', { code: 'Delete' }), true)).toEqual({ kind: 'remove' });
  });

  it('G y luego L, C o A; cualquier otra cosa no hace nada', () => {
    expect(readShortcut(press('l'), true, true)).toEqual({ kind: 'go', to: 'list' });
    expect(readShortcut(press('c'), true, true)).toEqual({ kind: 'go', to: 'catalog' });
    expect(readShortcut(press('A', { shiftKey: true }), true, true)).toEqual({
      kind: 'go',
      to: 'settings',
    });
    expect(readShortcut(press('j'), true, true)).toBeNull();
    expect(readShortcut(press('1', { code: 'Digit1' }), true, true)).toBeNull();
  });

  it('Alt+↑ y Alt+↓, también con las teclas de una pulsación apagadas', () => {
    for (const singleKeys of [true, false]) {
      expect(readShortcut(press('ArrowUp', { altKey: true }), singleKeys)).toEqual({
        kind: 'priority',
        to: 'up',
      });
      expect(readShortcut(press('ArrowDown', { altKey: true }), singleKeys)).toEqual({
        kind: 'priority',
        to: 'down',
      });
    }
    // `Alt+Mayús` cambia el idioma de entrada en Windows; `Ctrl+Alt` es AltGr.
    expect(readShortcut(press('ArrowUp', { altKey: true, shiftKey: true }), true)).toBeNull();
    expect(readShortcut(press('ArrowUp', { altKey: true, ctrlKey: true }), true)).toBeNull();
  });

  it('con Ctrl, Alt, Win/Cmd o una composición en marcha, ninguna tecla suelta actúa', () => {
    for (const extra of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      expect(readShortcut(press('j', extra), true)).toBeNull();
      expect(readShortcut(press('1', { code: 'Digit1', ...extra }), true)).toBeNull();
      expect(readShortcut(press('Delete', { code: 'Delete', ...extra }), true)).toBeNull();
    }
    expect(readShortcut(press('j', { isComposing: true }), true)).toBeNull();
    // AltGr llega como Ctrl+Alt: «@» en el teclado español (AltGr+2) no es el estado 2.
    expect(readShortcut(press('@', { code: 'Digit2', ctrlKey: true, altKey: true }), true)).toBe(
      null,
    );
  });

  it('con «Atajos de una tecla» apagado, ninguna tecla suelta actúa (WCAG 2.1.4)', () => {
    for (const key of ['j', 'k', 'n', 'v', 'f', 'g', 'c', 'p', 'a', '?', '+', 'Delete']) {
      expect(readShortcut(press(key), false)).toBeNull();
    }
    expect(readShortcut(press('1', { code: 'Digit1' }), false)).toBeNull();
    expect(readShortcut(press('l'), false, true)).toBeNull();
  });
});

describe('shortcutFor y trackGoSequence (la secuencia «G»)', () => {
  const at = (key: string, timeStamp: number) => ({ ...press(key), timeStamp });

  it('«G» y luego «C» antes de 1,5 s va al Catálogo; después, «C» vuelve a ser Comprado', () => {
    const g = at('g', 1000);
    trackGoSequence(g, shortcutFor(g, true));
    // Mayús sola (para una mayúscula) no corta la secuencia.
    trackGoSequence(at('Shift', 1100), null);
    expect(shortcutFor(at('c', 1200), true)).toEqual({ kind: 'go', to: 'catalog' });
    trackGoSequence(at('c', 1200), { kind: 'go', to: 'catalog' });
    expect(shortcutFor(at('c', 1300), true)).toEqual({ kind: 'flag', flag: 'owned' });
  });

  it('pasado el plazo, la segunda tecla es la de siempre', () => {
    const g = at('g', 5000);
    trackGoSequence(g, shortcutFor(g, true));
    expect(shortcutFor(at('c', 6600), true)).toEqual({ kind: 'flag', flag: 'owned' });
    trackGoSequence(at('c', 6600), null);
  });
});

describe('shortcutGroups (la ayuda)', () => {
  const groups = shortcutGroups({ status: es.status, flag: es.flag, text: es.shortcuts.text });
  const combos = groups.flatMap((group) => group.rows.flatMap((row) => row.combos));

  it('ningún atajo usa Ctrl+Alt, Alt+Mayús ni teclas que pidan AltGr (§9.4; CA3.4)', () => {
    for (const combo of combos) {
      const keys = combo.keys;
      expect(keys.includes('Ctrl') && keys.includes('Alt'), keys.join('+')).toBe(false);
      expect(keys.includes('Alt') && keys.includes('Mayús'), keys.join('+')).toBe(false);
      for (const key of keys) expect('@#[]{}\\|~€').not.toContain(key);
    }
  });

  it('cada tecla suelta de la ayuda es un atajo de verdad', () => {
    const single = combos.filter(
      (combo) => combo.keys.length === 1 && /^[A-Z?+1-5]$/.test(combo.keys[0] ?? ''),
    );
    expect(single.length).toBeGreaterThan(10);
    for (const { keys } of single) {
      const key = keys[0] ?? '';
      const code = /^[1-5]$/.test(key) ? `Digit${key}` : `Key${key}`;
      expect(readShortcut(press(key.toLowerCase(), { code }), true), key).not.toBeNull();
    }
  });

  it('las secuencias con G llevan a Mi lista, al Catálogo y a Ajustes', () => {
    const sequences = combos.filter((combo) => combo.sequence);
    expect(sequences.map((combo) => combo.keys.join(' '))).toEqual(['G L', 'G C', 'G A']);
    for (const { keys } of sequences) {
      expect(readShortcut(press((keys[0] ?? '').toLowerCase()), true)).toEqual({
        kind: 'goStart',
      });
      expect(readShortcut(press((keys[1] ?? '').toLowerCase()), true, true)?.kind).toBe('go');
    }
  });
});
