import { describe, expect, it } from 'vitest';
import { STATUSES } from '../agenda/types.ts';
import {
  ACTIVATION,
  advanceStatus,
  autoScrollSpeed,
  createSwipe,
  dropIndex,
  dropTarget,
  inEdgeZone,
  isArmed,
  lockAxis,
  shiftFor,
} from './gesture-model.ts';

describe('advanceStatus', () => {
  it('avanza Quiero jugar y En pausa a Jugando, y Jugando a Completado', () => {
    expect(advanceStatus('want_to_play')).toBe('playing');
    expect(advanceStatus('on_hold')).toBe('playing');
    expect(advanceStatus('playing')).toBe('completed');
  });

  it('Completado y Abandonado ya no avanzan', () => {
    expect(advanceStatus('completed')).toBeNull();
    expect(advanceStatus('dropped')).toBeNull();
  });

  it('ningún gesto lleva a Abandonado ni borra', () => {
    for (const status of STATUSES) expect(advanceStatus(status)).not.toBe('dropped');
  });
});

describe('umbrales', () => {
  it('zonas muertas de 24 px en los dos bordes', () => {
    expect(inEdgeZone(23, 400)).toBe(true);
    expect(inEdgeZone(24, 400)).toBe(false);
    expect(inEdgeZone(376, 400)).toBe(false);
    expect(inEdgeZone(377, 400)).toBe(true);
  });

  it('la dirección se decide a partir de 10 px', () => {
    expect(lockAxis(9, -9)).toBeNull();
    expect(lockAxis(10, 3)).toBe('horizontal');
    expect(lockAxis(-4, 12)).toBe('vertical');
    // En diagonal exacta, gana el desplazamiento de la página.
    expect(lockAxis(12, 12)).toBe('vertical');
  });

  it('se activa al 40 % del ancho', () => {
    expect(ACTIVATION).toBe(0.4);
    expect(isArmed(159, 400)).toBe(false);
    expect(isArmed(160, 400)).toBe(true);
    expect(isArmed(10, 0)).toBe(false);
  });
});

describe('createSwipe', () => {
  const options = { width: 300, canAdvance: true };

  it('un toque no es un gesto', () => {
    const swipe = createSwipe(100, 100, options);
    expect(swipe.move(105, 103).phase).toBe('pending');
    expect(swipe.end()).toBeNull();
  });

  it('en vertical se lo deja al navegador (desplazar la lista)', () => {
    const swipe = createSwipe(100, 100, options);
    expect(swipe.move(104, 130).phase).toBe('ignored');
    // Aunque después vaya de lado.
    expect(swipe.move(300, 130)).toMatchObject({ phase: 'ignored', offset: 0, armed: false });
    expect(swipe.end()).toBeNull();
  });

  it('→ avanza al soltar pasado el 40 %, y vibra una sola vez', () => {
    const swipe = createSwipe(50, 100, options);
    expect(swipe.move(80, 102)).toMatchObject({ phase: 'swipe', side: 'advance', offset: 30 });
    const armed = swipe.move(170, 104);
    expect(armed).toMatchObject({ offset: 120, armed: true, justArmed: true });
    expect(swipe.move(200, 104)).toMatchObject({ armed: true, justArmed: false });
    expect(swipe.end()).toBe('advance');
  });

  it('← muestra las marcas', () => {
    const swipe = createSwipe(280, 100, options);
    swipe.move(260, 100);
    expect(swipe.move(150, 98)).toMatchObject({ side: 'flags', offset: -130, armed: true });
    expect(swipe.end()).toBe('flags');
  });

  it('volver atrás antes de soltar lo cancela (WCAG 2.5.2)', () => {
    const swipe = createSwipe(50, 100, options);
    swipe.move(70, 100);
    expect(swipe.move(200, 100).armed).toBe(true);
    expect(swipe.move(120, 100)).toMatchObject({ armed: false, justArmed: false });
    expect(swipe.end()).toBeNull();
  });

  it('cambiar de lado cambia la acción', () => {
    const swipe = createSwipe(150, 100, options);
    swipe.move(170, 100);
    expect(swipe.move(20, 100)).toMatchObject({ side: 'flags', armed: true });
    expect(swipe.end()).toBe('flags');
  });

  it('sin estado al que avanzar, → sigue al dedo un poco y nunca se activa', () => {
    const swipe = createSwipe(50, 100, { width: 300, canAdvance: false });
    swipe.move(70, 100);
    const frame = swipe.move(290, 100);
    expect(frame).toMatchObject({ side: 'advance', armed: false, offset: 24 });
    expect(swipe.end()).toBeNull();
    // ← sigue mostrando las marcas.
    expect(swipe.move(-90, 100)).toMatchObject({ side: 'flags', armed: true });
  });

  it('no se sale de la fila', () => {
    const swipe = createSwipe(10, 0, options);
    swipe.move(30, 0);
    expect(swipe.move(900, 0).offset).toBe(300);
  });
});

describe('arrastrar ::', () => {
  // Cinco filas de 66 px (64 + 2 de separación): centros en 32, 98, 164, 230 y 296.
  const centers = [32, 98, 164, 230, 296];

  it('cae en la última fila cuyo centro ha cruzado', () => {
    expect(dropIndex(centers, 1, 98)).toBe(1);
    expect(dropIndex(centers, 1, 163)).toBe(1);
    expect(dropIndex(centers, 1, 165)).toBe(2);
    expect(dropIndex(centers, 1, 400)).toBe(4);
    expect(dropIndex(centers, 3, 97)).toBe(1);
    expect(dropIndex(centers, 3, -50)).toBe(0);
  });

  it('las filas de en medio dejan el hueco', () => {
    // De 1 a 3: suben 2 y 3.
    expect([0, 1, 2, 3, 4].map((i) => shiftFor(i, 1, 3, 66))).toEqual([0, 0, -66, -66, 0]);
    // De 3 a 1: bajan 1 y 2.
    expect([0, 1, 2, 3, 4].map((i) => shiftFor(i, 3, 1, 66))).toEqual([0, 66, 66, 0, 0]);
    expect([0, 1, 2].map((i) => shiftFor(i, 1, 1, 66))).toEqual([0, 0, 0]);
  });

  it('al soltar: después de la fila si baja, antes si sube', () => {
    const ids = ['a', 'b', 'c', 'd'];
    expect(dropTarget(ids, 0, 2)).toEqual({ after: 'c' });
    expect(dropTarget(ids, 3, 1)).toEqual({ before: 'b' });
    expect(dropTarget(ids, 2, 2)).toBeNull();
  });

  it('se desplaza sola cerca de los bordes, más rápido cuanto más cerca', () => {
    expect(autoScrollSpeed(300, 56, 700)).toBe(0);
    expect(autoScrollSpeed(90, 56, 700)).toBeLessThan(0);
    expect(autoScrollSpeed(60, 56, 700)).toBeLessThan(autoScrollSpeed(90, 56, 700));
    expect(autoScrollSpeed(690, 56, 700)).toBeGreaterThan(autoScrollSpeed(660, 56, 700));
    expect(autoScrollSpeed(800, 56, 700)).toBe(14);
  });
});
