// Atajos de teclado de M3 (§9.4): de una pulsación a una acción, sin DOM, para que lo usen todas
// las pantallas igual y se pruebe en Vitest. Las teclas sueltas no actúan con Ctrl, Alt ni
// Win/Cmd ni con `isComposing`; con Mayús sí (en el teclado español, `?` es Mayús+'). Letras y
// signos por `event.key`, sin distinguir mayúsculas, y dígitos por `event.code`. Nada usa
// `Ctrl+Alt` (es AltGr), teclas que piden AltGr ni `Alt+Mayús`. Quien llama descarta antes los
// campos de texto (`isEditableTarget`) y los menús abiertos.
import { type Flag, STATUSES, type Status } from '../agenda/types.ts';

export type GoTarget = 'list' | 'catalog' | 'settings';

export type ShortcutAction =
  /** `?`: la ayuda con todos los atajos. */
  | { readonly kind: 'help' }
  /** `G`: empieza «ir a»; la siguiente tecla dice adónde. */
  | { readonly kind: 'goStart' }
  /** `G` y luego `L`, `C` o `A`: Mi lista, Catálogo o Ajustes. */
  | { readonly kind: 'go'; readonly to: GoTarget }
  /** `J` y `K`: la fila siguiente o la anterior (en la ficha, el juego siguiente o el anterior). */
  | { readonly kind: 'next' }
  | { readonly kind: 'previous' }
  /** `1`–`5`: el estado, en el orden de `STATUSES`. */
  | { readonly kind: 'status'; readonly status: Status }
  /** `C`, `P` y `A`: Comprado, Platinado y Próximo (alternan). */
  | { readonly kind: 'flag'; readonly flag: Flag }
  /** `N`: la nota, en la ficha. */
  | { readonly kind: 'note' }
  /** `Supr`: quitar de la lista (con Deshacer). */
  | { readonly kind: 'remove' }
  /** `Alt+↑` y `Alt+↓`: subir o bajar la prioridad. */
  | { readonly kind: 'priority'; readonly to: 'up' | 'down' }
  /** `V`: Ver en Steam. */
  | { readonly kind: 'steam' }
  /** `F`: el filtro de la pantalla (Mi lista o Catálogo). */
  | { readonly kind: 'filter' }
  /** `+`: apuntar la fila del Catálogo (M1). */
  | { readonly kind: 'capture' };

/** Lo que hace falta de un `KeyboardEvent` (el nativo o el de React). */
export interface KeyInput {
  readonly key: string;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly isComposing?: boolean;
}

/** Cuánto espera «G» a la segunda tecla. */
export const GO_SEQUENCE_MS = 1500;

const GO: Readonly<Record<string, GoTarget>> = { l: 'list', c: 'catalog', a: 'settings' };

const FLAG_KEYS: Readonly<Record<string, Flag>> = { c: 'owned', p: 'platinum', a: 'next' };

const LETTERS: Readonly<Record<string, ShortcutAction>> = {
  g: { kind: 'goStart' },
  j: { kind: 'next' },
  k: { kind: 'previous' },
  n: { kind: 'note' },
  v: { kind: 'steam' },
  f: { kind: 'filter' },
  ...Object.fromEntries(
    Object.entries(FLAG_KEYS).map(([key, flag]) => [key, { kind: 'flag', flag } as const]),
  ),
};

const RE_DIGIT = /^(?:Digit|Numpad)([1-5])$/;

/**
 * La acción de una pulsación, o `null`. `singleKeys` es el ajuste «Atajos de una tecla» (WCAG
 * 2.1.4): apagado, solo queda `Alt+↑/↓`. `afterG`: la tecla anterior fue «G» hace menos de
 * `GO_SEQUENCE_MS`; entonces solo valen `L`, `C` y `A`.
 */
export function readShortcut(
  event: KeyInput,
  singleKeys: boolean,
  afterG = false,
): ShortcutAction | null {
  if (event.isComposing) return null;
  if (event.altKey) {
    if (event.ctrlKey || event.metaKey || event.shiftKey) return null;
    if (event.key === 'ArrowUp') return { kind: 'priority', to: 'up' };
    if (event.key === 'ArrowDown') return { kind: 'priority', to: 'down' };
    return null;
  }
  if (event.ctrlKey || event.metaKey || !singleKeys) return null;
  const key = event.key.toLowerCase();
  if (afterG) {
    const to = GO[key];
    return to ? { kind: 'go', to } : null;
  }
  if (event.key === '?') return { kind: 'help' };
  if (event.key === '+') return { kind: 'capture' };
  if (event.key === 'Delete') return { kind: 'remove' };
  const digit = RE_DIGIT.exec(event.code);
  if (digit) {
    const status = STATUSES[Number(digit[1]) - 1];
    return status ? { kind: 'status', status } : null;
  }
  return LETTERS[key] ?? null;
}

