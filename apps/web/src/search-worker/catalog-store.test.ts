import { trustedSigningKeys } from '@gameagenda/core/catalog-format';
import { describe, expect, it } from 'vitest';
import {
  CatalogLoadError,
  type CatalogStoreDeps,
  canKeepCore,
  catalogAgeDays,
  compareCatalogVersions,
  createCatalogStore,
  satisfiesMinVersion,
  signingKeysForMode,
} from './catalog-store.ts';
import {
  catalogServer,
  MemoryCacheStorage,
  publish,
  ROWS,
  signManifest,
  subtleWithoutEd25519,
} from './test-helpers.ts';

const BASE = 'http://127.0.0.1/catalog-dev/';

function setup(overrides: Partial<CatalogStoreDeps> = {}) {
  const server = catalogServer(BASE);
  const caches = new MemoryCacheStorage();
  const store = createCatalogStore({
    fetch: server.fetch,
    caches: caches.asCacheStorage(),
    subtle: crypto.subtle,
    baseUrl: BASE,
    appVersion: '0.1.0',
    signingKeys: signingKeysForMode('e2e'),
    ...overrides,
  });
  return { server, caches, store };
}

/** Otra versión del catálogo, con un juego nuevo en cabeza (otro núcleo). */
const NEWER_ROWS = [{ appid: 413150, name: 'Stardew Valley', year: 2016, pop: 39 }, ...ROWS];

describe('versiones', () => {
  it('ordena AAAAMMDD.N por fecha y número', () => {
    expect(compareCatalogVersions('20261028.1', '20261028.2')).toBeLessThan(0);
    expect(compareCatalogVersions('20261029.1', '20261028.9')).toBeGreaterThan(0);
    expect(compareCatalogVersions('20261028.10', '20261028.9')).toBeGreaterThan(0);
    expect(compareCatalogVersions('20261028.1', '20261028.1')).toBe(0);
  });

  it('compara la versión de la app con `minClientVersion`', () => {
    expect(satisfiesMinVersion('0.1.0', '0.0.0')).toBe(true);
    expect(satisfiesMinVersion('0.1.0', '0.1.0')).toBe(true);
    expect(satisfiesMinVersion('0.1.0', '0.2.0')).toBe(false);
    expect(satisfiesMinVersion('1.0.0', '0.9.9')).toBe(true);
  });

  it('cuenta los días naturales entre versiones, también entre meses y años', () => {
    expect(catalogAgeDays('20261028.1', '20261028.3')).toBe(0);
    expect(catalogAgeDays('20261028.1', '20261104.1')).toBe(7);
    expect(catalogAgeDays('20261228.2', '20270105.1')).toBe(8);
    expect(catalogAgeDays('20261030.1', '20261028.1')).toBe(-2);
  });

  it('regla de los 7 días: el núcleo local vale si es el mismo o tiene ≤7 días y hay `recent`', async () => {
    const old = await publish('20261028.1');
    const local = old.texts.coreFile;
    const sameDay = (await publish('20261028.2', NEWER_ROWS)).manifest;
    const week = (await publish('20261104.1', NEWER_ROWS)).manifest;
    const eightDays = (await publish('20261105.1', NEWER_ROWS)).manifest;
    const noRecent = (await publish('20261029.1', NEWER_ROWS, undefined, { recent: null }))
      .manifest;
    expect(canKeepCore(local, old.manifest)).toBe(true);
    expect(canKeepCore(local, sameDay)).toBe(true);
    expect(canKeepCore(local, week)).toBe(true);
    expect(canKeepCore(local, eightDays)).toBe(false);
    expect(canKeepCore(local, noRecent)).toBe(false);
  });
});

