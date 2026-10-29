import { afterEach, describe, expect, it, vi } from 'vitest';
import * as z from 'zod';
import { catalogManifestSchema } from '../src/catalog-format/index.ts';
import { createExport, parseExport, stringifyExport } from '../src/schemas/index.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Zod sin JIT (CSP sin `unsafe-eval`, §11.3)', () => {
  it('validar una copia o un manifest nunca llama a `Function`', () => {
    const spy = vi.spyOn(globalThis, 'Function');
    const text = stringifyExport(
      createExport({ entries: [], exportedAt: '2026-10-29T12:00:00.000Z', appVersion: '0.0.0' }),
    );
    expect(parseExport(text).ok).toBe(true);
    expect(catalogManifestSchema.safeParse({}).success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    expect(z.config().jitless).toBe(true);
  });
});
