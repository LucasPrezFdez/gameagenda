import { describe, expect, it } from 'vitest';
import {
  type ActionResult,
  addEntry,
  type Entry,
  editEntry,
  isLive,
  linkCandidate,
  linkManual,
  provisionalInput,
  refreshCatalogCopy,
  removeEntry,
  setStatus,
  toggleFlag,
  undo,
} from '../src/entries/index.ts';
import { applyOps } from '../src/sync/index.ts';
import { harness, values } from './actions-harness.ts';
import { MANUAL_1, TODAY } from './helpers.ts';

const APPID = 1145350;
const T = `steam:${APPID}`;
const CATALOG = { title: 'Hades II', cover: 'https://cdn.example/hades2.jpg' };

function must(r: ActionResult | null): ActionResult {
  if (r === null) throw new Error('la acción no ha hecho nada');
  return r;
}

function manualWithData(h: ReturnType<typeof harness>): Entry {
  let m = must(addEntry(undefined, { id: MANUAL_1, title: 'hades 2' }, h.addCtx('a3'))).entry;
  m = must(setStatus(m, 'playing', h.ctx('2026-10-01'))).entry;
  m = must(toggleFlag(m, 'owned', h.ctx())).entry;
  m = must(editEntry(m, { note: 'del manual', platform: 'pc' }, h.ctx())).entry;
  return m;
}

describe('linkCandidate', () => {
  it('solo propone con una única coincidencia exacta', () => {
    expect(linkCandidate([])).toBeNull();
    expect(linkCandidate([APPID])).toBe(APPID);
    expect(linkCandidate([APPID, APPID])).toBe(APPID);
    expect(linkCandidate([1145360, APPID])).toBeNull();
  });
});

