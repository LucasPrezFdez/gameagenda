// Lo que trae `redeem`, leído en el dispositivo (`steam-library.ts`; ADR-012).

import { describe, expect, it, vi } from 'vitest';
import * as yieldModule from '../lib/yield.ts';
import { cleanSteamName, readSteamImport, VALIDATE_BATCH } from './steam-library.ts';

const body = (owned: unknown, wishlist: unknown = { response: { items: [] } }) =>
  JSON.stringify({ owned, wishlist });

describe('readSteamImport', () => {
  it('la biblioteca y los deseados, con las fechas en ms y sin fecha si es 0', async () => {
    const library = await readSteamImport(
      body(
        {
          response: {
            game_count: 2,
            games: [
              {
                appid: 220,
                name: 'Half-Life 2',
                playtime_forever: 1043,
                rtime_last_played: 1592337498,
                img_icon_url: 'x',
              },
              { appid: 1145360, name: 'Hades', playtime_forever: 0, rtime_last_played: 0 },
            ],
          },
        },
        {
          response: {
            items: [{ appid: 1086940, priority: 1, date_added: 1700000000 }, { appid: 5 }],
          },
        },
      ),
    );
    expect(library).toEqual({
      visibility: 'public',
      owned: [
        { appid: 220, name: 'Half-Life 2', minutes: 1043, lastPlayedAt: 1592337498000 },
        { appid: 1145360, name: 'Hades', minutes: 0, lastPlayedAt: null },
      ],
      wishlist: [
        { appid: 1086940, priority: 1, addedAt: 1700000000000 },
        { appid: 5, priority: 0, addedAt: null },
      ],
      skipped: 0,
    });
  });

  it('sin games ni game_count es un perfil privado; con game_count 0, una biblioteca vacía', async () => {
    expect(await readSteamImport(body({ response: {} }))).toMatchObject({
      visibility: 'private',
      owned: [],
    });
    expect(await readSteamImport(body({ response: { game_count: 0 } }))).toMatchObject({
      visibility: 'public',
      owned: [],
    });
  });

  it('un juego raro o repetido no tira el resto: se cuenta en skipped', async () => {
    const library = await readSteamImport(
      body(
        {
          response: {
            games: [
              { appid: 10, name: 'Uno' },
              { appid: 0, name: 'Sin appid' },
              { appid: 'x' },
              null,
              { appid: 10, name: 'Repetido' },
              { appid: 20, playtime_forever: -5 },
              { appid: 30 },
            ],
          },
        },
        { response: { items: [{ appid: 1 }, { appid: 1 }, { nada: true }] } },
      ),
    );
    expect(library?.owned.map((g) => g.appid)).toEqual([10, 30]);
    expect(library?.owned[1]).toEqual({ appid: 30, name: null, minutes: 0, lastPlayedAt: null });
    expect(library?.wishlist).toEqual([{ appid: 1, priority: 0, addedAt: null }]);
    expect(library?.skipped).toBe(7);
  });

  it('wishlist a null (Steam no la ha dado) se queda en null', async () => {
    expect((await readSteamImport(body({ response: { games: [] } }, null)))?.wishlist).toBeNull();
  });

  it('JSON roto, cortado o con otra forma: null', async () => {
    const good = body({ response: { games: [{ appid: 1 }] } });
    expect(await readSteamImport(good.slice(0, -10))).toBeNull();
    expect(await readSteamImport('')).toBeNull();
    expect(
      await readSteamImport(JSON.stringify({ owned: { response: { games: 'x' } } })),
    ).toBeNull();
    expect(await readSteamImport(JSON.stringify({ owned: [], wishlist: null }))).toBeNull();
  });

  it('el wishlist que pone el Worker detrás manda sobre uno colado en el cuerpo de Steam', async () => {
    const injected = `{"owned":{"response":{"games":[]},"x":1},"wishlist":{"response":{"items":[{"appid":7}]}},"wishlist":null}`;
    expect((await readSteamImport(injected))?.wishlist).toBeNull();
  });

  it('miles de juegos se validan a trozos, cediendo el turno entre uno y otro', async () => {
    const spy = vi.spyOn(yieldModule, 'yieldToMain');
    const games = Array.from({ length: 2 * VALIDATE_BATCH + 1 }, (_, i) => ({ appid: i + 1 }));
    const library = await readSteamImport(body({ response: { games } }));
    expect(library?.owned).toHaveLength(games.length);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});

describe('cleanSteamName', () => {
  it('sin caracteres de control, con los espacios juntos y 200 caracteres como mucho', () => {
    expect(cleanSteamName(' Half-Life\u00002\n ')).toBe('Half-Life 2');
    expect(cleanSteamName('   ')).toBeNull();
    expect(cleanSteamName(undefined)).toBeNull();
    expect(cleanSteamName('x'.repeat(300))).toHaveLength(200);
    // No parte un par sustituto.
    expect(cleanSteamName(`${'x'.repeat(199)}😀`)).toBe('x'.repeat(199));
  });
});
