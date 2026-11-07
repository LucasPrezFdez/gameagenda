import { describe, expect, it } from 'vitest';
import {
  gamePath,
  PAIR_PATH,
  pairingCodeFromHash,
  pairingUrl,
  parseRoute,
  SETTINGS_SECTIONS,
  SETTINGS_SLUGS,
  settingsPath,
  withSearch,
} from './routes.ts';

describe('parseRoute', () => {
  it('reconoce las rutas de la §9.1', () => {
    expect(parseRoute('/')).toEqual({ name: 'list' });
    expect(parseRoute('/apuntar')).toEqual({ name: 'capture' });
    expect(parseRoute('/share')).toEqual({ name: 'share' });
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
    expect(parseRoute('/share/otra')).toEqual({ name: 'notFound' });
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

describe('Ajustes › Sincronización (M4)', () => {
  it('va entre Privacidad y Rendimiento, como en el wireframe de la §9.3', () => {
    const i = SETTINGS_SECTIONS.indexOf('sync');
    expect(SETTINGS_SECTIONS[i - 1]).toBe('privacy');
    expect(SETTINGS_SECTIONS[i + 1]).toBe('performance');
    expect(settingsPath('sync')).toBe('/ajustes/sincronizacion');
    expect(parseRoute('/ajustes/sincronizacion')).toEqual({ name: 'settings', section: 'sync' });
  });

  it('cada sección tiene su segmento, sin repetir', () => {
    const slugs = SETTINGS_SECTIONS.map((s) => SETTINGS_SLUGS[s]);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const section of SETTINGS_SECTIONS) {
      expect(parseRoute(settingsPath(section))).toEqual({ name: 'settings', section });
    }
  });
});

describe('/emparejar (M4; §11.4)', () => {
  const code = 'GXEN-Q32V-ABCD-EFGH-JKMN-PQRS-TVWX';

  it('reconoce la ruta del enlace del QR, con o sin barra final', () => {
    expect(parseRoute(PAIR_PATH)).toEqual({ name: 'pair' });
    expect(parseRoute('/emparejar/')).toEqual({ name: 'pair' });
    expect(parseRoute('/emparejar/otra')).toEqual({ name: 'notFound' });
  });

  it('lleva el código en el fragmento, que no llega al servidor', () => {
    const url = new URL(pairingUrl('https://ga-web.gameagenda.workers.dev', code));
    expect(url.pathname).toBe(PAIR_PATH);
    expect(url.search).toBe('');
    expect(url.hash).toBe(`#${code}`);
    expect(pairingCodeFromHash(url.hash)).toBe(code);
  });

  it('saca el código del fragmento tal cual, sin normalizarlo', () => {
    expect(pairingCodeFromHash(`#${code}`)).toBe(code);
    expect(pairingCodeFromHash('#gxen q32v')).toBe('gxen q32v');
    expect(pairingCodeFromHash('#gxen%20q32v')).toBe('gxen q32v');
    expect(pairingCodeFromHash(code)).toBe(code);
  });

  it('sin código, con uno roto o demasiado largo, no hay código', () => {
    expect(pairingCodeFromHash('')).toBeNull();
    expect(pairingCodeFromHash('#')).toBeNull();
    expect(pairingCodeFromHash('#   ')).toBeNull();
    expect(pairingCodeFromHash('#%E0%A4%A')).toBeNull();
    expect(pairingCodeFromHash(`#${'A'.repeat(65)}`)).toBeNull();
    expect(pairingCodeFromHash(`#${'A'.repeat(64)}`)).toBe('A'.repeat(64));
  });
});
