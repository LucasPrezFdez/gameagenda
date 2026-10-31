import { describe, expect, it } from 'vitest';
import { deployUrl, refusal } from './catalog-publish.ts';

describe('catalog-publish: solo catalog.yml despliega ga-catalog', () => {
  it('se niega fuera de GitHub Actions (el PC nunca despliega, DECISIONES §10.12)', () => {
    expect(refusal({})).toMatch(/catalog:stage/);
    expect(refusal({ GITHUB_ACTIONS: 'true' })).toMatch(/CATALOG_CLOUDFLARE_/);
    expect(
      refusal({ GITHUB_ACTIONS: 'true', CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a' }),
    ).toBeNull();
  });

  it('saca la URL de workers.dev de la salida de wrangler (NDJSON)', () => {
    const out = [
      '{"type":"wrangler-session","version":1}',
      'no es json',
      '{"type":"deploy","version":1,"worker_name":"ga-catalog","targets":["https://ga-catalog.otra.workers.dev"]}',
    ].join('\n');
    expect(deployUrl(out)).toBe('https://ga-catalog.otra.workers.dev');
    expect(deployUrl('{"type":"deploy","targets":[]}')).toBeNull();
    expect(deployUrl('')).toBeNull();
  });
});
