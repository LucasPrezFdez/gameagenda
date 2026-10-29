import { describe, expect, it } from 'vitest';
import {
  CatalogLoadError,
  compareCatalogVersions,
  createCatalogStore,
  satisfiesMinVersion,
} from './catalog-store.ts';
import { catalogServer, MemoryCacheStorage, publish } from './test-helpers.ts';

const BASE = 'http://127.0.0.1/catalog-dev/';

function setup() {
  const server = catalogServer(BASE);
  const caches = new MemoryCacheStorage();
  const store = createCatalogStore({
    fetch: server.fetch,
    caches: caches.asCacheStorage(),
    subtle: crypto.subtle,
    baseUrl: BASE,
    appVersion: '0.1.0',
  });
  return { server, caches, store };
}

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
});

describe('createCatalogStore', () => {
  it('descarga, comprueba el sha256 y guarda en `gacat-<versión>` con el manifest', async () => {
    const { server, caches, store } = setup();
    const v1 = await publish('20261028.1');
    server.serve(v1);
    const progress: number[] = [];
    const manifest = await store.fetchManifest();
    const texts = await store.download(manifest, (fraction) => progress.push(fraction));
    expect(texts.core).toBe(v1.texts.core);
    expect(texts.aliases).toBe(v1.texts.aliases);
    expect(progress.at(-1)).toBe(1);
    expect(await caches.keys()).toEqual(['gacat-20261028.1']);
    const stored = caches.stores.get('gacat-20261028.1');
    expect([...(stored?.keys() ?? [])]).toEqual([
      `${BASE}${v1.manifest.files.core.path}`,
      `${BASE}${v1.manifest.files.aliases.path}`,
      `${BASE}manifest.json`,
    ]);
    // El *manifest* se pide revalidado.
    expect(server.state.requests[0]).toBe(`${BASE}manifest.json`);
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

  it('una versión nueva sustituye a la anterior y reutiliza los ficheros iguales', async () => {
    const { server, caches, store } = setup();
    server.serve(await publish('20261028.1'));
    await store.download(await store.fetchManifest());
    const v2 = await publish('20261029.1');
    server.serve(v2);
    server.state.requests.length = 0;
    await store.download(await store.fetchManifest());
    expect(await caches.keys()).toEqual(['gacat-20261029.1']);
    expect((await store.readCached())?.manifest.version).toBe('20261029.1');
    // Cada fichero lleva la versión en la cabecera: con otra versión cambia su *hash* y se baja.
    expect(server.state.requests).toContain(`${BASE}${v2.manifest.files.core.path}`);
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
    const v1 = await publish('20261028.1');
    server.serve({ ...v1, manifest: { ...v1.manifest, minClientVersion: '9.0.0' } });
    await expect(store.fetchManifest()).rejects.toMatchObject({
      code: 'client-too-old',
      retryable: false,
    });
    server.serve({ ...v1, manifest: { ...v1.manifest, format: 'otro' as 'gacat' } });
    await expect(store.fetchManifest()).rejects.toMatchObject({ code: 'manifest' });
  });

  it('sin Cache Storage, descarga igual (y no hay copia local)', async () => {
    const server = catalogServer(BASE);
    server.serve(await publish('20261028.1'));
    const store = createCatalogStore({
      fetch: server.fetch,
      caches: null,
      subtle: crypto.subtle,
      baseUrl: BASE,
      appVersion: '0.1.0',
    });
    const texts = await store.download(await store.fetchManifest());
    expect(texts.manifest.version).toBe('20261028.1');
    expect(await store.readCached()).toBeNull();
  });
});
