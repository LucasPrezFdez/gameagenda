import { describe, expect, it } from 'vitest';
import { gamePath, parseRoute, settingsPath, withSearch } from './routes.ts';

describe('parseRoute', () => {
  it('reconoce las rutas de la §9.1', () => {
    expect(parseRoute('/')).toEqual({ name: 'list' });
    expect(parseRoute('/apuntar')).toEqual({ name: 'capture' });
    expect(parseRoute('/catalogo/')).toEqual({ name: 'catalog' });
    expect(parseRoute('/juego/steam:1145350')).toEqual({ name: 'game', id: 'steam:1145350' });
    expect(parseRoute('/juego/steam%3A730')).toEqual({ name: 'game', id: 'steam:730' });
    expect(parseRoute('/ajustes')).toEqual({ name: 'settings', section: null });
    expect(parseRoute('/ajustes/acerca-de')).toEqual({ name: 'settings', section: 'about' });
  });

  it('rechaza ids y rutas que no existen', () => {
    expect(parseRoute('/juego/steam:0')).toEqual({ name: 'notFound' });
    expect(parseRoute('/juego/steam:730.0')).toEqual({ name: 'notFound' });
    expect(parseRoute('/juego/%E0%A4%A')).toEqual({ name: 'notFound' });
    expect(parseRoute('/ajustes/nada')).toEqual({ name: 'notFound' });
    expect(parseRoute('/share')).toEqual({ name: 'notFound' });
  });

  it('acepta juegos manuales con uuid', () => {
    const id = 'manual:01890a5d-ac96-774b-bcce-b302099a8057';
    expect(parseRoute(gamePath(id))).toEqual({ name: 'game', id });
  });

  it('construye rutas', () => {
    expect(settingsPath('data')).toBe('/ajustes/datos');
    expect(withSearch('/', new URLSearchParams())).toBe('/');
    expect(withSearch('/catalogo', new URLSearchParams({ q: 'hades' }))).toBe('/catalogo?q=hades');
  });
});
