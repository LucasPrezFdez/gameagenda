// Contrato del catálogo de M2 (§7.6): JSON canónico, firma, *shards* de detalles y recientes.
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyRecent,
  CATALOG_SIGNING_KEYS,
  CatalogFlag,
  type CoreRow,
  canonicalJson,
  coreFromRows,
  coreRowAt,
  DETAIL_SHARDS,
  detailShardOf,
  detailShardPath,
  detailShardSchema,
  detailsIndexSchema,
  fromBase64Url,
  manifestSigningBytes,
  parseCore,
  toBase64Url,
  trustedSigningKeys,
  viewDetails,
} from '../src/catalog-format/index.ts';
import { readFrozen } from './helpers/frozen.ts';

describe('JSON canónico (RFC 8785)', () => {
  it('ordena las claves por unidades UTF-16, sin espacios, también dentro de listas', () => {
    expect(canonicalJson({ b: 1, a: [true, null, { d: 'x', c: 'y' }], é: 0, z: 0 })).toBe(
      '{"a":[true,null,{"c":"y","d":"x"}],"b":1,"z":0,"é":0}',
    );
    // Las cadenas, como `JSON.stringify` (también los escapes).
    expect(canonicalJson({ s: 'línea\n"cita"' })).toBe('{"s":"línea\\n\\"cita\\""}');
    expect(canonicalJson({ a: undefined, b: -0 })).toBe('{"b":0}');
  });

  it('rechaza números que no son enteros seguros', () => {
    expect(() => canonicalJson({ x: 1.5 })).toThrow('enteros');
    expect(() => canonicalJson({ x: Number.NaN })).toThrow('enteros');
  });
});

describe('base64url', () => {
  it('ida y vuelta, sin relleno', () => {
    for (let n = 0; n < 40; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 0xff);
      const text = toBase64Url(bytes);
      expect(text).not.toContain('=');
      expect([...(fromBase64Url(text) ?? [])]).toEqual([...bytes]);
    }
  });

  it('rechaza caracteres ajenos y formas no canónicas', () => {
    expect(fromBase64Url('ab+c')).toBeNull();
    expect(fromBase64Url('a')).toBeNull();
    expect(fromBase64Url('AB')).toBeNull(); // los bits sobrantes no son ceros
    expect(fromBase64Url('AA==')).toEqual(new Uint8Array([0]));
  });
});

describe('firma del manifest', () => {
  const manifest = {
    format: 'gacat',
    v: 1,
    version: '20261031.1',
    killSwitches: { covers: false, details: false },
    futureField: 'también firmado',
    sig: { kid: 'dev-1', ed25519: 'x' },
  };

  it('firma el JSON canónico sin sig, campos desconocidos incluidos', () => {
    const text = new TextDecoder().decode(manifestSigningBytes(manifest));
    expect(text).not.toContain('sig');
    expect(text).toContain('"futureField":"también firmado"');
    expect(text.startsWith('{"format":"gacat","futureField"')).toBe(true);
  });

  it('la clave de desarrollo firma y WebCrypto verifica con su pública de core', async () => {
    const pem = readFileSync(
      new URL('../../../fixtures/signing/dev-catalog-key.pem', import.meta.url),
    );
    const data = manifestSigningBytes(manifest);
    const signature = sign(null, data, createPrivateKey(pem));
    const dev = CATALOG_SIGNING_KEYS.find((k) => k.kid === 'dev-1');
    expect(dev?.use).toBe('dev');
    const raw = fromBase64Url(dev?.ed25519 ?? '');
    expect(raw).toHaveLength(32);
    const key = await crypto.subtle.importKey(
      'raw',
      raw as Uint8Array<ArrayBuffer>,
      'Ed25519',
      false,
      ['verify'],
    );
    expect(
      await crypto.subtle.verify('Ed25519', key, signature, data as Uint8Array<ArrayBuffer>),
    ).toBe(true);
    // Un byte cambiado ya no vale.
    const tampered = new Uint8Array(data);
    tampered[3] = (tampered[3] as number) ^ 1;
    expect(await crypto.subtle.verify('Ed25519', key, signature, tampered)).toBe(false);
    // La firma viaja en base64url y vuelve igual.
    expect([...(fromBase64Url(toBase64Url(signature)) ?? [])]).toEqual([...signature]);
  });

  it('un build de producción no confía en la clave de desarrollo', () => {
    expect(trustedSigningKeys({ dev: false }).some((k) => k.use === 'dev')).toBe(false);
    expect(trustedSigningKeys({ dev: true }).some((k) => k.kid === 'dev-1')).toBe(true);
  });
});

