import { describe, expect, it } from 'vitest';
import {
  checkStage,
  isStatePath,
  latestStateAsset,
  type Stage,
  stageSchema,
  stateAssetName,
  stateAssets,
  stateAssetsToPrune,
} from './catalog-release.ts';

describe('catalog-release: copias del estado en la Release catalog-state', () => {
  it('nombra las copias por versión y elige la más alta (con N de varias cifras)', () => {
    expect(stateAssetName('20261031.1')).toBe('state-20261031.1.tgz');
    expect(() => stateAssetName('2026-10-31')).toThrow();
    const names = [
      'state-20261030.1.tgz',
      'state-20261031.9.tgz',
      'otro.tgz',
      'state-20261031.10.tgz',
      'state-20261029.3.tgz',
    ];
    expect(stateAssets(names)).toEqual([
      'state-20261031.10.tgz',
      'state-20261031.9.tgz',
      'state-20261030.1.tgz',
      'state-20261029.3.tgz',
    ]);
    expect(latestStateAsset(names)).toBe('state-20261031.10.tgz');
    expect(latestStateAsset(['stage.tgz'])).toBeNull();
  });

  it('deja las 7 copias más recientes', () => {
    const names = Array.from({ length: 9 }, (_, i) => `state-202610${String(20 + i)}.1.tgz`);
    expect(stateAssetsToPrune(names)).toEqual(['state-20261021.1.tgz', 'state-20261020.1.tgz']);
    expect(stateAssetsToPrune(names.slice(0, 7))).toEqual([]);
  });

  it('el estado no lleva páginas crudas, informes ni rechazados', () => {
    expect(isStatePath('master.ndjson.gz')).toBe(true);
    expect(isStatePath('history/recent.ndjson.gz')).toBe(true);
    for (const p of [
      'raw-2026-10-31/',
      'raw-2026-10-31/q.json.gz',
      'raw/x',
      'reports/',
      'rejected/x',
    ]) {
      expect(isStatePath(p), p).toBe(false);
    }
  });
});

describe('catalog-release: lo que sube catalog:stage', () => {
  const now = Date.parse('2026-10-31T10:00:00Z');
  const stage: Stage = stageSchema.parse({
    format: 'gacat-stage',
    v: 1,
    createdAt: '2026-10-31T09:20:00Z',
    runAt: '2026-10-31T09:05:00Z',
    keyless: false,
    skipDeltaGates: false,
    stateAsset: 'state-20261030.1.tgz',
    stateSha256: 'a'.repeat(64),
    commit: null,
    pcVersion: '20261031.1',
  });
  const current = { asset: 'state-20261030.1.tgz', sha256: 'a'.repeat(64), now };

  it('vale si se construyó con el estado vigente y es reciente', () => {
    expect(() => checkStage(stage, current)).not.toThrow();
  });

  it('no vale si el estado ha cambiado desde entonces (se publicó otra versión)', () => {
    expect(() => checkStage(stage, { ...current, asset: 'state-20261031.1.tgz' })).toThrow(
      /vuelve a lanzar npm run catalog:stage/,
    );
    expect(() => checkStage(stage, { ...current, sha256: 'b'.repeat(64) })).toThrow(/SHA-256/);
    expect(() => checkStage({ ...stage, stateAsset: null, stateSha256: null }, current)).toThrow();
  });

  it('no vale si tiene más de 36 h o una fecha futura', () => {
    expect(() => checkStage(stage, { ...current, now: now + 36 * 3600_000 })).toThrow(/36 h/);
    expect(() => checkStage({ ...stage, runAt: '2026-10-31T11:00:00Z' }, current)).toThrow(
      /futura/,
    );
  });

  it('el esquema rechaza un stage.json de otro formato', () => {
    expect(stageSchema.safeParse({ ...stage, format: 'otro' }).success).toBe(false);
    expect(stageSchema.safeParse({ ...stage, stateSha256: 'corto' }).success).toBe(false);
  });
});