describe('vincular un manual con Steam', () => {
  it('sin entrada de Steam: la crea con los campos de usuario del manual y sus HLC', () => {
    const h = harness();
    const m = manualWithData(h);
    const c = h.ctx();
    const r = must(linkManual(m, undefined, APPID, CATALOG, c));
    const [t, merged] = r.entries;
    expect(r.entry).toBe(t);
    expect(t).toMatchObject({
      id: T,
      status: 'playing',
      flags: { owned: true, platinum: false, next: false },
      rank: m.rank,
      note: 'del manual',
      platform: 'pc',
      addedAt: m.addedAt,
      startedAt: '2026-10-01',
      title: 'Hades II',
      cover: CATALOG.cover,
      deletedAt: null,
      mergedInto: null,
      view: 'playing',
    });
    expect(t?.hlc.status).toBe(m.hlc.status);
    expect(t?.hlc.note).toBe(m.hlc.note);
    expect(t?.hlc.title).toBe(c.hlc);
    expect(merged).toMatchObject({ id: MANUAL_1, mergedInto: T });
    expect(isLive(merged)).toBe(false);
    // Lo copiado conserva su HLC; lo propio de la acción va con la suya.
    const own = r.ops.filter((o) => o.hlc === c.hlc).map((o) => `${o.entryId} ${o.field}`);
    expect(own.sort()).toEqual(
      [
        `${T} deletedAt`,
        `${T} title`,
        `${T} cover`,
        `${MANUAL_1} deletedAt`,
        `${MANUAL_1} mergedInto`,
      ].sort(),
    );
    // El reenvío del manual no duplica lo copiado.
    const toTarget = r.ops.filter((o) => o.entryId === T).map((o) => o.field);
    expect(new Set(toTarget).size).toBe(toTarget.length);
  });

  it('con entrada de Steam: LWW campo a campo y, si hay dos notas, se concatenan', () => {
    const h = harness();
    let t = must(
      addEntry(undefined, { id: T, title: 'Hades II', note: 'de steam' }, h.addCtx()),
    ).entry;
    const m = manualWithData(h);
    t = must(toggleFlag(t, 'next', h.ctx())).entry;
    const r = must(linkManual(m, t, APPID, CATALOG, h.ctx()));
    expect(r.entry).toMatchObject({
      status: 'playing', // el manual cambió de estado después del alta de T
      flags: { owned: true, next: true }, // next de T es más reciente
      note: 'de steam\n\ndel manual',
      platform: 'pc',
    });
  });

  it('una lápida de Steam vuelve a la lista', () => {
    const h = harness();
    const t0 = must(addEntry(undefined, { id: T, title: 'Hades II' }, h.addCtx())).entry;
    const gone = must(removeEntry(t0, h.ctx())).entry;
    const m = manualWithData(h);
    const r = must(linkManual(m, gone, APPID, CATALOG, h.ctx()));
    expect(isLive(r.entry)).toBe(true);
    expect(r.entry.status).toBe('playing');
  });

  it('la nota concatenada no pasa de 2000 caracteres', () => {
    const h = harness();
    const t = must(
      addEntry(undefined, { id: T, title: 'Hades II', note: 'a'.repeat(1500) }, h.addCtx()),
    ).entry;
    const m0 = must(
      addEntry(undefined, { id: MANUAL_1, title: 'h', note: 'b'.repeat(1500) }, h.addCtx()),
    ).entry;
    const r = must(linkManual(m0, t, APPID, CATALOG, h.ctx()));
    expect(r.entry.note).toHaveLength(2000);
    expect(r.entry.note.startsWith('a'.repeat(1500))).toBe(true);
  });

  it('lo que llega después para el manual se reenvía a Steam', () => {
    const h = harness();
    const m = manualWithData(h);
    const r = must(linkManual(m, undefined, APPID, CATALOG, h.ctx()));
    const [t, merged] = r.entries as [Entry, Entry];
    const late = {
      opId: h.newOpId(),
      entryId: MANUAL_1,
      field: 'status',
      value: 'completed',
      hlc: h.ctx().hlc,
    };
    const { entries } = applyOps(
      (id) => (id === T ? t : id === MANUAL_1 ? merged : undefined),
      [late],
      h.newOpId,
    );
    expect(entries.get(T)?.status).toBe('completed');
  });

  it('solo vincula manuales visibles y exige el destino correcto', () => {
    const h = harness();
    const t = must(addEntry(undefined, { id: T, title: 'Hades II' }, h.addCtx())).entry;
    expect(linkManual(t, undefined, 1, CATALOG, h.ctx())).toBeNull();
    expect(linkManual(undefined, undefined, APPID, CATALOG, h.ctx())).toBeNull();
    const m = manualWithData(h);
    expect(() => linkManual(m, t, 1, CATALOG, h.ctx())).toThrow(RangeError);
  });

  it('deshacer: Steam vuelve a no estar y el manual queda como estaba', () => {
    const h = harness();
    const m = manualWithData(h);
    const r = must(linkManual(m, undefined, APPID, CATALOG, h.ctx()));
    const byId = new Map(r.entries.map((e) => [e.id, e]));
    const u = must(undo(r.undo, (id) => byId.get(id), h.ctx()));
    const after = new Map(u.entries.map((e) => [e.id, e]));
    expect(isLive(after.get(T))).toBe(false);
    expect(values(after.get(MANUAL_1))).toEqual(values(m));
  });

  it('deshacer con Steam ya apuntado restaura sus valores', () => {
    const h = harness();
    const t = must(
      addEntry(undefined, { id: T, title: 'Hades II', note: 'de steam' }, h.addCtx()),
    ).entry;
    const m = manualWithData(h);
    const r = must(linkManual(m, t, APPID, CATALOG, h.ctx()));
    const byId = new Map(r.entries.map((e) => [e.id, e]));
    const u = must(undo(r.undo, (id) => byId.get(id), h.ctx()));
    const after = new Map(u.entries.map((e) => [e.id, e]));
    expect(values(after.get(T))).toEqual(values(t));
    expect(values(after.get(MANUAL_1))).toEqual(values(m));
  });
});

describe('juego provisional', () => {
  it('se apunta con el título del slug o el de respaldo', () => {
    const fallback = (appid: number) => `Juego de Steam ${appid}`;
    expect(provisionalInput({ appid: 730, title: null }, fallback)).toEqual({
      id: 'steam:730',
      title: 'Juego de Steam 730',
      cover: null,
    });
    const h = harness();
    const input = provisionalInput({ appid: APPID, title: 'Hades II' }, fallback);
    const e = must(addEntry(undefined, input, h.addCtx())).entry;
    expect(e).toMatchObject({ id: T, title: 'Hades II', status: 'want_to_play', addedAt: TODAY });
  });

  it('se resuelve sin cambiar de id al llegar al catálogo', () => {
    const h = harness();
    const e = must(addEntry(undefined, { id: T, title: 'Hades II Slug' }, h.addCtx())).entry;
    const r = must(refreshCatalogCopy(e, CATALOG, h.ctx()));
    expect(r.entry).toMatchObject({ id: T, title: 'Hades II', cover: CATALOG.cover });
    expect(r.ops.map((o) => o.field)).toEqual(['title', 'cover']);
    expect(refreshCatalogCopy(r.entry, CATALOG, h.ctx())).toBeNull();
  });
});
