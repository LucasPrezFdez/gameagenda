import { describe, expect, it } from 'vitest';
import { coverCandidates, coverUrl, STEAM_ASSETS_BASE } from './cover-url.ts';

const CS2 = `steam/apps/730/\${FILENAME}?t=1793054556`;

describe('coverUrl', () => {
  it('sustituye el marcador del fichero en `asset_url_format` (§4.10)', () => {
    expect(coverUrl(CS2, '162664aa3d9fe55d8b1f9ad3e7b4f5a0dd1ec8c1/header.jpg')).toBe(
      `${STEAM_ASSETS_BASE}steam/apps/730/162664aa3d9fe55d8b1f9ad3e7b4f5a0dd1ec8c1/header.jpg?t=1793054556`,
    );
    expect(coverUrl(`steam/apps/367520/\${FILENAME}`, 'library_600x900_spanish.jpg')).toBe(
      'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/367520/library_600x900_spanish.jpg',
    );
  });

  it('no construye nada fuera del formato ni del CDN', () => {
    // Sin `${FILENAME}`, o dos veces: no se adivina la ruta.
    expect(coverUrl('steam/apps/730/header.jpg', 'header.jpg')).toBeNull();
    expect(coverUrl(`\${FILENAME}/\${FILENAME}`, 'a.jpg')).toBeNull();
    // Ni otro origen, ni salir de `store_item_assets/`, ni esquemas.
    expect(coverUrl(`https://evil.example/\${FILENAME}`, 'a.jpg')).toBeNull();
    expect(coverUrl(`//evil.example/\${FILENAME}`, 'a.jpg')).toBeNull();
    expect(coverUrl(`../\${FILENAME}`, 'a.jpg')).toBeNull();
    expect(coverUrl(`steam/apps/1/\${FILENAME}`, '../../x.jpg')).toBeNull();
    expect(coverUrl(`steam/apps/1/\${FILENAME}`, '/x.jpg')).toBeNull();
    expect(coverUrl(`steam/apps/1/\${FILENAME}`, 'javascript:alert(1)')).toBeNull();
    expect(coverUrl(`steam/apps/1/\${FILENAME}#x`, 'a.jpg')).toBeNull();
    expect(coverUrl(`steam/apps/1/\${FILENAME}`, 'a b.jpg')).toBeNull();
  });
});

describe('coverCandidates', () => {
  it('`library_capsule`, después `header` y sin repetir', () => {
    const format = `steam/apps/10/\${FILENAME}`;
    expect(
      coverCandidates({ assetUrlFormat: format, capsule: 'library.jpg', header: 'header.jpg' }),
    ).toEqual([
      `${STEAM_ASSETS_BASE}steam/apps/10/library.jpg`,
      `${STEAM_ASSETS_BASE}steam/apps/10/header.jpg`,
    ]);
    expect(
      coverCandidates({ assetUrlFormat: format, capsule: null, header: 'header.jpg' }),
    ).toEqual([`${STEAM_ASSETS_BASE}steam/apps/10/header.jpg`]);
    expect(
      coverCandidates({ assetUrlFormat: format, capsule: 'a.jpg', header: 'a.jpg' }),
    ).toHaveLength(1);
    expect(coverCandidates({ assetUrlFormat: format, capsule: null, header: null })).toEqual([]);
    expect(coverCandidates({ assetUrlFormat: 'nope', capsule: 'a.jpg', header: null })).toEqual([]);
  });
});
