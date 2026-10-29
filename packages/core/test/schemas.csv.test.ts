import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type ActionResult,
  addEntry,
  type Entry,
  editEntry,
  removeEntry,
  type Status,
  setFlag,
} from '../src/entries/index.ts';
import {
  CSV_COLUMNS,
  type CsvImportContext,
  entriesToCsv,
  importCsv,
  parseCsv,
  type StatusLabels,
} from '../src/schemas/index.ts';
import { createHlcClock } from '../src/sync/index.ts';
import { harness, values } from './actions-harness.ts';
import { MANUAL_1, NODE_A, TODAY, uuids } from './helpers.ts';

const LABELS: StatusLabels = {
  want_to_play: 'Quiero jugar',
  playing: 'Jugando',
  on_hold: 'En pausa',
  completed: 'Completado',
  dropped: 'Abandonado',
};
const HEADER = CSV_COLUMNS.join(';');

function must(r: ActionResult | null): ActionResult {
  if (r === null) throw new Error('la acción no ha hecho nada');
  return r;
}

function csvCtx(lastRank: string | null = null): CsvImportContext {
  const clock = createHlcClock({ now: () => 1_793_178_900_000, node: NODE_A });
  return {
    today: TODAY,
    lastRank,
    nextHlc: () => clock.next(),
    newOpId: uuids(3),
    newManualId: uuids(4),
  };
}

describe('exportar CSV', () => {
  it('UTF-8 con BOM, «;», CRLF, cabecera fija y booleanos 1/0', () => {
    const h = harness();
    let e = must(addEntry(undefined, { id: 'steam:1145350', title: 'Hades II' }, h.addCtx())).entry;
    e = must(setFlag(e, 'platinum', true, h.ctx())).entry;
    e = must(editEntry(e, { platform: 'pc', ownedAt: '2025' }, h.ctx())).entry;
    const csv = entriesToCsv([e], LABELS);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toBe(
      `﻿${HEADER}\r\n` +
        `steam:1145350;Hades II;completed;Completado;1;0;0;pc;${TODAY};;${TODAY};${TODAY};2025;\r\n`,
    );
  });

  it('comillas RFC 4180 y protección contra fórmulas', () => {
    const h = harness();
    const e = must(
      addEntry(
        undefined,
        { id: MANUAL_1, title: '=HYPERLINK("x")', note: 'línea 1\nlínea 2; con "comillas"' },
        h.addCtx(),
      ),
    ).entry;
    const csv = entriesToCsv([e], LABELS);
    const [, row] = csv.slice(1).split('\r\n');
    expect(row?.startsWith(`${MANUAL_1};"'=HYPERLINK(""x"")";want_to_play;Quiero jugar;`)).toBe(
      true,
    );
    expect(csv).toContain('"línea 1\nlínea 2; con ""comillas"""');
    for (const start of ['=', '+', '-', '@']) {
      const n = must(addEntry(undefined, { id: 'steam:1', title: `${start}1` }, h.addCtx())).entry;
      expect(entriesToCsv([n], LABELS)).toContain(`;'${start}1;`);
    }
  });

  it('solo exporta lo visible', () => {
    const h = harness();
    const e = must(addEntry(undefined, { id: 'steam:730', title: 'CS2' }, h.addCtx())).entry;
    const gone = must(removeEntry(e, h.ctx())).entry;
    expect(entriesToCsv([gone], LABELS)).toBe(`﻿${HEADER}\r\n`);
  });
});

describe('parseCsv', () => {
  it('lee comillas, separadores y saltos de línea dentro de comillas', () => {
    expect(parseCsv('﻿a;b\r\n"x;1";"y ""z"""\r\n"l1\r\nl2";\r\n')).toEqual([
      ['a', 'b'],
      ['x;1', 'y "z"'],
      ['l1\r\nl2', ''],
    ]);
  });

  it('admite LF, ignora líneas vacías y detecta comillas sin cerrar', () => {
    expect(parseCsv('a;b\n\n1;2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a;b\r\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a;"b')).toBeNull();
    expect(parseCsv('')).toEqual([]);
  });
});