describe('detalles en shards', () => {
  it('reparte con FNV-1a de String(appid) mod 1024 (730 → 0765, §7.6)', () => {
    expect(detailShardOf(730)).toBe(765);
    expect(detailShardPath(765, '0123456789abcdef')).toBe('details/0765.0123456789abcdef.json');
    expect(detailShardPath(7, 'ffffffffffffffff')).toBe('details/0007.ffffffffffffffff.json');
  });

  it('con el núcleo real, los shards quedan parejos (≈192 juegos cada uno)', () => {
    const core = parseCore(readFrozen().core);
    const sizes = new Uint32Array(DETAIL_SHARDS);
    for (const appid of core.appid)
      sizes[detailShardOf(appid)] = (sizes[detailShardOf(appid)] ?? 0) + 1;
    const mean = core.count / DETAIL_SHARDS;
    expect(Math.min(...sizes)).toBeGreaterThan(mean * 0.7);
    expect(Math.max(...sizes)).toBeLessThan(mean * 1.3);
  });

  it('valida el índice y un shard, y da los detalles como objeto', () => {
    const index = {
      format: 'gacat-details-index',
      v: 1,
      version: '20261031.1',
      shards: Array.from({ length: DETAIL_SHARDS }, (_, i) =>
        i === 765 ? '0123456789abcdef' : null,
      ),
    };
    expect(detailsIndexSchema.parse(index).shards[765]).toBe('0123456789abcdef');
    expect(detailsIndexSchema.safeParse({ ...index, shards: [] }).success).toBe(false);
    const shard = detailShardSchema.parse({
      '730': [
        // biome-ignore lint/suspicious/noTemplateCurlyInString: es el marcador literal de Steam.
        'steam/apps/730/${FILENAME}?t=1745368572',
        'library_600x900.jpg',
        'header.jpg',
        [1345489200, 'day'],
        [8, 9953549, 86],
        5,
        2,
      ],
    });
    const view = viewDetails(shard['730'] as NonNullable<(typeof shard)['730']>);
    expect(view).toMatchObject({ releasePrecision: 'day', reviewScore: 8, platforms: 5, deck: 2 });
    expect(
      detailShardSchema.safeParse({ '730': ['f', null, null, [null, 'pronto'], [0, 0, 0], 0, 0] })
        .success,
    ).toBe(false);
  });
});

describe('recientes sobre el núcleo (§7.6)', () => {
  const row = (appid: number, pop: number, extra: Partial<CoreRow> = {}): CoreRow => ({
    appid,
    name: `Juego ${appid}`,
    pop,
    ...extra,
  });
  // No retirados por `pop` (y reseñas) descendentes; los retirados, al final.
  const core = coreFromRows(
    [
      row(500, 40),
      row(300, 30),
      row(900, 30),
      row(100, 30),
      row(800, 10),
      row(700, 10, { flags: CatalogFlag.retired }),
    ],
    { version: '20261024.1' },
  );
  const ids = (c: ReturnType<typeof applyRecent>) => [...c.appid];

  it('sustituye un renombrado en su sitio, con su nombre en español', () => {
    const recent = coreFromRows([row(900, 30, { name: 'Nuevo nombre', nameEs: 'Nombre nuevo' })], {
      version: '20261031.1',
      kind: 'recent',
    });
    const out = applyRecent(core, recent);
    expect(ids(out)).toEqual([500, 300, 900, 100, 800, 700]);
    expect(coreRowAt(out, 2)).toMatchObject({ name: 'Nuevo nombre', nameEs: 'Nombre nuevo' });
    expect(out.version).toBe('20261031.1');
  });

  it('inserta un alta delante de la primera fila con menor pop, o igual pop y menor appid', () => {
    const recent = coreFromRows(
      [row(950, 30), row(200, 30), row(50, 30), row(600, 20), row(1000, 45), row(1, 0)],
      { version: '20261031.1', kind: 'recent' },
    );
    // 950: delante de 300 (igual pop, menor appid). 200: delante de 100. 50: tras 100, antes del
    // bloque de pop 10. 600: delante de 800. 1000: la primera. 1: antes de los retirados.
    expect(ids(applyRecent(core, recent))).toEqual([
      1000, 500, 950, 300, 900, 200, 100, 50, 600, 800, 1, 700,
    ]);
  });

  it('un alta retirada va al final; si recent repite un appid, vale su última fila', () => {
    const recent = coreFromRows(
      [
        row(400, 50, { flags: CatalogFlag.retired }),
        row(300, 30, { name: 'A' }),
        row(300, 30, { name: 'B' }),
      ],
      { version: '20261031.1', kind: 'recent' },
    );
    const out = applyRecent(core, recent);
    expect(ids(out)).toEqual([500, 300, 900, 100, 800, 700, 400]);
    expect(out.name[1]).toBe('B');
    // El núcleo original no cambia.
    expect(core.name[1]).toBe('Juego 300');
  });

  it('con el núcleo real y ≈4 000 recientes, tarda poco y conserva el orden', () => {
    const real = parseCore(readFrozen().core);
    const rows: CoreRow[] = [];
    for (let i = 0; i < 3700; i++) rows.push(row(9_000_000 + i, (i * 7) % 47));
    for (let g = 0; g < 300; g++)
      rows.push({ ...coreRowAt(real, g * 600), name: `Renombrado ${g}` });
    const recent = coreFromRows(rows, { version: '20261031.1', kind: 'recent' });
    const t0 = performance.now();
    const out = applyRecent(real, recent);
    const ms = performance.now() - t0;
    expect(out.count).toBe(real.count + 3700);
    expect(ms).toBeLessThan(200);
    // `pop` sigue sin crecer en las filas no retiradas.
    let prev = 255;
    for (let g = 0; g < out.count; g++) {
      if (((out.flags[g] as number) & CatalogFlag.retired) !== 0) break;
      expect(out.pop[g] as number).toBeLessThanOrEqual(prev);
      prev = out.pop[g] as number;
    }
  });
});
