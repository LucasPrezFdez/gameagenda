import { describe, expect, it } from 'vitest';
import {
  canonicalStoreUrl,
  findSteamLink,
  parseSteamLink,
  titleFromSlug,
} from '../src/steam-link/index.ts';

describe('parseSteamLink: los seis formatos', () => {
  const vectors: Array<[string, number, string | null, string]> = [
    // Tienda, con y sin slug.
    ['https://store.steampowered.com/app/1145350/Hades_II/', 1145350, 'Hades II', 'store'],
    ['https://store.steampowered.com/app/1145350', 1145350, null, 'store'],
    ['https://store.steampowered.com/app/1145350/', 1145350, null, 'store'],
    ['store.steampowered.com/app/730/CounterStrike_2/', 730, 'CounterStrike 2', 'store'],
    [
      'http://store.steampowered.com/app/1030300/Hollow_Knight_Silksong/?snr=1_7_15__13',
      1030300,
      'Hollow Knight Silksong',
      'store',
    ],
    ['https://store.steampowered.com/app/730?l=spanish', 730, null, 'store'],
    ['HTTPS://Store.SteamPowered.com/app/730/', 730, null, 'store'],
    // Enlace corto, comunidad, cliente, SteamDB y appid.
    ['https://s.team/a/1145350', 1145350, null, 's.team'],
    ['s.team/a/730/', 730, null, 's.team'],
    ['https://steamcommunity.com/app/1145350', 1145350, null, 'community'],
    ['https://steamcommunity.com/app/730/discussions/', 730, null, 'community'],
    ['steam://store/1145350', 1145350, null, 'steam'],
    ['steam://store/730/', 730, null, 'steam'],
    ['https://steamdb.info/app/1145350/', 1145350, null, 'steamdb'],
    ['steamdb.info/app/730/charts/', 730, null, 'steamdb'],
    ['appid:730', 730, null, 'appid'],
    ['AppID: 1145350', 1145350, null, 'appid'],
    ['  https://store.steampowered.com/app/730/  ', 730, null, 'store'],
  ];

  it.each(vectors)('%s', (input, appid, title, source) => {
    expect(parseSteamLink(input)).toEqual({ appid, title, source });
  });
});

describe('parseSteamLink: lo que no debe reconocerse', () => {
  const negatives = [
    '',
    '730',
    'hades ii',
    'https://store.steampowered.com/sub/54029/',
    'https://store.steampowered.com/bundle/232/',
    'https://store.steampowered.com/app/',
    'https://store.steampowered.com/app/abc/',
    'https://store.steampowered.com/app/0/',
    'https://store.steampowered.com/app/0730/',
    'https://store.steampowered.com/app/12345678901/',
    'https://store.steampowered.com/app/730.5/',
    'https://store.steampowered.com.evil.example/app/730/',
    'https://evilstore.steampowered.com/app/730/',
    'https://user@store.steampowered.com/app/730/',
    'https://store.steampowered.com:8080/app/730/',
    'ftp://store.steampowered.com/app/730/',
    'https://example.com/?u=store.steampowered.com/app/730',
    'https://example.com/store.steampowered.com/app/730',
    'https://s.team/p/abcd-efg',
    'https://s.team/a/730/extra',
    'https://steamcommunity.com/id/gaben',
    'steam://run/730',
    'steam://store/730/extra',
    'https://steamdb.info/sub/54029/',
    'appid:',
    'appid:-5',
    'appid:12a',
    'appid 730',
    'app:730',
  ];

  it.each(negatives)('%j', (input) => {
    expect(parseSteamLink(input)).toBeNull();
  });
});

describe('titleFromSlug', () => {
  it('cambia guiones bajos por espacios y decodifica', () => {
    expect(titleFromSlug('Baldurs_Gate_3')).toBe('Baldurs Gate 3');
    expect(titleFromSlug('ELDEN_RING')).toBe('ELDEN RING');
    expect(titleFromSlug('Counter__Strike_2_')).toBe('Counter Strike 2');
    expect(titleFromSlug('%E3%83%9A%E3%83%AB%E3%82%BD%E3%83%8A')).toBe('ペルソナ');
    expect(titleFromSlug('100%_Orange_Juice')).toBe('100% Orange Juice');
    expect(titleFromSlug('_')).toBeNull();
    expect(titleFromSlug('')).toBeNull();
  });
});

describe('findSteamLink', () => {
  it('encuentra el enlace dentro de un texto compartido', () => {
    expect(
      findSteamLink(
        'Ahorra un 20 % en Hades II: https://store.steampowered.com/app/1145350/Hades_II/',
      ),
    ).toEqual({ appid: 1145350, title: 'Hades II', source: 'store' });
    expect(findSteamLink('mira (https://s.team/a/730).')).toEqual({
      appid: 730,
      title: null,
      source: 's.team',
    });
    expect(findSteamLink('appid:730')).toEqual({ appid: 730, title: null, source: 'appid' });
  });

  it('devuelve null si no hay ninguno', () => {
    expect(findSteamLink('Hades II, el mejor juego')).toBeNull();
    expect(findSteamLink('https://example.com/app/730')).toBeNull();
  });
});

describe('canonicalStoreUrl', () => {
  it('con y sin *slug*, y vuelve a dar el mismo appid y el mismo título', () => {
    const cases = [
      'https://store.steampowered.com/app/1145360/Hades/?snr=1_7_15__13',
      'store.steampowered.com/app/2379780/Balatro',
      'https://s.team/a/730',
      'appid:504230',
      'https://store.steampowered.com/app/1030300/Hollow_Knight_Silksong/',
      'https://store.steampowered.com/app/4000001/Caf%C3%A9_100%25_Ni%C3%B1o/',
    ];
    for (const text of cases) {
      const link = parseSteamLink(text);
      if (link === null) throw new Error(text);
      const url = canonicalStoreUrl(link);
      expect(url).toMatch(/^https:\/\/store\.steampowered\.com\/app\/[1-9][0-9]*\/[^?#]*$/);
      expect(parseSteamLink(url)).toMatchObject({ appid: link.appid, title: link.title });
    }
    expect(canonicalStoreUrl({ appid: 730, title: null })).toBe(
      'https://store.steampowered.com/app/730/',
    );
    expect(canonicalStoreUrl({ appid: 1145360, title: 'Hades' })).toBe(
      'https://store.steampowered.com/app/1145360/Hades',
    );
  });
});