describe('importar CSV', () => {
  it('solo crea entradas nuevas, con los valores tal cual y al final del orden', () => {
    const csv =
      `${HEADER}\r\n` +
      `steam:730;Counter-Strike 2;playing;Lo que sea;0;1;0;pc;2019;;;;;\r\n` +
      `;Juego manual;;;;;;;;;;;;una nota\r\n`;
    const r = importCsv(csv, () => undefined, csvCtx('a5'));
    if (!r.ok) throw new Error(r.error);
    expect(r.counts).toEqual({ added: 2, changed: 0, removed: 0, rejected: 0 });
    expect(r.errors).toEqual([]);
    const [cs, manual] = r.entries as [Entry, Entry];
    expect(cs).toMatchObject({
      id: 'steam:730',
      status: 'playing',
      flags: { owned: true, platinum: false, next: false },
      platform: 'pc',
      addedAt: '2019',
      startedAt: null,
    });
    expect(manual.id.startsWith('manual:')).toBe(true);
    expect(manual).toMatchObject({ title: 'Juego manual', status: 'want_to_play', addedAt: TODAY });
    expect(manual.note).toBe('una nota');
    expect('a5' < cs.rank && cs.rank < manual.rank).toBe(true);
    // Una HLC por fila: cada fila es una acción.
    expect(new Set(r.ops.filter((o) => o.entryId === cs.id).map((o) => o.hlc)).size).toBe(1);
    expect(cs.hlc.status).not.toBe(manual.hlc.status);
  });

  it('se salta lo que ya está en Mi lista y las filas repetidas', () => {
    const h = harness();
    const existing = must(addEntry(undefined, { id: 'steam:730', title: 'CS2' }, h.addCtx())).entry;
    const csv = `id;title\r\nsteam:730;Otro título\r\nsteam:10;CS\r\nsteam:10;CS otra vez\r\n`;
    const r = importCsv(csv, (id) => (id === existing.id ? existing : undefined), csvCtx());
    if (!r.ok) throw new Error(r.error);
    expect(r.entries.map((e) => e.id)).toEqual(['steam:10']);
    expect(r.skipped).toBe(2);
  });

  it('vuelve a apuntar desde cero una lápida', () => {
    const h = harness();
    const e = must(
      addEntry(undefined, { id: 'steam:730', title: 'CS2', note: 'vieja' }, h.addCtx()),
    ).entry;
    const gone = must(removeEntry(e, h.ctx())).entry;
    const clock = createHlcClock({ now: () => 1_893_178_900_000, node: NODE_A });
    const r = importCsv(`id;title\r\nsteam:730;CS2\r\n`, () => gone, {
      ...csvCtx(),
      nextHlc: () => clock.next(),
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.entries[0]).toMatchObject({ note: '', deletedAt: null, view: 'want_to_play' });
  });

  it('rechaza filas no válidas y dice por qué', () => {
    const csv =
      `${HEADER}\r\n` +
      `steam:0;X;;;;;;;;;;;;\r\n` +
      `steam:1;;;;;;;;;;;;;\r\n` +
      `steam:2;X;Jugando;;;;;;;;;;;\r\n` +
      `steam:3;X;;;sí;;;;;;;;;\r\n` +
      `steam:4;X;;;;;;wii;;;;;;\r\n` +
      `steam:5;X;;;;;;;2019-02-29;;;;;\r\n` +
      `steam:6;X;;;;;;;;;;;;${'n'.repeat(2001)}\r\n` +
      `steam:7;Bien;;;;;;;;;;;;\r\n`;
    const r = importCsv(csv, () => undefined, csvCtx());
    if (!r.ok) throw new Error(r.error);
    expect(r.entries.map((e) => e.id)).toEqual(['steam:7']);
    expect(r.counts).toEqual({ added: 1, changed: 0, removed: 0, rejected: 7 });
    expect(r.errors).toEqual([
      { row: 2, column: 'id', reason: 'invalid-id' },
      { row: 3, column: 'title', reason: 'missing-title' },
      { row: 4, column: 'status', reason: 'invalid-status' },
      { row: 5, column: 'platinum', reason: 'invalid-boolean' },
      { row: 6, column: 'platform', reason: 'invalid-platform' },
      { row: 7, column: 'addedAt', reason: 'invalid-date' },
      { row: 8, column: 'note', reason: 'note-too-long' },
    ]);
  });

  it('rechaza ficheros sin cabecera de título, vacíos o con comillas sin cerrar', () => {
    expect(importCsv('id;name\r\nsteam:1;x\r\n', () => undefined, csvCtx())).toEqual({
      ok: false,
      error: 'missing-title-column',
    });
    expect(importCsv('', () => undefined, csvCtx())).toEqual({ ok: false, error: 'empty' });
    expect(importCsv('title\r\n"x', () => undefined, csvCtx())).toEqual({
      ok: false,
      error: 'unterminated-quote',
    });
  });

  it('propiedad: exportar e importar en una base vacía conserva los valores', () => {
    // Caracteres que ponen a prueba las comillas, el separador y las fórmulas.
    const unit = fc.constantFrom(
      'a',
      'Z',
      ' ',
      ';',
      '"',
      "'",
      '=',
      '+',
      '-',
      '@',
      '\r',
      '\n',
      'é',
      '😀',
    );
    const text = fc.string({ unit, maxLength: 30 });
    const row = fc.record({
      title: text.filter((t) => t.trim() !== '').map((t) => t.trim()),
      note: text,
      status: fc.constantFrom<Status>('want_to_play', 'playing', 'on_hold', 'completed', 'dropped'),
      owned: fc.boolean(),
      next: fc.boolean(),
      platform: fc.constantFrom(null, 'pc' as const, 'switch_2' as const),
      ownedAt: fc.constantFrom(null, '2019', '2020-02-29'),
    });
    fc.assert(
      fc.property(fc.array(row, { maxLength: 6 }), (rows) => {
        const h = harness();
        const entries = rows.map((x, i) => {
          let e = must(
            addEntry(
              undefined,
              {
                id: `steam:${i + 1}`,
                title: x.title,
                note: x.note,
                status: x.status,
                flags: { owned: x.owned, next: x.next },
                platform: x.platform,
              },
              h.addCtx(),
            ),
          ).entry;
          if (x.ownedAt !== null) e = must(editEntry(e, { ownedAt: x.ownedAt }, h.ctx())).entry;
          return e;
        });
        const r = importCsv(entriesToCsv(entries, LABELS), () => undefined, csvCtx());
        if (!r.ok) throw new Error(r.error);
        expect(r.errors).toEqual([]);
        const strip = (e: Entry) => ({ ...values(e), rank: '', cover: null });
        expect(r.entries.map(strip)).toEqual(entries.map(strip));
      }),
      { numRuns: 1000 },
    );
  });
});
