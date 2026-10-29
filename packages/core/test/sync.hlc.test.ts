import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  createHlcClock,
  formatHlc,
  HLC_LENGTH,
  HLC_PATTERN,
  hlcToIso,
  isTooFarAhead,
  maxHlc,
  parseHlc,
  randomNode,
  receiveHlc,
  tickHlc,
} from '../src/sync/index.ts';

const NODE = 'k3x9p2qa';

describe('formato', () => {
  it('coincide con el ejemplo de la §7.4', () => {
    const h = formatHlc({ ms: 1793178900000, counter: 0, node: NODE });
    expect(h).toBe('1793178900000-0000-k3x9p2qa');
    expect(h).toMatch(HLC_PATTERN);
    expect(h).toHaveLength(HLC_LENGTH);
    expect(hlcToIso(h)).toBe('2026-10-28T09:15:00.000Z');
    expect(parseHlc(h)).toEqual({ ms: 1793178900000, counter: 0, node: NODE });
  });

  it('rellena con ceros y rechaza lo que no cabe', () => {
    expect(formatHlc({ ms: 5, counter: 255, node: NODE })).toBe('0000000000005-00ff-k3x9p2qa');
    expect(() => formatHlc({ ms: -1, counter: 0, node: NODE })).toThrow(RangeError);
    expect(() => formatHlc({ ms: 1e13, counter: 0, node: NODE })).toThrow(RangeError);
    expect(() => formatHlc({ ms: 0, counter: 0x10000, node: NODE })).toThrow(RangeError);
    expect(() => formatHlc({ ms: 0, counter: 0, node: 'K3X9P2QA' })).toThrow(TypeError);
    expect(parseHlc('1793178900000-0000-k3x9p2q')).toBeNull();
    expect(parseHlc('1793178900000-FFFF-k3x9p2qa')).toBeNull();
  });

  it('propiedad: comparar como texto equivale a comparar (ms, contador, nodo)', () => {
    const parts = fc.record({
      ms: fc.integer({ min: 0, max: 9_999_999_999_999 }),
      counter: fc.integer({ min: 0, max: 0xffff }),
      node: fc.stringMatching(/^[0-9a-z]{8}$/),
    });
    fc.assert(
      fc.property(parts, parts, (a, b) => {
        const byParts =
          a.ms !== b.ms
            ? a.ms - b.ms
            : a.counter !== b.counter
              ? a.counter - b.counter
              : a.node < b.node
                ? -1
                : a.node > b.node
                  ? 1
                  : 0;
        const ha = formatHlc(a);
        const hb = formatHlc(b);
        const byText = ha < hb ? -1 : ha > hb ? 1 : 0;
        expect(Math.sign(byText)).toBe(Math.sign(byParts));
      }),
      { numRuns: 1000 },
    );
  });

  it('maxHlc devuelve la mayor o vacío', () => {
    const a = formatHlc({ ms: 1, counter: 0, node: NODE });
    const b = formatHlc({ ms: 1, counter: 1, node: NODE });
    expect(maxHlc([b, a])).toBe(b);
    expect(maxHlc([])).toBe('');
  });
});

describe('evento local', () => {
  it('avanza con el reloj de pared y reinicia el contador', () => {
    const s = tickHlc({ ms: 100, counter: 7, node: NODE }, 200);
    expect(s).toEqual({ ms: 200, counter: 0, node: NODE });
  });

  it('si el reloj no avanza (o retrocede), suma 1 al contador', () => {
    expect(tickHlc({ ms: 200, counter: 7, node: NODE }, 200)).toEqual({
      ms: 200,
      counter: 8,
      node: NODE,
    });
    expect(tickHlc({ ms: 200, counter: 7, node: NODE }, 150)).toEqual({
      ms: 200,
      counter: 8,
      node: NODE,
    });
  });

  it('tras ffff pasa al ms siguiente', () => {
    expect(tickHlc({ ms: 200, counter: 0xffff, node: NODE }, 200)).toEqual({
      ms: 201,
      counter: 0,
      node: NODE,
    });
  });
});

