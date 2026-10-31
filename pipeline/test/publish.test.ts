// CA2.2 (§15.5) de punta a punta, sin red: con un Steam de mentira sacado del catálogo real
// (`world.ts`), cada fallo de puerta (recuento, centinela, consulta de humo, calidad de búsqueda y
// tamaño) deja `--out` y el estado como estaban, y el catálogo va a los rechazados; si solo falla
// Query, se publican los nombres de GetAppList y crece `enrichmentAgeDays`. De paso: recientes que
// se aplican sobre el núcleo anterior, *shards*, firma y presupuesto de llamadas (CA2.1).

import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyRecent,
  type CoreCatalog,
  catalogManifestSchema,
  parseCore,
  trustedSigningKeys,
} from '@gameagenda/core/catalog-format';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GateConfig } from '../src/gates.ts';
import { KILL_SWITCHES_OFF } from '../src/kill-switches.ts';
import { EXIT, laterVersion, writeResult } from '../src/output.ts';
import { type BuildResult, buildCatalog, type Profile } from '../src/run.ts';
import { DEV_KID, type Signer, signerFromPem, verifyManifest } from '../src/signing.ts';
import { readState } from '../src/state.ts';
import { SteamClient } from '../steam/client.ts';
import { fakeRuntime } from './helpers.ts';
import {
  evolve,
  frozenWorld,
  readGoldenSet,
  type World,
  worldProfile,
  worldTransport,
} from './world.ts';

const SLOW = { timeout: 120_000 };
const DAY = 86_400_000;
/** Primera ejecución: 2 de noviembre de 2026, a las 05:17 de Madrid. */
const DAY1 = Date.parse('2026-11-02T04:17:00Z');
const golden = readGoldenSet();
const devSigner: Signer = signerFromPem(
  readFileSync(new URL('../../fixtures/signing/dev-catalog-key.pem', import.meta.url), 'utf8'),
  DEV_KID,
);

const tmp: string[] = [];
afterAll(() => {
  for (const d of tmp) rmSync(d, { recursive: true, force: true });
});

interface Site {
  readonly out: string;
  readonly rejected: string;
  readonly state: string;
}

function site(from?: Site): Site {
  const d = mkdtempSync(join(tmpdir(), 'ga-publish-'));
  tmp.push(d);
  const s = {
    out: join(d, 'out'),
    rejected: join(d, 'rejected'),
    state: join(d, 'master.ndjson.gz'),
  };
  if (from) {
    cpSync(from.out, s.out, { recursive: true });
    cpSync(from.state, s.state);
  }
  return s;
}

/** Ficheros de `dir` con su contenido (lo que serviría `ga-catalog`). */
function listing(dir: string): Array<[string, string]> {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) =>
      join(e.parentPath, e.name)
        .slice(dir.length + 1)
        .replaceAll('\\', '/'),
    )
    .sort()
    .map((f) => [f, readFileSync(join(dir, f), 'utf8')]);
}

let base: World;
let profile: Profile;

interface Run {
  readonly result: BuildResult;
  readonly code: number;
  readonly client: SteamClient;
}

async function run(
  world: World,
  at: Site,
  runAt: number,
  gates: Partial<GateConfig> = {},
): Promise<Run> {
  const rt = fakeRuntime(runAt);
  const client = new SteamClient({
    transport: worldTransport(() => world),
    ...rt,
    key: 'CLAVE-DE-PRUEBA',
  });
  const state = readState(at.state);
  const result = await buildCatalog(client, {
    keyless: false,
    profile: { ...profile, gates: { ...profile.gates, ...gates } },
    state: state.rows,
    stateMeta: state.meta,
    dump: null,
    frozen: null,
    golden,
    skipDeltaGates: false,
    runAt,
    previousVersion: laterVersion(state.meta.version, null),
    killSwitches: KILL_SWITCHES_OFF,
    signer: devSigner,
    now: rt.now,
    log: () => {},
  });
  const code = writeResult(result, {
    outDir: at.out,
    rejectedDir: at.rejected,
    statePath: at.state,
  });
  return { result, code, client };
}

const failed = (r: BuildResult): string[] =>
  r.gates.filter((g) => g.status === 'fail').map((g) => g.id);

