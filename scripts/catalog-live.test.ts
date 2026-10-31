import { describe, expect, it } from 'vitest';
import {
  catalogUrl,
  compareVersions,
  type FetchLike,
  mapLimit,
  nextVersion,
  readLiveManifest,
} from './catalog-live.ts';

describe('catalog-live: versiones del catálogo publicado', () => {
  it('ordena AAAAMMDD.N por día y por N numérico', () => {
    expect(compareVersions('20261031.2', '20261031.10')).toBeLessThan(0);
    expect(compareVersions('20261101.1', '20261031.9')).toBeGreaterThan(0);
    expect(compareVersions('20261031.1', '20261031.1')).toBe(0);
    expect(() => compareVersions('20261031', '20261031.1')).toThrow();
  });

  it('la siguiente versión es posterior a la publicada, con el día de Madrid', () => {
    // 04:17 UTC del 31-10-2026 son las 05:17 en Madrid (CET).
    const run = Date.parse('2026-10-31T04:17:00Z');
    expect(nextVersion(run, null)).toBe('20261031.1');
    expect(nextVersion(run, '20261030.1')).toBe('20261031.1');
    expect(nextVersion(run, '20261031.1')).toBe('20261031.2');
    // Un catalog:stage del día anterior, publicado cuando ya hay una versión de hoy.
    expect(nextVersion(Date.parse('2026-10-30T22:00:00Z'), '20261031.1')).toBe('20261031.2');
    // 23:30 UTC ya es el día siguiente en Madrid.
    expect(nextVersion(Date.parse('2026-10-31T23:30:00Z'), '20261031.3')).toBe('20261101.1');
  });

  it('construye las URL del origen con o sin barra final', () => {
    expect(catalogUrl('https://c.example.dev', 'manifest.json')).toBe(
      'https://c.example.dev/manifest.json',
    );
    expect(catalogUrl('https://c.example.dev/', 'details/0765.ab.json')).toBe(
      'https://c.example.dev/details/0765.ab.json',
    );
  });

  it('lee el manifest publicado: 404 es «no hay», un manifest roto es un error', async () => {
    const manifest = {
      format: 'gacat',
      v: 1,
      version: '20261030.1',
      generatedAt: '2026-10-30T04:20:00Z',
      counts: { core: 1, aliases: 0 },
      files: {
        core: { path: `core.${'a'.repeat(16)}.tsv`, sha256: 'a'.repeat(64), bytes: 1 },
        aliases: { path: `aliases.${'b'.repeat(16)}.tsv`, sha256: 'b'.repeat(64), bytes: 1 },
      },
      enrichmentAgeDays: 0,
      minClientVersion: '0.0.0',
    };
    const serve =
      (status: number, body: string): FetchLike =>
      async () =>
        new Response(body, { status });
    const live = await readLiveManifest(
      'https://c.example.dev',
      serve(200, JSON.stringify(manifest)),
    );
    expect(live?.manifest.version).toBe('20261030.1');
    expect(await readLiveManifest('https://c.example.dev', serve(404, ''))).toBeNull();
    await expect(
      readLiveManifest('https://c.example.dev', serve(200, '{"format":1}')),
    ).rejects.toThrow(/no cumple el esquema/);
    await expect(readLiveManifest('https://c.example.dev', serve(403, ''))).rejects.toThrow(/403/);
  });

  it('mapLimit conserva el orden y no pasa del límite', async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 4, 2, 3], 2, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, n));
      running--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30]);
    expect(peak).toBe(2);
  });
});