// «G» y luego otra tecla: la segunda llega primero a las filas (React) y después a la carcasa
// (`document`). Todas leen aquí si va detrás de una «G» y solo la carcasa lo cambia; así, «G»
// seguida de «C» va al Catálogo y no marca Comprado en la fila con el foco.
let goAt = Number.NEGATIVE_INFINITY;
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock']);

/** `readShortcut` con la secuencia «G» en curso, si la hay. */
export function shortcutFor(
  event: KeyInput & { readonly timeStamp: number },
  singleKeys: boolean,
): ShortcutAction | null {
  return readShortcut(event, singleKeys, event.timeStamp - goAt < GO_SEQUENCE_MS);
}

/** Lo llama la carcasa tras cada tecla: «G» abre la secuencia y cualquier otra la cierra. */
export function trackGoSequence(
  event: { readonly key: string; readonly timeStamp: number },
  action: ShortcutAction | null,
): void {
  if (MODIFIER_KEYS.has(event.key)) return;
  goAt = action?.kind === 'goStart' ? event.timeStamp : Number.NEGATIVE_INFINITY;
}

/** Una combinación de la ayuda: teclas a la vez (`Ctrl+K`) o una tras otra (`G`, luego `L`). */
export interface KeyCombo {
  readonly keys: readonly string[];
  readonly sequence?: boolean;
}

export interface ShortcutRow {
  /** Alternativas: `Ctrl+K` o `/`. */
  readonly combos: readonly KeyCombo[];
  readonly label: string;
}

export interface ShortcutGroup {
  readonly title: string;
  readonly rows: readonly ShortcutRow[];
}

const one = (...keys: string[]): KeyCombo => ({ keys });

/** El mapa de la §9.4, con los nombres de las teclas en español (§9.9). */
export function shortcutGroups(labels: {
  readonly status: Readonly<Record<Status, string>>;
  readonly flag: Readonly<Record<Flag, string>>;
  readonly text: Readonly<Record<ShortcutText, string>>;
}): readonly ShortcutGroup[] {
  const t = labels.text;
  return [
    {
      title: t.global,
      rows: [
        { combos: [one('Ctrl', 'K'), one('/')], label: t.palette },
        { combos: [one('Ctrl', 'Z')], label: t.undo },
        { combos: [one('Ctrl', 'V')], label: t.pasteLink },
        { combos: [one('Esc')], label: t.close },
        { combos: [one('?')], label: t.help },
        { combos: [{ keys: ['G', 'L'], sequence: true }], label: t.goList },
        { combos: [{ keys: ['G', 'C'], sequence: true }], label: t.goCatalog },
        { combos: [{ keys: ['G', 'A'], sequence: true }], label: t.goSettings },
        { combos: [one('F')], label: t.filter },
      ],
    },
    {
      title: t.paletteGroup,
      rows: [
        { combos: [one('↑'), one('↓')], label: t.choose },
        { combos: [one('Intro')], label: t.capture },
        { combos: [one('Ctrl', 'Intro')], label: t.captureAndStay },
        { combos: [one('Alt', 'Intro')], label: t.captureAs },
        { combos: [one('Mayús', 'Intro')], label: t.openSheet },
      ],
    },
    {
      title: t.rows,
      rows: [
        { combos: [one('↑'), one('↓'), one('J'), one('K')], label: t.move },
        { combos: [one('Intro')], label: t.openSheet },
        { combos: [one('+')], label: t.captureRow },
        ...STATUSES.map((status, index) => ({
          combos: [one(String(index + 1))],
          label: labels.status[status],
        })),
        ...(Object.entries(FLAG_KEYS) as [string, Flag][]).map(([key, flag]) => ({
          combos: [one(key.toUpperCase())],
          label: labels.flag[flag],
        })),
        { combos: [one('N')], label: t.note },
        { combos: [one('Supr')], label: t.remove },
        { combos: [one('Alt', '↑'), one('Alt', '↓')], label: t.priority },
        { combos: [one('V')], label: t.steam },
      ],
    },
  ];
}

export type ShortcutText =
  | 'global'
  | 'palette'
  | 'paletteGroup'
  | 'undo'
  | 'close'
  | 'help'
  | 'goList'
  | 'goCatalog'
  | 'goSettings'
  | 'filter'
  | 'choose'
  | 'capture'
  | 'captureAndStay'
  | 'captureAs'
  | 'openSheet'
  | 'rows'
  | 'move'
  | 'captureRow'
  | 'note'
  | 'remove'
  | 'priority'
  | 'steam'
  | 'pasteLink';

/** La tecla de cada marca, para la ayuda y las pruebas. */
export const FLAG_SHORTCUTS: Readonly<Record<Flag, string>> = Object.fromEntries(
  Object.entries(FLAG_KEYS).map(([key, flag]) => [flag, key.toUpperCase()]),
) as Record<Flag, string>;
