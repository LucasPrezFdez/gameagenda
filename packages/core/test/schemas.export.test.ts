import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type ActionResult,
  addEntry,
  type Entry,
  removeEntry,
  setStatus,
} from '../src/entries/index.ts';
import {
  createExport,
  type ExportFile,
  exportEntryIds,
  importExport,
  parseExport,
  stringifyExport,
} from '../src/schemas/index.ts';
import { formatHlc } from '../src/sync/index.ts';
import { harness } from './actions-harness.ts';
import { NUM_RUNS, opsArb, runBatches } from './arbitraries.ts';
import { sorted, uuids } from './helpers.ts';

const NOW = 1_793_178_900_000;

function must(r: ActionResult | null): ActionResult {
  if (r === null) throw new Error('la acción no ha hecho nada');
  return r;
}

function exportOf(entries: Iterable<Entry>): ExportFile {
  return createExport({
    entries,
    settings: { theme: 'dark', showAdult: false },
    exportedAt: '2026-10-29T10:00:00.000Z',
    appVersion: '0.1.0',
  });
}

/** Importa sobre un estado y devuelve el estado nuevo (como haría la web con bulkPut). */
function importInto(state: ReadonlyMap<string, Entry>, file: ExportFile, nowMs = NOW + 1e9) {
  const result = importExport(file, (id) => state.get(id), { nowMs, newOpId: uuids(9) });
  const next = new Map(state);
  for (const e of result.entries) next.set(e.id, e);
  return { result, state: next };
}

describe('exportar', () => {
  it('lleva el formato, las lápidas y las HLC, sin derivados', () => {
    const h = harness(NOW);
    const a = must(addEntry(undefined, { id: 'steam:730', title: 'CS2' }, h.addCtx())).entry;
    const b = must(addEntry(undefined, { id: 'steam:10', title: 'CS' }, h.addCtx('a0'))).entry;
    const gone = must(removeEntry(b, h.ctx())).entry;
    const file = exportOf([a, gone]);
    expect(file).toMatchObject({
      format: 'gameagenda-export',
      version: 1,
      exportedAt: '2026-10-29T10:00:00.000Z',
      appVersion: '0.1.0',
      settings: { theme: 'dark', showAdult: false },
    });
    expect(file.entries.map((e) => e.id)).toEqual(['steam:10', 'steam:730']);
    expect(file.entries[0]?.deletedAt).not.toBeNull();
    for (const e of file.entries) {
      expect(e).not.toHaveProperty('view');
      expect(e).not.toHaveProperty('lastHlc');
      expect(Object.keys(e.hlc).length).toBeGreaterThan(10);
    }
    const parsed = parseExport(stringifyExport(file));
    expect(parsed).toEqual({ ok: true, file });
  });
});

describe('leer el fichero', () => {
  it('distingue JSON roto, otro formato y datos no válidos', () => {
    expect(parseExport('{')).toMatchObject({ ok: false, error: 'json' });
    expect(parseExport('{"format":"otra-app","version":1}')).toMatchObject({ error: 'format' });
    expect(parseExport('{"format":"gameagenda-export","version":2}')).toMatchObject({
      error: 'format',
    });
    const file = exportOf([]);
    const broken = { ...file, entries: [{ id: 'steam:0' }] };
    expect(parseExport(JSON.stringify(broken))).toMatchObject({ ok: false, error: 'schema' });
  });

  it('exportEntryIds incluye los destinos de los vinculados', () => {
    const h = harness(NOW);
    const m = must(
      addEntry(
        undefined,
        { id: 'manual:0190b6e2-7f3a-7c4e-9d2a-1b2c3d4e5f60', title: 'x' },
        h.addCtx(),
      ),
    ).entry;
    const file = exportOf([{ ...m, mergedInto: 'steam:730' }]);
    expect(exportEntryIds(file).sort()).toEqual([m.id, 'steam:730'].sort());
  });
});

