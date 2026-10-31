// Detalles por juego y *shards* (§7.6), recientes (§7.6) y *kill switches* (CA2.3).

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detailShardOf,
  detailShardSchema,
  detailsIndexSchema,
  gameDetailsSchema,
} from '@gameagenda/core/catalog-format';
import { afterAll, describe, expect, it } from 'vitest';
import type { Game, StateRow } from '../src/derive.ts';
import {
  buildDetailFiles,
  detailsOf,
  isAssetUrlFormat,
  releaseOf,
  sha256,
} from '../src/details.ts';
import { KILL_SWITCHES_OFF, readKillSwitches } from '../src/kill-switches.ts';
import { markRecent, RECENT_DAYS, recentGames } from '../src/recent.ts';
import { queryResponseSchema, type StoreItem } from '../steam/schemas.ts';
import { fixtureBody } from '../steam/transports.ts';
import { recordedFixtures } from './helpers.ts';

const tmp: string[] = [];
afterAll(() => {
  for (const d of tmp) rmSync(d, { recursive: true, force: true });
});

const item = (over: Partial<StoreItem> = {}): StoreItem => ({ appid: 1, type: 0, ...over });

describe('lanzamiento: [t, p] según coming_soon_display', () => {
  it.each([
    [{ steam_release_date: 100 }, false, [100, 'day']],
    [{}, false, [null, 'day']],
    [{ steam_release_date: 100, coming_soon_display: 'date_full' }, true, [100, 'day']],
    [{ steam_release_date: 100, coming_soon_display: 'date_month' }, true, [100, 'month']],
    [{ steam_release_date: 100, coming_soon_display: 'date_quarter' }, true, [100, 'quarter']],
    [{ steam_release_date: 100, coming_soon_display: 'date_year' }, true, [100, 'year']],
    [{ steam_release_date: 100, coming_soon_display: 'text_comingsoon' }, true, [null, 'soon']],
    [{ steam_release_date: 100, coming_soon_display: 'text_tba' }, true, [null, 'tba']],
    [{ steam_release_date: 100 }, true, [null, 'tba']],
    [{ coming_soon_display: 'date_month' }, true, [null, 'tba']],
    [{ steam_release_date: 100, coming_soon_display: 'coming_soon' }, true, [100, 'year']],
  ] as const)('%o (próximamente: %s) → %o', (release, soon, expected) => {
    expect(
      releaseOf(item({ release: { ...release }, ...(soon ? { is_coming_soon: true } : {}) })),
    ).toEqual(expected);
  });
});

describe('detalles de un juego', () => {
  it('Counter-Strike 2 tal como llega de Query', () => {
    const page = recordedFixtures().find((r) => r.url.includes('%22start%22%3A15'));
    const items = queryResponseSchema.parse(JSON.parse(fixtureBody(page as never))).response
      .store_items;
    const cs2 = items.find((i) => i.appid === 730) as StoreItem;
    const d = detailsOf(730, cs2);
    expect(gameDetailsSchema.parse(d)).toEqual(d);
    expect(d?.[0]).toMatch(/^steam\/apps\/730\/\$\{FILENAME\}\?t=\d+$/);
    // §4.10: el `header.jpg` de CS2 lleva *hash*; se guarda tal cual.
    expect(d?.[2]).toMatch(/^[0-9a-f]{40}\/header\.jpg$/);
    expect(d?.[4][1]).toBeGreaterThan(9_000_000);
  });

  it('rutas validadas: sin asset_url_format válido no hay detalles y un fichero raro es null', () => {
    expect(isAssetUrlFormat(`steam/apps/10/\${FILENAME}?t=1745368572`, 10)).toBe(true);
    expect(isAssetUrlFormat(`steam/apps/10/\${FILENAME}`, 10)).toBe(true);
    expect(isAssetUrlFormat(`steam/apps/11/\${FILENAME}?t=1`, 10)).toBe(false);
    expect(isAssetUrlFormat(`https://evil.example/\${FILENAME}`, 10)).toBe(false);
    expect(detailsOf(10, item({ appid: 10 }))).toBeNull();
    const d = detailsOf(
      4115900,
      item({
        appid: 4115900,
        assets: {
          asset_url_format: `steam/apps/4115900/\${FILENAME}?t=1792270105`,
          // Lo que trajo Query el 29-10-2026 para 4115900.
          library_capsule: 'manuals/0101296eabdb276953fe579ccb3441eb9aa35af6/x.pdf#/../../gsd',
          header: 'dd4862384a7a488137538a98d090c70cffa02714/header.jpg',
        },
        platforms: { windows: true, mac: true, steamos_linux: true, steam_deck_compat_category: 7 },
        reviews: {
          summary_filtered: { review_count: 12, review_score: 12, percent_positive: 140 },
        },
      }),
    );
    expect(d).toEqual([
      `steam/apps/4115900/\${FILENAME}?t=1792270105`,
      null,
      'dd4862384a7a488137538a98d090c70cffa02714/header.jpg',
      [null, 'day'],
      [9, 12, 100],
      7,
      0,
    ]);
  });
});

