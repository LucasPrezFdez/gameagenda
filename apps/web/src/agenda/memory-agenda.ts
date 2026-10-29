// Agenda en memoria, sin persistencia: sirve para desarrollar la interfaz y para los E2E hasta
// que llegue la de Dexie (con HLC, `outbox` y las reglas de `@gameagenda/core`). Aplica las
// reglas visibles de la §3.3 (fechas automáticas, Platinado ⇒ Completado) de forma simplificada.
import {
  type AgendaEntry,
  type AgendaResult,
  type AgendaStore,
  type CaptureOptions,
  type CaptureTarget,
  type EditableField,
  type EntryPatch,
  type Flag,
  type Status,
  viewOf,
} from './types.ts';

const RANK_STEP = 1000;
const NOOP: AgendaResult = { effect: { kind: 'noop' }, undo: null };

function pad(n: number): string {
  return String(n).padStart(12, '0');
}

/** Fecha local de hoy, `AAAA-MM-DD`. */
export function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function createMemoryAgenda(now: () => Date = () => new Date()): AgendaStore {
  let entries = new Map<string, AgendaEntry>();
  let snapshot: readonly AgendaEntry[] = [];
  let clock = 0;
  const listeners = new Set<() => void>();

  function stamp(): string {
    clock += 1;
    return pad(clock);
  }

  /** Aplica una acción: guarda la versión anterior de lo que toca para poder deshacerla. */
  function transact(
    change: (put: (entry: AgendaEntry) => void, drop: (id: string) => void) => void,
  ) {
    const before = new Map<string, AgendaEntry | undefined>();
    const next = new Map(entries);
    const remember = (id: string) => {
      if (!before.has(id)) before.set(id, entries.get(id));
    };
    change(
      (entry) => {
        remember(entry.id);
        next.set(entry.id, { ...entry, lastHlc: stamp() });
      },
      (id) => {
        remember(id);
        next.delete(id);
      },
    );
    commit(next);
    return () => {
      const restored = new Map(entries);
      for (const [id, previous] of before) {
        if (previous === undefined) restored.delete(id);
        else restored.set(id, { ...previous, lastHlc: stamp() });
      }
      commit(restored);
    };
  }

  function commit(next: Map<string, AgendaEntry>): void {
    entries = next;
    snapshot = [...next.values()];
    for (const listener of listeners) listener();
  }

  function today(): string {
    return localDay(now());
  }

  function lastRank(): number {
    let max = 0;
    for (const entry of entries.values()) max = Math.max(max, Number(entry.rank));
    return max;
  }

  function withStatus(entry: AgendaEntry, status: Status): AgendaEntry {
    return {
      ...entry,
      status,
      startedAt: status === 'playing' ? (entry.startedAt ?? today()) : entry.startedAt,
      completedAt: status === 'completed' ? (entry.completedAt ?? today()) : entry.completedAt,
    };
  }

  function withPlatinum(entry: AgendaEntry, value: boolean): AgendaEntry {
    const flagged = { ...entry, flags: { ...entry.flags, platinum: value } };
    if (!value) return { ...flagged, platinumAt: null };
    return withStatus({ ...flagged, platinumAt: today() }, 'completed');
  }

  function capture(target: CaptureTarget, options: CaptureOptions = {}): AgendaResult {
    const existing = entries.get(target.id);
    if (existing) {
      return {
        effect: { kind: 'alreadyInList', title: existing.title, status: existing.status },
        undo: null,
      };
    }
    let entry: AgendaEntry = withStatus(
      {
        id: target.id,
        title: target.title,
        status: 'want_to_play',
        flags: { ...options.flags, platinum: false },
        rank: pad(lastRank() + RANK_STEP),
        note: '',
        platform: null,
        addedAt: today(),
        startedAt: null,
        completedAt: null,
        platinumAt: null,
        ownedAt: null,
        lastHlc: '',
      },
      options.status ?? 'want_to_play',
    );
    if (options.flags?.platinum === true) entry = withPlatinum(entry, true);
    const added = entry;
    const undo = transact((put) => put(added));
    return { effect: { kind: 'captured', title: added.title, status: added.status }, undo };
  }

  function setStatus(id: string, status: Status): AgendaResult {
    const entry = entries.get(id);
    if (!entry || entry.status === status) return NOOP;
    const undo = transact((put) => put(withStatus(entry, status)));
    return { effect: { kind: 'status', title: entry.title, from: entry.status, to: status }, undo };
  }

  function setFlag(id: string, flag: Flag, value: boolean): AgendaResult {
    const entry = entries.get(id);
    if (!entry || (entry.flags[flag] ?? false) === value) return NOOP;
    const changed =
      flag === 'platinum'
        ? withPlatinum(entry, value)
        : { ...entry, flags: { ...entry.flags, [flag]: value } };
    const undo = transact((put) => put(changed));
    const autoCompleted = changed.status !== entry.status;
    return { effect: { kind: 'flag', title: entry.title, flag, value, autoCompleted }, undo };
  }

  function move(id: string, to: 'up' | 'down' | 'top' | 'bottom'): AgendaResult {
    const entry = entries.get(id);
    if (!entry) return NOOP;
    const view = viewOf(entry);
    const siblings = [...entries.values()]
      .filter((e) => viewOf(e) === view)
      .sort((a, b) => a.rank.localeCompare(b.rank));
    const from = siblings.findIndex((e) => e.id === id);
    const target =
      to === 'top' ? 0 : to === 'bottom' ? siblings.length - 1 : to === 'up' ? from - 1 : from + 1;
    if (target < 0 || target >= siblings.length || target === from) return NOOP;
    siblings.splice(from, 1);
    siblings.splice(target, 0, entry);
    const base = Math.min(...siblings.map((e) => Number(e.rank)));
    // Renumera la vista: en la agenda real, una clave fraccionaria entre vecinos (ver §7.2).
    const undo = transact((put) => {
      siblings.forEach((e, i) => {
        const rank = pad(base + i * RANK_STEP);
        if (rank !== e.rank) put({ ...e, rank });
      });
    });
    return {
      effect: { kind: 'moved', title: entry.title, position: target + 1, total: siblings.length },
      undo,
    };
  }

  function update(id: string, patch: EntryPatch): AgendaResult {
    const entry = entries.get(id);
    const fields = Object.keys(patch) as EditableField[];
    const field = fields[0];
    if (!entry || field === undefined || fields.every((f) => entry[f] === patch[f])) return NOOP;
    const undo = transact((put) => put({ ...entry, ...patch }));
    return { effect: { kind: 'updated', title: entry.title, field }, undo };
  }

  function remove(id: string): AgendaResult {
    const entry = entries.get(id);
    if (!entry) return NOOP;
    const undo = transact((_put, drop) => drop(id));
    return { effect: { kind: 'removed', title: entry.title }, undo };
  }

  function link(manualId: string, target: CaptureTarget): AgendaResult {
    const manual = entries.get(manualId);
    if (!manual) return NOOP;
    const existing = entries.get(target.id);
    const merged: AgendaEntry = existing
      ? { ...existing, note: [existing.note, manual.note].filter(Boolean).join('\n\n') }
      : { ...manual, id: target.id, title: target.title };
    const undo = transact((put, drop) => {
      put(merged);
      drop(manualId);
    });
    return { effect: { kind: 'linked', title: target.title }, undo };
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    capture,
    setStatus,
    setFlag,
    move,
    update,
    remove,
    link,
    deleteAll() {
      commit(new Map());
    },
  };
}
