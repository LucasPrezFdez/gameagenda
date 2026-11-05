// Contraste de una dirección del rediseño con los mismos pares que `tokens-contrast.test.ts`.
// Los tokens que la dirección no redefine salen de `apps/web/src/styles/tokens.css`.
//
//   node scripts/rediseno-contraste.ts docs/diseno/rediseno-visual/direccion-a.css

import { readFileSync } from 'node:fs';

const base = readFileSync(new URL('../apps/web/src/styles/tokens.css', import.meta.url), 'utf8');
const file = process.argv[2];
if (!file) throw new Error('Falta la hoja de la dirección');
const direction = readFileSync(file, 'utf8');

function tokensIn(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out[match[1] as string] = (match[2] as string).toLowerCase();
  }
  return out;
}

function blockAfter(css: string, start: string): string {
  const at = css.indexOf(start);
  if (at === -1) return '';
  const open = css.indexOf('{', at + start.length - 1);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  return '';
}

const themes = {
  claro: ':root {',
  oscuro: ':root:not([data-theme="light"]) {',
  'oscuro (elegido)': ':root[data-theme="dark"] {',
} as const;

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = Number.parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
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
type Pair = readonly [string, string, number];
const PAIRS: readonly Pair[] = [
  ...SURFACES.flatMap((s): Pair[] => [
    ['text', s, 4.5],
    ['text-muted', s, 4.5],
    ['accent', s, 3],
    ['control-border', s, 3],
  ]),
  ['accent', 'surface', 4.5],
  ['on-accent', 'accent', 4.5],
  ...[...STATES, ...FLAGS].flatMap((name): Pair[] => [
    [name, `${name}-chip`, 4.5],
    [name, 'surface', 4.5],
    // El icono de estado va ahora sobre el fondo y sobre la fila resaltada (≥3:1, WCAG 1.4.11).
    [name, 'bg', 3],
    [name, 'surface-2', 3],
  ]),
  ['surface', 'playing', 4.5],
  ['surface', 'completed', 4.5],
];

let failures = 0;
for (const [theme, start] of Object.entries(themes)) {
  const tokens = {
    ...tokensIn(blockAfter(base, start)),
    ...tokensIn(blockAfter(direction, start)),
  };
  if (theme !== 'claro') {
    // Los bloques oscuros heredan lo que no redefinen del claro (p. ej., los tokens nuevos).
    for (const [k, v] of Object.entries(tokensIn(blockAfter(direction, ':root {')))) {
      tokens[k] ??= v;
    }
  }
  const rows = PAIRS.map(([fg, bg, min]) => {
    const ratio = contrast(tokens[fg] as string, tokens[bg] as string);
    return { fg, bg, min, ratio, ok: ratio >= min };
  });
  const bad = rows.filter((r) => !r.ok);
  failures += bad.length;
  const worst = [...rows].sort((x, y) => x.ratio / x.min - y.ratio / y.min).slice(0, 4);
  console.log(`\n${theme}: ${rows.length - bad.length}/${rows.length} pares cumplen`);
  for (const r of bad) {
    console.log(`  ✗ ${r.fg} sobre ${r.bg}: ${r.ratio.toFixed(2)}:1 (mínimo ${r.min})`);
  }
  console.log(
    `  más justos: ${worst.map((r) => `${r.fg}/${r.bg} ${r.ratio.toFixed(2)}`).join(' · ')}`,
  );
  const key = ['text', 'text-muted', 'accent', 'control-border'].map(
    (t) => `${t} ${contrast(tokens[t] as string, tokens.surface as string).toFixed(2)}`,
  );
  console.log(`  sobre surface: ${key.join(' · ')}`);
}
process.exitCode = failures > 0 ? 1 : 0;
