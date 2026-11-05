// Contraste de los colores de la §9.8 (`apps/web/src/styles/tokens.css`) en los dos temas (WCAG 2.2: 1.4.3 y 1.4.11; CA3.5): texto
// ≥4,5:1 y componentes (foco, bordes de los controles e iconos) ≥3:1. axe mira el texto que ve
// en cada pantalla, pero no el anillo de foco ni los bordes, ni los estados que no salen en las
// pruebas (un chip de cada estado, el fondo de un gesto): esto los comprueba todos en los tokens.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../apps/web/src/styles/tokens.css', import.meta.url), 'utf8');

/** Las variables `--x: #rrggbb` de un bloque. */
function tokensIn(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out[match[1] as string] = (match[2] as string).toLowerCase();
  }
  return out;
}

function blockAfter(start: string): string {
  const at = css.indexOf(start);
  if (at < 0) throw new Error(`No está ${start}`);
  const open = css.indexOf('{', at + start.length - 1);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`Bloque sin cerrar: ${start}`);
}

const light = tokensIn(blockAfter(':root {'));
const darkSystem = tokensIn(blockAfter(':root:not([data-theme="light"]) {'));
const darkChosen = tokensIn(blockAfter(':root[data-theme="dark"] {'));

/** Luminancia relativa de WCAG 2.x. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = Number.parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const STATES = ['want_to_play', 'playing', 'on_hold', 'completed', 'dropped'] as const;
const FLAGS = ['owned', 'platinum', 'next'] as const;
const SURFACES = ['bg', 'surface', 'surface-2'] as const;

/** [primer plano, fondo, mínimo, dónde]. */
type Pair = readonly [string, string, number, string];

const PAIRS: readonly Pair[] = [
  ...SURFACES.flatMap((s): Pair[] => [
    ['text', s, 4.5, 'texto'],
    ['text-muted', s, 4.5, 'texto secundario e iconos'],
    ['accent', s, 3, 'anillo de foco y borde de la paleta'],
    ['control-border', s, 3, 'borde de los controles'],
    ['platinum-metal', s, 3, 'cuerpo del trofeo de Platinado (icono)'],
    ['next', s, 3, 'cabeza de la chincheta de Próximo (icono)'],
  ]),
  ['accent', 'surface', 4.5, 'texto en color de acento (botones sin fondo, «No cumple»)'],
  ['on-accent', 'accent', 4.5, 'botón principal y gesto ← armado'],
  ...[...STATES, ...FLAGS].flatMap((name): Pair[] => [
    [name, `${name}-chip`, 4.5, `chip de ${name}`],
    [name, 'surface', 4.5, `texto de ${name} en una fila`],
  ]),
  // Fondo del gesto → armado: el texto es la superficie sobre el color del estado nuevo.
  ['surface', 'playing', 4.5, 'gesto → hacia Jugando'],
  ['surface', 'completed', 4.5, 'gesto → hacia Completado'],
];

describe.each([
  ['claro', light],
  ['oscuro', darkSystem],
])('contraste del tema %s (WCAG 1.4.3 y 1.4.11)', (_, tokens) => {
  it.each(PAIRS)('%s sobre %s ≥ %d:1 (%s)', (fg, bg, min) => {
    const a = tokens[fg];
    const b = tokens[bg];
    expect(a, `falta --${fg}`).toBeDefined();
    expect(b, `falta --${bg}`).toBeDefined();
    const ratio = contrast(a as string, b as string);
    expect(ratio, `${fg} ${a} sobre ${bg} ${b}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(min);
  });
});

describe('tokens', () => {
  it('el tema oscuro es el mismo con el sistema y elegido en Ajustes', () => {
    expect(darkChosen).toEqual(darkSystem);
  });

  it('cada color del tema claro tiene su versión oscura', () => {
    expect(Object.keys(darkSystem).sort()).toEqual(Object.keys(light).sort());
  });

  it('la fórmula da los valores de referencia de WCAG', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });
});
