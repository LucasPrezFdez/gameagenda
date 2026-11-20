// Las cabeceras de `ga-web` (`apps/web/public/_headers`) que ningún E2E ve: la vista previa de
// Playwright no sirve ese fichero. La `Permissions-Policy` apaga todo lo que la app no usa, pero
// tiene que dejar las llaves de acceso en su origen (ADR-013): con `publickey-credentials-get=()`,
// el navegador rechaza `navigator.credentials.get()` antes de enseñar nada.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function header(name: string): string {
  const text = readFileSync('apps/web/public/_headers', 'utf8');
  const line = text.split('\n').find((l) => l.trimStart().startsWith(`${name}:`));
  if (line === undefined) throw new Error(`_headers no lleva ${name}`);
  return line.slice(line.indexOf(':') + 1).trim();
}

function directives(policy: string): Map<string, string> {
  return new Map(
    policy.split(',').map((part) => {
      const [feature = '', allow = ''] = part.trim().split('=');
      return [feature, allow];
    }),
  );
}

describe('Permissions-Policy de ga-web', () => {
  const policy = directives(header('Permissions-Policy'));

  it('deja crear y usar llaves de acceso en el propio origen', () => {
    expect(policy.get('publickey-credentials-create')).toBe('(self)');
    expect(policy.get('publickey-credentials-get')).toBe('(self)');
  });

  it('el resto sigue apagado', () => {
    for (const [feature, allow] of policy) {
      if (feature.startsWith('publickey-credentials-')) continue;
      expect(allow, feature).toBe('()');
    }
  });
});