describe('importar', () => {
  function sample() {
    const h = harness(NOW);
    const a = must(addEntry(undefined, { id: 'steam:730', title: 'CS2' }, h.addCtx())).entry;
    const b = must(addEntry(undefined, { id: 'steam:10', title: 'CS' }, h.addCtx('a0'))).entry;
    const c = must(addEntry(undefined, { id: 'steam:20', title: 'TFC' }, h.addCtx('a1'))).entry;
    return { h, a, b, c };
  }

  it('en una base vacía: altas, operaciones ganadoras y la mayor HLC', () => {
    const { a, b } = sample();
    const { result, state } = importInto(new Map(), exportOf([a, b]));
    expect(result.counts).toEqual({ added: 2, changed: 0, removed: 0, rejected: 0 });
    expect(sorted(state.values())).toEqual(sorted([a, b]));
    expect(result.ops).toHaveLength(Object.keys(a.hlc).length + Object.keys(b.hlc).length);
    expect(result.maxHlc).toBe(b.lastHlc);
    expect(result.settings).toEqual({ theme: 'dark', showAdult: false });
  });

  it('cuenta cambios y bajas, y lo más reciente gana', () => {
    const { h, a, b, c } = sample();
    const local = new Map([
      [a.id, a],
      [b.id, b],
      [c.id, c],
    ]);
    const a2 = must(setStatus(a, 'playing', h.ctx())).entry;
    const b2 = must(removeEntry(b, h.ctx())).entry;
    const { result, state } = importInto(local, exportOf([a2, b2, c]));
    expect(result.counts).toEqual({ added: 0, changed: 1, removed: 1, rejected: 0 });
    expect(state.get(a.id)?.status).toBe('playing');
    expect(result.ops.map((o) => `${o.entryId} ${o.field}`).sort()).toEqual(
      ['steam:730 status', 'steam:730 startedAt', 'steam:10 deletedAt'].sort(),
    );
    // Una copia antigua no deshace lo local más reciente.
    const again = importInto(state, exportOf([a, b, c]));
    expect(again.result.entries).toEqual([]);
  });

  it('rechaza las HLC más de 5 min por delante de now + desfase', () => {
    const h = harness(NOW + 10 * 60_000);
    const future = must(addEntry(undefined, { id: 'steam:730', title: 'CS2' }, h.addCtx())).entry;
    const file = exportOf([future]);
    const r = importExport(file, () => undefined, { nowMs: NOW, newOpId: uuids() });
    expect(r.counts).toEqual({ added: 0, changed: 0, removed: 0, rejected: 1 });
    expect(r.entries).toEqual([]);
    const withOffset = importExport(file, () => undefined, {
      nowMs: NOW,
      offsetMs: 6 * 60_000,
      newOpId: uuids(),
    });
    expect(withOffset.counts.added).toBe(1);
    // Justo en el límite se acepta.
    const edge = { ...future, hlc: { ...future.hlc } };
    for (const k of Object.keys(edge.hlc)) {
      edge.hlc[k] = formatHlc({ ms: NOW + 5 * 60_000, counter: 0, node: 'aaaaaaaa' });
    }
    expect(
      importExport(exportOf([edge]), () => undefined, { nowMs: NOW, newOpId: uuids() }).counts
        .added,
    ).toBe(1);
  });

  it('importar dos veces no cambia nada', () => {
    const { a, b } = sample();
    const once = importInto(new Map(), exportOf([a, b]));
    const twice = importInto(once.state, exportOf([a, b]));
    expect(twice.result.entries).toEqual([]);
    expect(twice.result.ops).toEqual([]);
    expect(twice.result.counts).toEqual({ added: 0, changed: 0, removed: 0, rejected: 0 });
  });
});

describe('propiedades de la importación (§12.2, CA1.9)', () => {
  it('importar dos veces el mismo JSON equivale a importarlo una', () => {
    fc.assert(
      fc.property(opsArb(), opsArb(), (local, remote) => {
        const base = runBatches([local]).state;
        const file = exportOf(runBatches([remote]).state.values());
        const once = importInto(base, file);
        const twice = importInto(once.state, file);
        expect(twice.result.entries).toEqual([]);
        expect(twice.result.ops).toEqual([]);
        expect(sorted(twice.state.values())).toEqual(sorted(once.state.values()));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('exportar → importar en una base vacía da entradas idénticas, HLC incluidas', () => {
    fc.assert(
      fc.property(opsArb(), (ops) => {
        const original = runBatches([ops]).state;
        const file = parseExport(stringifyExport(exportOf(original.values())));
        if (!file.ok) throw new Error(file.message);
        const { state } = importInto(new Map(), file.file);
        expect(sorted(state.values())).toEqual(sorted(original.values()));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
