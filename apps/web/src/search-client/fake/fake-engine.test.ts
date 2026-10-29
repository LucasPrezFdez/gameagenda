import { describe, expect, it } from 'vitest';
import {
  browseFake,
  buildFakeIndex,
  matchExactFake,
  searchFake,
  suggestFake,
} from './fake-engine.ts';
import { SAMPLE_ALIASES, SAMPLE_GAMES } from './sample-catalog.ts';

const index = buildFakeIndex(SAMPLE_GAMES, SAMPLE_ALIASES);
const names = (q: string) => searchFake(index, q, 8, false).items.map((i) => i.name);

describe('motor falso', () => {
  it('pone primero el exacto y quita apóstrofos', () => {
    expect(names('hades')[0]).toBe('Hades');
    expect(names('baldurs gate 3')[0]).toBe("Baldur's Gate 3");
    expect(names('hollow knight')[0]).toBe('Hollow Knight');
  });

  it('resuelve alias y nombres en español', () => {
    expect(names('bg3')[0]).toBe("Baldur's Gate 3");
    expect(names('mafia edicion')[0]).toBe('Mafia: Definitive Edition');
    expect(names('los sims 4')[0]).toBe('The Sims™ 4');
  });

  it('los prefijos ordenan por popularidad', () => {
    expect(names('c')[0]).toBe('Counter-Strike 2');
    expect(names('celeste')).toEqual(['Celeste']);
  });

  it('sugiere con erratas y no repite lo que ya sale', () => {
    expect(searchFake(index, 'hollow knigth', 8, false).strong).toBe(0);
    expect(suggestFake(index, 'hollow knigth', false).map((i) => i.name)).toContain(
      'Hollow Knight',
    );
  });

  it('filtra el Catálogo y empareja títulos exactos', () => {
    expect(browseFake(index, '', false)).toHaveLength(SAMPLE_GAMES.length);
    expect(browseFake(index, 'elden', false).map((g) => g.appid)).toEqual([1245620, 2622380]);
    expect(matchExactFake(index, 'Hades II')).toEqual([1145350]);
    expect(matchExactFake(index, 'Hades')).toEqual([1145360]);
  });
});
