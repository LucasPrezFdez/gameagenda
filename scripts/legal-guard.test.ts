// CA4.7 (§11.2 de prototipe.md): la micro-API no se enciende sin los textos legales publicados. Si
// `apps/web/wrangler.jsonc` pone `SYNC_ENABLED` a "1", el responsable (`legal/controller.ts`) tiene
// que tener nombre y correo: si no, la política diría «pendiente» justo cuando empieza a valer.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTROLLER, controllerReady } from '../apps/web/src/legal/controller.ts';

/** JSONC → JSON: fuera los comentarios de línea y de bloque (sin tocar las cadenas). */
function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (inString) {
      out += char;
      if (char === '\\') {
        out += next ?? '';
        i++;
      } else if (char === '"') {
        inString = false;
      }
    } else if (char === '"') {
      inString = true;
      out += char;
    } else if (char === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (char === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else {
      out += char;
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

describe('textos legales antes de encender la micro-API (CA4.7)', () => {
  it('con SYNC_ENABLED a "1", el responsable tiene nombre y correo', () => {
    const config = JSON.parse(
      stripJsonComments(readFileSync('apps/web/wrangler.jsonc', 'utf8')),
    ) as { vars?: Record<string, string> };
    const enabled = config.vars?.SYNC_ENABLED === '1';
    if (enabled) expect(controllerReady(CONTROLLER), 'apps/web/src/legal/controller.ts').toBe(true);
    else expect(config.vars?.SYNC_ENABLED).toBe('0');
  });
});