describe('firma del manifest (§11.3; CA2.3)', () => {
  it('acepta un manifest firmado con una clave de confianza, también con campos nuevos', async () => {
    const { server, store } = setup();
    const v1 = await publish('20261028.1', ROWS, undefined, { extra: { futureField: { a: 1 } } });
    server.serve(v1);
    const manifest = await store.fetchManifest();
    expect(manifest.version).toBe('20261028.1');
    expect(manifest.sig?.kid).toBe('dev-1');
  });

  it('descarta un manifest sin firma, con otra clave o con la firma de otro contenido', async () => {
    const { server, store } = setup();
    const v1 = await publish('20261028.1');
    const signature = { code: 'signature', retryable: true };

    server.serve(await publish('20261028.1', ROWS, undefined, { sign: false }));
    await expect(store.fetchManifest()).rejects.toMatchObject(signature);

    // Otra clave: el `kid` no está entre los de confianza.
    const { sig: _sig, ...unsigned } = v1.manifest;
    server.serve({ ...v1, manifest: await signManifest(unsigned, 'prod-9') });
    await expect(store.fetchManifest()).rejects.toMatchObject(signature);

    // Manipulado tras firmar: otro recuento, un campo nuevo o la firma de otro manifest.
    server.serve({ ...v1, manifest: { ...v1.manifest, counts: { core: 1, aliases: 1 } } });
    await expect(store.fetchManifest()).rejects.toMatchObject(signature);
    server.serve({ ...v1, manifest: { ...v1.manifest, extra: 'añadido' } as typeof v1.manifest });
    await expect(store.fetchManifest()).rejects.toMatchObject(signature);
    const other = await publish('20261029.1');
    server.serve({ ...v1, manifest: { ...v1.manifest, sig: other.manifest.sig } });
    await expect(store.fetchManifest()).rejects.toMatchObject(signature);
    const bad = { kid: 'dev-1', ed25519: 'AAAA' };
    server.serve({ ...v1, manifest: { ...v1.manifest, sig: bad } });
    await expect(store.fetchManifest()).rejects.toMatchObject(signature);

    // La firma va antes que `minClientVersion`: un manifest sin firma no dice nada.
    const unsignedOld = await publish('20261028.1', ROWS, undefined, {
      sign: false,
      extra: { minClientVersion: '9.0.0' },
    });
    server.serve(unsignedOld);
    await expect(store.fetchManifest()).rejects.toMatchObject(signature);
  });

  it('un build de producción no confía en la clave de desarrollo', async () => {
    expect(signingKeysForMode('production').some((key) => key.use === 'dev')).toBe(false);
    expect(signingKeysForMode('development').map((key) => key.kid)).toContain('dev-1');
    expect(signingKeysForMode('e2e').map((key) => key.kid)).toContain('dev-1');
    expect(signingKeysForMode('test').some((key) => key.use === 'dev')).toBe(false);

    const { server, store } = setup({ signingKeys: signingKeysForMode('production') });
    server.serve(await publish('20261028.1'));
    await expect(store.fetchManifest()).rejects.toMatchObject({ code: 'signature' });
    // Ni siquiera con el gancho de los E2E para navegadores sin Ed25519.
    const hooked = setup({
      signingKeys: trustedSigningKeys({ dev: false }),
      subtle: subtleWithoutEd25519(),
      acceptUnverifiedDevSignature: () => true,
    });
    hooked.server.serve(await publish('20261028.1'));
    await expect(hooked.store.fetchManifest()).rejects.toMatchObject({ code: 'signature' });
  });

  it('sin Ed25519, no acepta ningún manifest y pide otro navegador (RNF-12)', async () => {
    const { server, store } = setup({ subtle: subtleWithoutEd25519() });
    server.serve(await publish('20261028.1'));
    const failure = await store.fetchManifest().catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(CatalogLoadError);
    expect(failure).toMatchObject({ code: 'browser-too-old', retryable: false });
  });

  it('sin Ed25519, la caché sigue valiendo: el catálogo ya verificado se usa (RNF-12)', async () => {
    const caches = new MemoryCacheStorage();
    const first = setup({ caches: caches.asCacheStorage() });
    const v1 = await publish('20261028.1');
    first.server.serve(v1);
    await first.store.download(await first.store.fetchManifest());

    const old = setup({ caches: caches.asCacheStorage(), subtle: subtleWithoutEd25519() });
    old.server.serve(await publish('20261029.1'));
    await expect(old.store.fetchManifest()).rejects.toMatchObject({ code: 'browser-too-old' });
    expect((await old.store.readCached())?.core).toBe(v1.texts.core);
  });

  it('solo en los E2E y sin Ed25519, el gancho acepta sin verificar la clave de desarrollo', async () => {
    const { server, store } = setup({
      subtle: subtleWithoutEd25519(),
      acceptUnverifiedDevSignature: () => true,
    });
    server.serve(await publish('20261028.1'));
    expect((await store.fetchManifest()).version).toBe('20261028.1');
    // Lo que no depende de Ed25519 sigue comprobándose: la firma y su `kid`.
    server.serve(await publish('20261028.1', ROWS, undefined, { sign: false }));
    await expect(store.fetchManifest()).rejects.toMatchObject({ code: 'signature' });
    // Con una clave `prod`, nunca.
    const prodOnly = setup({
      subtle: subtleWithoutEd25519(),
      acceptUnverifiedDevSignature: () => true,
      signingKeys: signingKeysForMode('e2e').map((key) => ({ ...key, use: 'prod' as const })),
    });
    prodOnly.server.serve(await publish('20261028.1'));
    await expect(prodOnly.store.fetchManifest()).rejects.toMatchObject({
      code: 'browser-too-old',
    });
  });
});