describe('shards', () => {
  const games = [730, 570, 10, 20, 1245620].map((appid) => ({
    appid,
    details:
      detailsOf(
        appid,
        item({ appid, assets: { asset_url_format: `steam/apps/${appid}/\${FILENAME}?t=1` } }),
      ) ?? undefined,
  }));

  it('1 024 shards por FNV-1a, null en los vacíos, hash en el nombre y esquema de core', () => {
    const f = buildDetailFiles(games, '20261031.1');
    const index = detailsIndexSchema.parse(JSON.parse(f.indexText));
    expect(index.shards).toHaveLength(1024);
    expect(index.shards.filter(Boolean)).toHaveLength(f.shards.size);
    expect(f.shards.has(`details/0765.${index.shards[765]}.json`)).toBe(true);
    expect(f.indexPath).toBe(`details/index.${sha256(f.indexText).slice(0, 16)}.json`);
    for (const [path, text] of f.shards) {
      expect(path).toBe(`details/${path.slice(8, 12)}.${sha256(text).slice(0, 16)}.json`);
      for (const k of Object.keys(detailShardSchema.parse(JSON.parse(text)))) {
        expect(detailShardOf(Number(k))).toBe(Number(path.slice(8, 12)));
      }
    }
    expect(f.games).toBe(5);
  });

  it('el contenido solo depende de los juegos: mismo orden de entrada o no, mismos bytes', () => {
    const a = buildDetailFiles(games, '20261031.1');
    const b = buildDetailFiles([...games].reverse(), '20261031.1');
    expect([...b.shards]).toEqual([...a.shards]);
    // Otra versión cambia el índice, no los shards.
    const c = buildDetailFiles(games, '20261101.1');
    expect([...c.shards]).toEqual([...a.shards]);
    expect(c.indexPath).not.toBe(a.indexPath);
  });
});

describe('recientes', () => {
  const g = (appid: number, name: string, nameEs = ''): Game => ({
    appid,
    name,
    nameEs,
    flags: 0,
    year: 2020,
    reviews: 0,
    pop: 0,
    cls: 'visible',
    enrichedOn: '2026-11-01',
  });
  const s = (appid: number, name: string, extra: Partial<StateRow> = {}): StateRow => ({
    appid,
    name,
    cls: 'visible',
    flags: 0,
    year: 2020,
    reviews: 0,
    enrichedOn: '2026-10-31',
    ...extra,
  });

  it('sin estado (primera versión) no hay altas', () => {
    expect(recentGames(markRecent([g(1, 'A')], new Map(), '2026-11-01'), '2026-11-01')).toEqual([]);
  });

  it('altas, renombrados (name o nameEs) y su ventana de 14 días', () => {
    const state = new Map([
      [1, s(1, 'A')],
      [2, s(2, 'B')],
      [3, s(3, 'C', { nameEs: 'C es' })],
      [4, s(4, 'D', { addedOn: '2026-10-19' })],
      [5, s(5, 'E', { renamedOn: '2026-10-18' })],
    ]);
    const marked = markRecent(
      [g(1, 'A'), g(2, 'B2'), g(3, 'C', 'C español'), g(4, 'D'), g(5, 'E'), g(6, 'F')],
      state,
      '2026-11-01',
    );
    const recent = recentGames(marked, '2026-11-01').map((x) => [x.appid, x.addedOn, x.renamedOn]);
    expect(RECENT_DAYS).toBe(14);
    expect(recent).toEqual([
      [2, undefined, '2026-11-01'],
      [3, undefined, '2026-11-01'],
      // 19-10 → 01-11 son 13 días: sigue; el 18-10, 14 días, ya no.
      [4, '2026-10-19', undefined],
      [6, '2026-11-01', undefined],
    ]);
    expect(marked.find((x) => x.appid === 5)).not.toHaveProperty('renamedOn');
  });
});

describe('kill switches', () => {
  it('pipeline/kill-switches.json: todos apagados; un campo de más o un tipo raro, error', () => {
    const committed = fileURLToPath(new URL('../kill-switches.json', import.meta.url));
    expect(readKillSwitches(committed)).toEqual(KILL_SWITCHES_OFF);
    const d = mkdtempSync(join(tmpdir(), 'ga-ks-'));
    tmp.push(d);
    writeFileSync(join(d, 'a.json'), '{"covers": true, "details": false}');
    expect(readKillSwitches(join(d, 'a.json'))).toEqual({ covers: true, details: false });
    writeFileSync(join(d, 'b.json'), '{"covers": true, "details": false, "boot": true}');
    expect(() => readKillSwitches(join(d, 'b.json'))).toThrow();
    writeFileSync(join(d, 'c.json'), '{"covers": "sí", "details": false}');
    expect(() => readKillSwitches(join(d, 'c.json'))).toThrow();
  });
});