function coreOf(dir: string): CoreCatalog {
  const m = catalogManifestSchema.parse(
    JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')),
  );
  return parseCore(readFileSync(join(dir, m.files.core.path), 'utf8'));
}

/** Filas de un núcleo como texto, para compararlas. */
const rowsOf = (c: CoreCatalog): string[] =>
  Array.from(
    { length: c.count },
    (_, g) =>
      `${c.appid[g]}\t${c.name[g]}\t${c.nameEs.get(g) ?? ''}\t${c.flags[g]}\t${c.year[g]}\t${c.pop[g]}`,
  );

/** Juegos que se pueden tocar sin rozar el dorado ni los centinelas. */
function plainAppids(w: World): number[] {
  const protectedIds = new Set([
    10,
    730,
    570,
    1245620,
    1086940,
    367520,
    ...golden.flatMap((g) => g.appids),
  ]);
  return [...w.games.keys()].filter((a) => !protectedIds.has(a)).sort((a, b) => a - b);
}

let day1: Site;
let first: Run;

beforeAll(async () => {
  base = frozenWorld(3000);
  profile = worldProfile(base);
  day1 = site();
  first = await run(base, day1, DAY1);
}, 120_000);

describe('día 1: primera versión', () => {
  it('pasa todas las puertas (también las de calidad, con el dorado real) y se firma', () => {
    expect(failed(first.result)).toEqual([]);
    expect(first.code).toBe(EXIT.ok);
    expect(first.result.gates.find((g) => g.id === 'golden')?.status).toBe('pass');
    const m = JSON.parse(readFileSync(join(day1.out, 'manifest.json'), 'utf8'));
    expect(m).toMatchObject({
      version: '20261102.1',
      enrichmentAgeDays: 0,
      minClientVersion: '0.2.0',
      killSwitches: { covers: false, details: false },
      counts: { recent: 0 },
      sig: { kid: 'dev-1' },
    });
    expect(verifyManifest(m, trustedSigningKeys({ dev: true }))).toBe(true);
    // Un campo cambiado después de firmar invalida la firma.
    expect(verifyManifest({ ...m, enrichmentAgeDays: 3 }, trustedSigningKeys({ dev: true }))).toBe(
      false,
    );
    expect(first.result.files.details.games).toBe(first.result.games.length);
    expect(readState(day1.state).meta).toEqual({ version: '20261102.1', enrichedOn: '2026-11-02' });
  });

  it('presupuesto: la clave solo va a GetAppList (CA2.1)', () => {
    const b = first.result.summary.budget as { calls: number; keyed: number; maxPerSecond: number };
    const lists = first.client.records.filter((r) => r.endpoint === 'getapplist').length;
    expect(b.keyed).toBe(lists);
    expect(first.client.records.filter((r) => r.keyed && r.endpoint !== 'getapplist')).toEqual([]);
    expect(b.calls).toBeLessThanOrEqual(230);
    expect(b.maxPerSecond).toBeLessThanOrEqual(0.4);
  });
});

