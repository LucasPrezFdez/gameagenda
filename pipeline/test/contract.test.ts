// Contrato (§12.2): los esquemas Zod contra los fixtures grabados el 29-10-2026; describen solo
// los campos usados, ignoran los desconocidos y exigen los obligatorios.

import { describe, expect, it } from 'vitest';
import { appListPass } from '../src/app-list.ts';
import { containsKey, filesWithKey } from '../src/fixtures.ts';
import { SteamClient, SteamError } from '../steam/client.ts';
import { endpointOf } from '../steam/endpoints.ts';
import {
  appListResponseSchema,
  getItemsResponseSchema,
  queryResponseSchema,
} from '../steam/schemas.ts';
import { fixtureBody, fixtureTransport } from '../steam/transports.ts';
import { FIXTURES, fakeRuntime, recordedFixtures, syntheticFixtures } from './helpers.ts';

const SCHEMAS = {
  query: queryResponseSchema,
  getitems: getItemsResponseSchema,
  getapplist: appListResponseSchema,
} as const;

describe('fixtures grabados', () => {
  const records = recordedFixtures();

  it('hay de los tres endpoints y todos cumplen su esquema', () => {
    const endpoints = new Set(records.map((r) => endpointOf(r.url)));
    expect([...endpoints].sort()).toEqual(['getapplist', 'getitems', 'query']);
    for (const r of records) {
      const schema = SCHEMAS[endpointOf(r.url) as keyof typeof SCHEMAS];
      expect(schema.safeParse(JSON.parse(fixtureBody(r))).success, r.url).toBe(true);
    }
  });

  it('guardan URL, estado, fecha y cuerpo, sin cabeceras ni clave', () => {
    for (const r of records) {
      expect(Object.keys(r).sort()).toEqual(
        r.synthetic
          ? ['date', 'json', 'status', 'synthetic', 'url']
          : ['date', 'json', 'status', 'url'],
      );
      expect(r.status).toBe(200);
      expect(Number.isNaN(Date.parse(r.date))).toBe(false);
    }
    expect(filesWithKey(FIXTURES, null)).toEqual([]);
  });

  it('Zod quita lo desconocido (assets, categorías…) y conserva lo usado', () => {
    const q = records.find((r) => endpointOf(r.url) === 'query');
    const page = queryResponseSchema.parse(JSON.parse(fixtureBody(q as never)));
    const it0 = page.response.store_items[0] as Record<string, unknown>;
    expect(it0.appid).toBe(10);
    expect(it0).not.toHaveProperty('assets');
    expect(it0).not.toHaveProperty('categories');
    expect(page.response.metadata.total_matching_records).toBeGreaterThan(190_000);
  });

  it('sin include_basic_info siguen llegando is_free, is_early_access, is_coming_soon y content_descriptorids', () => {
    const items = records
      .filter((r) => endpointOf(r.url) === 'getitems')
      .flatMap(
        (r) => getItemsResponseSchema.parse(JSON.parse(fixtureBody(r))).response.store_items,
      );
    const by = (appid: number) => items.find((i) => i.appid === appid);
    expect(records.every((r) => !r.url.includes('include_basic_info'))).toBe(true);
    expect(by(730)?.is_free).toBe(true);
    expect(by(1609230)?.is_early_access).toBe(true);
    expect(by(4354570)?.is_coming_soon).toBe(true);
    expect(by(644560)?.content_descriptorids).toEqual(expect.arrayContaining([3]));
  });
});

describe('obligatorios', () => {
  it('Query exige metadata.total_matching_records y appid y type en cada juego', () => {
    expect(queryResponseSchema.safeParse({ response: { store_items: [] } }).success).toBe(false);
    const base = {
      response: { metadata: { total_matching_records: 1 }, store_items: [] as unknown[] },
    };
    expect(queryResponseSchema.safeParse(base).success).toBe(true);
    base.response.store_items = [{ appid: 1, name: 'x' }];
    expect(queryResponseSchema.safeParse(base).success).toBe(false);
  });

  it('GetItems exige success; con success 15 admite appid 0 y sin tipo', () => {
    const r = (it: unknown) =>
      getItemsResponseSchema.safeParse({ response: { store_items: [it] } }).success;
    expect(r({ appid: 1 })).toBe(false);
    expect(r({ success: 15, appid: 0, name: '' })).toBe(true);
  });

  it('GetAppList vacía (fixture sintético) hace fallar la etapa 1', async () => {
    const c = new SteamClient({
      transport: fixtureTransport(syntheticFixtures()),
      ...fakeRuntime(),
      key: 'K',
    });
    await expect(appListPass(c)).rejects.toThrow('0 juegos');
  });

  it('una petición fuera de los fixtures falla con STEAM_MODE=fixtures', async () => {
    const c = new SteamClient({
      transport: fixtureTransport(recordedFixtures()),
      ...fakeRuntime(),
      key: null,
    });
    await expect(appListPass(c, { maxResults: 7 })).rejects.toBeInstanceOf(SteamError);
  });
});

describe('búsqueda de la clave en los fixtures', () => {
  it('detecta la clave, algo con su forma y la cabecera', () => {
    expect(containsKey('{"a":"0123456789ABCDEF0123456789ABCDEF"}', null)).toBe(true);
    expect(containsKey('x-webapi-key: algo', null)).toBe(true);
    expect(containsKey('mi-clave-secreta', 'mi-clave-secreta')).toBe(true);
    // Los hash de las portadas (sha1 en minúsculas) no cuentan.
    expect(containsKey('162664aa0123456789abcdef0123456789abcdef/header.jpg', null)).toBe(false);
  });
});