describe('createCatalogStore', () => {
  it('descarga, comprueba el sha256 y guarda en `gacat-<versión>` con el manifest', async () => {
    const { server, caches, store } = setup();
    const v1 = await publish('20261028.1', ROWS, undefined, { recent: ROWS.slice(0, 2) });
    server.serve(v1);
    const progress: number[] = [];
    const manifest = await store.fetchManifest();
    const texts = await store.download(manifest, {
      onProgress: (fraction) => progress.push(fraction),
    });
    expect(texts.core).toBe(v1.texts.core);
    expect(texts.recent).toBe(v1.texts.recent);
    expect(texts.aliases).toBe(v1.texts.aliases);
    expect(texts.coreFile).toEqual(v1.texts.coreFile);
    expect(progress.at(-1)).toBe(1);
    expect(await caches.keys()).toEqual(['gacat-20261028.1']);
    const stored = caches.stores.get('gacat-20261028.1');
    const { files } = v1.manifest;
    expect([...(stored?.keys() ?? [])]).toEqual([
      `${BASE}${files.core.path}`,
      `${BASE}${files.aliases.path}`,
      `${BASE}${files.recent?.path}`,
      `${BASE}${files.details?.path}`,
      `${BASE}gacat-local.json`,
      `${BASE}manifest.json`,
    ]);
    // El *manifest* se pide revalidado.
    expect(server.state.requests[0]).toBe(`${BASE}manifest.json`);
    expect(await store.readCached()).toEqual(texts);
  });

  it('sin red, lee el último catálogo válido de la caché (CA1.8)', async () => {
    const { server, store } = setup();
    const v1 = await publish('20261028.1');
    server.serve(v1);
    await store.download(await store.fetchManifest());
    server.state.offline = true;
    await expect(store.fetchManifest()).rejects.toMatchObject({ code: 'network', retryable: true });
    const cached = await store.readCached();
    expect(cached?.manifest.version).toBe('20261028.1');
    expect(cached?.core).toBe(v1.texts.core);
  });

  it('lee una caché de M1: sin `recent` ni `gacat-local.json`, el núcleo es el del manifest', async () => {
    const { caches, store } = setup();
    const v1 = await publish('20261028.1', ROWS, undefined, { recent: null, sign: false });
    const cache = await caches.open('gacat-20261028.1');
    for (const [path, text] of v1.files) await cache.put(`${BASE}${path}`, new Response(text));
    await cache.put(`${BASE}manifest.json`, Response.json(v1.manifest));
    const cached = await store.readCached();
    expect(cached).toMatchObject({ recent: null, core: v1.texts.core });
    expect(cached?.coreFile).toEqual(v1.texts.coreFile);
  });

  it('reintenta sin la caché HTTP un fichero que da error (un 404 cacheado como inmutable)', async () => {
    const server = catalogServer(BASE);
    const v1 = await publish('20261028.1');
    server.serve(v1);
    const core = v1.manifest.files.core.path;
    const coreCalls: (RequestCache | undefined)[] = [];
    const { store } = setup({
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith(core)) {
          coreCalls.push(init?.cache);
          if (coreCalls.length === 1) return new Response('', { status: 404 });
        }
        return server.fetch(input, init);
      }) as typeof fetch,
    });
    const texts = await store.download(await store.fetchManifest());
    expect(texts.core).toBe(v1.texts.core);
    expect(coreCalls).toEqual([undefined, 'reload']);
  });

  it('un fichero que sigue dando 404 falla con `http` y su ruta', async () => {
    const { server, store } = setup();
    const v1 = await publish('20261028.1');
    server.serve(v1);
    const recent = v1.manifest.files.recent?.path as string;
    server.state.missing.add(recent);
    await expect(store.download(await store.fetchManifest())).rejects.toMatchObject({
      code: 'http',
      path: recent,
    });
    expect(await store.readCached()).toBeNull();
  });

  it('rechaza un fichero que no coincide con su sha256 y no lo guarda', async () => {
    const { server, caches, store } = setup();
    server.serve(await publish('20261028.1'));
    const manifest = await store.fetchManifest();
    server.state.corrupt = true;
    const failure = await store.download(manifest).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(CatalogLoadError);
    expect(failure).toMatchObject({ code: 'integrity' });
    expect(await store.readCached()).toBeNull();
    expect(caches.stores.get('gacat-20261028.1')?.size ?? 0).toBe(0);
  });

  it('regla de los 7 días: con un núcleo de ≤7 días baja solo `recent` y lo que cambió (CA2.4)', async () => {
    const { server, caches, store } = setup();
    const v1 = await publish('20261028.1');
    server.serve(v1);
    const first = await store.download(await store.fetchManifest());
    // Al día siguiente: otro núcleo y otros recientes; los alias y el índice, iguales.
    const v2 = await publish('20261029.1', NEWER_ROWS, undefined, {
      recent: NEWER_ROWS.slice(0, 1),
      fileVersion: '20261028.1',
    });
    server.serve(v2);
    server.reset();
    const texts = await store.download(await store.fetchManifest(), { current: first.coreFile });
    expect(server.state.requests).toEqual([
      `${BASE}manifest.json`,
      `${BASE}${v2.manifest.files.recent?.path}`,
    ]);
    expect(texts.coreFile).toEqual(v1.texts.coreFile);
    expect(texts.core).toBe(v1.texts.core);
    expect(texts.recent).toBe(v2.texts.recent);
    // La caché nueva lleva el núcleo anterior y lo apunta en `gacat-local.json`.
    expect(await caches.keys()).toEqual(['gacat-20261029.1']);
    expect(await store.readCached()).toEqual(texts);
  });

  it('regla de los 7 días: baja el núcleo nuevo con más de 7 días, sin `recent` o si se pide', async () => {
    const cases = [
      { version: '20261105.1', options: {} },
      { version: '20261029.1', options: { recent: null } },
      { version: '20261029.1', options: {}, forceCore: true },
    ] as const;
    for (const { version, options, ...rest } of cases) {
      const { server, store } = setup();
      server.serve(await publish('20261028.1'));
      const first = await store.download(await store.fetchManifest());
      const next = await publish(version, NEWER_ROWS, undefined, options);
      server.serve(next);
      const forceCore = 'forceCore' in rest ? rest.forceCore : false;
      const texts = await store.download(await store.fetchManifest(), {
        current: first.coreFile,
        forceCore,
      });
      expect(texts.coreFile, version).toEqual(next.texts.coreFile);
      expect(texts.core).toBe(next.texts.core);
    }
  });

  it('regla de los 7 días: si el núcleo en uso ya no está en la caché, baja el del manifest', async () => {
    const { server, caches, store } = setup();
    server.serve(await publish('20261028.1'));
    const first = await store.download(await store.fetchManifest());
    await caches.delete('gacat-20261028.1');
    const v2 = await publish('20261029.1', NEWER_ROWS);
    server.serve(v2);
    const texts = await store.download(await store.fetchManifest(), { current: first.coreFile });
    expect(texts.coreFile).toEqual(v2.texts.coreFile);
  });

  it('con los detalles apagados no baja el índice de shards', async () => {
    const { server, store } = setup();
    const v1 = await publish('20261028.1', ROWS, undefined, {
      killSwitches: { covers: true, details: true },
    });
    server.serve(v1);
    await store.download(await store.fetchManifest());
    expect(server.state.requests).not.toContain(`${BASE}${v1.manifest.files.details?.path}`);
  });

  it('no borra las cachés que no son de versión (`gacat-details`)', async () => {
    const { server, caches, store } = setup();
    await caches.open('gacat-details');
    server.serve(await publish('20261028.1'));
    await store.download(await store.fetchManifest());
    server.serve(await publish('20261029.1'));
    await store.download(await store.fetchManifest());
    expect((await caches.keys()).sort()).toEqual(['gacat-20261029.1', 'gacat-details']);
  });

  it('salta una caché con un fichero dañado y usa la anterior que sea válida', async () => {
    const { server, caches, store } = setup();
    const v1 = await publish('20261028.1');
    server.serve(v1);
    await store.download(await store.fetchManifest());
    // Una versión más nueva a medias (sin *manifest*) no cuenta.
    await caches.open('gacat-20261030.1');
    expect((await store.readCached())?.manifest.version).toBe('20261028.1');
    const entries = caches.stores.get('gacat-20261028.1');
    const coreUrl = `${BASE}${v1.manifest.files.core.path}`;
    const hit = entries?.get(coreUrl);
    if (!entries || !hit) throw new Error('falta el núcleo en la caché');
    entries.set(coreUrl, { ...hit, body: new TextEncoder().encode('roto').buffer });
    expect(await store.readCached()).toBeNull();
  });

  it('valida el manifest y su `minClientVersion`', async () => {
    const { server, store } = setup();
    server.serve(
      await publish('20261028.1', ROWS, undefined, { extra: { minClientVersion: '9.0.0' } }),
    );
    await expect(store.fetchManifest()).rejects.toMatchObject({
      code: 'client-too-old',
      retryable: false,
    });
    server.serve(await publish('20261028.1', ROWS, undefined, { extra: { format: 'otro' } }));
    await expect(store.fetchManifest()).rejects.toMatchObject({ code: 'manifest' });
  });

  it('sin Cache Storage, descarga igual (y no hay copia local)', async () => {
    const { server, store } = setup({ caches: null });
    server.serve(await publish('20261028.1'));
    const texts = await store.download(await store.fetchManifest());
    expect(texts.manifest.version).toBe('20261028.1');
    expect(await store.readCached()).toBeNull();
  });
});