describe('día 2: recientes', () => {
  it(
    'las altas y los renombrados van a recent y, sobre el núcleo del día 1, dan el del día 2',
    SLOW,
    async () => {
      const at = site(day1);
      const world = evolve(base, (games) => {
        // 4 095 reseñas, como las demás de `pop` 24 del mundo: dentro de un mismo `pop`, el cliente
        // coloca el alta por `appid` (§7.6), no por reseñas, y el núcleo siguiente lo recoloca.
        games.set(4_100_001, {
          appid: 4_100_001,
          name: 'Nuevo Popular',
          reviews: 4095,
          flags: 0,
          year: 2026,
        });
        games.set(4_100_002, {
          appid: 4_100_002,
          name: 'Nuevo Sin Reseñas',
          reviews: 0,
          flags: 1,
          year: 2027,
        });
        const [a, b] = plainAppids(base);
        const ga = games.get(a as number);
        const gb = games.get(b as number);
        if (ga) games.set(ga.appid, { ...ga, name: `${ga.name} Remastered` });
        if (gb) games.set(gb.appid, { ...gb, nameEs: `${gb.name} (edición española)` });
      });
      const r = await run(world, at, DAY1 + DAY);
      expect(r.code).toBe(EXIT.ok);
      expect(r.result.version).toBe('20261103.1');
      const recent = parseCore(r.result.files.recentText, 'recent');
      expect(recent.count).toBe(4);
      const after = coreOf(at.out);
      expect(rowsOf(applyRecent(coreOf(day1.out), recent))).toEqual(rowsOf(after));
      // `--out` conserva los ficheros del día 1 (cada despliegue los reincluye) junto a los nuevos.
      const names = new Set(listing(at.out).map(([f]) => f));
      for (const [f] of listing(day1.out))
        if (f !== 'manifest.json') expect(names.has(f)).toBe(true);
      // Al día siguiente siguen en recent (14 días), y el estado lleva sus fechas.
      const again = await run(world, at, DAY1 + 2 * DAY);
      expect(again.result.files.manifest.counts.recent).toBe(4);
      const s = readState(at.state).rows;
      expect(s.get(4_100_001)?.addedOn).toBe('2026-11-03');
      // A los 14 días ya no.
      const later = await run(world, at, DAY1 + 15 * DAY);
      expect(later.result.files.manifest.counts.recent).toBe(0);
    },
  );
});

describe('CA2.2: cada puerta que falla deja --out y el estado como estaban', () => {
  async function rejected(world: World, gates: Partial<GateConfig> = {}): Promise<BuildResult> {
    const at = site(day1);
    const out = listing(at.out);
    const state = readFileSync(at.state);
    const r = await run(world, at, DAY1 + DAY, gates);
    expect(r.code).toBe(EXIT.gates);
    expect(listing(at.out)).toEqual(out);
    expect(readFileSync(at.state).equals(state)).toBe(true);
    // El rechazado se puede ver, pero sin firma.
    const m = JSON.parse(readFileSync(join(at.rejected, 'manifest.json'), 'utf8'));
    expect(m.sig).toBeUndefined();
    return r.result;
  }

  it('recuento: desaparece el 3,5 % de los juegos (≤−2 %)', SLOW, async () => {
    const drop = plainAppids(base).slice(0, Math.ceil(base.games.size * 0.035));
    const r = await rejected(
      evolve(base, (games) => {
        for (const a of drop) games.delete(a);
      }),
    );
    expect(failed(r)).toEqual(['count']);
    expect(r.excluded.filter((e) => e.reason === 'deleted')).toHaveLength(drop.length);
  });

  it('centinela: falta Dota 2 (570)', SLOW, async () => {
    const r = await rejected(evolve(base, (games) => games.delete(570)));
    expect(failed(r)).toEqual(['sentinels']);
  });

  it(
    'consulta de humo: tres juegos nuevos más populares sacan a CS2 del top-3 de «counter strike»',
    SLOW,
    async () => {
      const r = await rejected(
        evolve(base, (games) => {
          for (const [i, name] of [
            'Counter Strike Arena',
            'Counter Strike Zero',
            'Counter Strike Legends',
          ].entries()) {
            games.set(4_200_001 + i, {
              appid: 4_200_001 + i,
              name,
              reviews: 2 ** 25,
              flags: 0,
              year: 2026,
            });
          }
        }),
      );
      expect(failed(r)).toEqual(['smoke']);
    },
  );

  it('calidad de búsqueda: 15 juegos del dorado pierden su nombre', SLOW, async () => {
    const targets = [...new Set(golden.flatMap((g) => g.appids))]
      .filter((a) => ![730, 570, 1245620, 1086940, 367520].includes(a) && base.games.has(a))
      .slice(0, 15);
    const r = await rejected(
      evolve(base, (games) => {
        for (const a of targets) {
          const g = games.get(a);
          if (g)
            games.set(a, {
              appid: a,
              name: `Juego sin nombre ${a}`,
              reviews: g.reviews,
              flags: g.flags,
              year: g.year,
            });
        }
      }),
    );
    expect(failed(r)).toEqual(['golden']);
  });

  it('tamaño: núcleo por encima del máximo con brotli 11', SLOW, async () => {
    const r = await rejected(base, { maxCoreBrotliBytes: 16 * 1024 });
    expect(failed(r)).toEqual(['size']);
  });
});