describe('recepción estándar', () => {
  const local = { ms: 100, counter: 3, node: NODE };

  it('con el reloj de pared por delante, contador a 0', () => {
    expect(receiveHlc(local, { ms: 90, counter: 9, node: 'zzzzzzzz' }, 150)).toEqual({
      ms: 150,
      counter: 0,
      node: NODE,
    });
  });

  it('con la remota por delante, su contador + 1', () => {
    expect(receiveHlc(local, { ms: 120, counter: 9, node: 'zzzzzzzz' }, 110)).toEqual({
      ms: 120,
      counter: 10,
      node: NODE,
    });
  });

  it('con la local por delante, su contador + 1', () => {
    expect(receiveHlc(local, { ms: 90, counter: 9, node: 'zzzzzzzz' }, 80)).toEqual({
      ms: 100,
      counter: 4,
      node: NODE,
    });
  });

  it('con el mismo instante, el mayor contador + 1', () => {
    expect(receiveHlc(local, { ms: 100, counter: 9, node: 'zzzzzzzz' }, 80)).toEqual({
      ms: 100,
      counter: 10,
      node: NODE,
    });
  });

  it('desborda el contador al ms siguiente', () => {
    expect(receiveHlc(local, { ms: 100, counter: 0xffff, node: 'zzzzzzzz' }, 80)).toEqual({
      ms: 101,
      counter: 0,
      node: NODE,
    });
  });
});

describe('reloj', () => {
  it('cada HLC es mayor que la anterior aunque el reloj retroceda', () => {
    const times = [1000, 1000, 999, 1500, 1200, 1200];
    let i = 0;
    const clock = createHlcClock({ now: () => times[i++] ?? 0, node: NODE });
    const hlcs = times.map(() => clock.next());
    for (let j = 1; j < hlcs.length; j++) {
      expect((hlcs[j - 1] as string) < (hlcs[j] as string)).toBe(true);
    }
    expect(hlcs[0]).toBe('0000000001000-0000-k3x9p2qa');
    expect(hlcs[2]).toBe('0000000001000-0002-k3x9p2qa');
    expect(hlcs[5]).toBe('0000000001500-0002-k3x9p2qa');
  });

  it('tras recibir, la siguiente local es mayor que la recibida', () => {
    const clock = createHlcClock({ now: () => 1000, node: NODE });
    const remote = '0000000005000-0003-zzzzzzzz';
    clock.receive(remote);
    expect(clock.next() > remote).toBe(true);
    expect(() => clock.receive('nope')).toThrow(TypeError);
  });

  it('se serializa y se restaura sin retroceder, con otro nodo', () => {
    const a = createHlcClock({ now: () => 5000, node: NODE });
    const last = a.next();
    a.next();
    const snap = JSON.parse(JSON.stringify(a.snapshot()));
    expect(snap).toEqual({ ms: 5000, counter: 1, offset: 0 });
    const b = createHlcClock({ now: () => 4000, node: 'aaaaaaaa', snapshot: snap });
    expect(b.next() > last).toBe(true);
  });

  it('aplica el desfase guardado (0 hasta M4)', () => {
    const clock = createHlcClock({
      now: () => 1000,
      node: NODE,
      snapshot: { ms: 0, counter: 0, offset: 250 },
    });
    expect(clock.offset).toBe(250);
    expect(clock.next()).toBe('0000000001250-0000-k3x9p2qa');
  });

  it('exige un nodo válido', () => {
    expect(() => createHlcClock({ now: () => 0, node: 'corto' })).toThrow(TypeError);
  });
});

describe('utilidades', () => {
  it('randomNode da 8 caracteres [0-9a-z]', () => {
    const values = [0, 0.5, 0.999, 0.1, 0.2, 0.3, 0.4, 0.6];
    let i = 0;
    const node = randomNode(() => values[i++] ?? 0);
    expect(node).toMatch(/^[0-9a-z]{8}$/);
    expect(node.charAt(0)).toBe('0');
    expect(node.charAt(2)).toBe('z');
    expect(() => randomNode(() => 1)).toThrow(RangeError);
  });

  it('isTooFarAhead usa 5 min por delante de now + desfase', () => {
    const now = 1_000_000;
    const at = (ms: number) => formatHlc({ ms, counter: 0, node: NODE });
    expect(isTooFarAhead(at(now + 300_000), now)).toBe(false);
    expect(isTooFarAhead(at(now + 300_001), now)).toBe(true);
    expect(isTooFarAhead(at(now + 300_001), now, 1)).toBe(false);
  });
});