describe('CA2.2: si solo falla el enriquecimiento', () => {
  it('se publican los nombres de GetAppList y enrichmentAgeDays crece cada día', SLOW, async () => {
    const at = site(day1);
    const [renamed] = plainAppids(base);
    const down = evolve({ ...base, queryStatus: 403 }, (games) => {
      const g = games.get(renamed as number);
      if (g) games.set(g.appid, { ...g, name: `${g.name} Definitive Edition` });
      games.set(4_300_001, {
        appid: 4_300_001,
        name: 'Alta Sin Enriquecer',
        reviews: 900,
        flags: 0,
        year: 2026,
      });
    });
    const d2 = await run(down, at, DAY1 + DAY);
    expect(d2.code).toBe(EXIT.ok);
    expect(d2.result.inputs.enrichmentFailed).toMatchObject({ stage: 'query', kind: 'forbidden' });
    const m2 = catalogManifestSchema.parse(
      JSON.parse(readFileSync(join(at.out, 'manifest.json'), 'utf8')),
    );
    expect(m2.enrichmentAgeDays).toBe(1);
    expect(m2.sig?.kid).toBe('dev-1');
    // Nombres al día; lo demás, del último día bueno (el estado), detalles incluidos.
    const g = (a: number) => d2.result.games.find((x) => x.appid === a);
    expect(g(renamed as number)?.name).toMatch(/Definitive Edition$/);
    expect(g(730)).toMatchObject({ pop: first.result.games.find((x) => x.appid === 730)?.pop });
    expect(g(730)?.details).toEqual(first.result.games.find((x) => x.appid === 730)?.details);
    expect(g(4_300_001)).toMatchObject({ pop: 0, flags: 0 });
    expect(g(4_300_001)?.details).toBeUndefined();
    // Sin Query, H1 sería toda la lista: no se clasifica.
    expect(d2.result.inputs.h1).toEqual([]);
    expect(d2.client.records.filter((r) => r.endpoint === 'getitems')).toEqual([]);
    expect(readState(at.state).meta.enrichedOn).toBe('2026-11-02');

    const d3 = await run(down, at, DAY1 + 2 * DAY);
    expect(d3.code).toBe(EXIT.ok);
    expect(d3.result.files.manifest.enrichmentAgeDays).toBe(2);
    // Vuelve Query: edad 0 y el alta ya tiene sus reseñas y sus detalles.
    const d4 = await run({ ...down, queryStatus: 200 }, at, DAY1 + 3 * DAY);
    expect(d4.result.inputs.enrichmentFailed).toBeNull();
    expect(d4.result.files.manifest.enrichmentAgeDays).toBe(0);
    expect(d4.result.games.find((x) => x.appid === 4_300_001)?.pop).toBeGreaterThan(0);
    expect(d4.result.games.find((x) => x.appid === 4_300_001)?.details).toBeDefined();
    expect(readState(at.state).meta.enrichedOn).toBe('2026-11-05');
  });

  it(
    'una Query que devuelve muy pocos juegos cuenta como caída (cobertura <95 %)',
    SLOW,
    async () => {
      const at = site(day1);
      const transport = worldTransport(() => base);
      const rt = fakeRuntime(DAY1 + DAY);
      const client = new SteamClient({
        ...rt,
        key: 'K',
        // Query corta la lista a la mitad.
        transport: async (req) => {
          const res = await transport(req);
          if (!req.url.includes('/IStoreQueryService/')) return res;
          const body = JSON.parse(res.body);
          body.response.metadata.total_matching_records = 1500;
          return { ...res, body: JSON.stringify(body) };
        },
      });
      const state = readState(at.state);
      const r = await buildCatalog(client, {
        keyless: false,
        profile,
        state: state.rows,
        stateMeta: state.meta,
        dump: null,
        frozen: null,
        golden,
        skipDeltaGates: false,
        runAt: DAY1 + DAY,
        previousVersion: state.meta.version,
        now: rt.now,
        log: () => {},
      });
      expect(r.inputs.enrichmentFailed).toMatchObject({ kind: 'coverage' });
      expect(r.enrichmentAgeDays).toBe(1);
      expect(r.ok).toBe(true);
    },
  );
});
