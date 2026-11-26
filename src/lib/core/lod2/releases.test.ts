import { describe, expect, it } from 'vitest';
import { bag3dRelease, bag3dTileset, swissRelease, swissTileset } from './releases';

const tileset = (...uris: string[]) => JSON.stringify({ asset: { version: '1.0' }, root: { children: uris.map((uri) => ({ content: { uri } })) } }, null, 1);

describe('swissRelease', () => {
  it('reads the date every child of the undated tileset names', () => {
    expect(swissRelease(tileset('20261116/sb2_0/tileset.json', '20261116/sb3_0/tileset.json'))).toBe('20261116');
    expect(swissTileset('20261116')).toBe('https://3d.geo.admin.ch/ch.swisstopo.swissbuildings3d.3d/v1/20261116/tileset.json');
  });

  it('is null when the children disagree or name no date', () => {
    expect(swissRelease(tileset('20261116/sb2_0/tileset.json', '20260520/sb3_0/tileset.json'))).toBeNull();
    expect(swissRelease(tileset('sb2_0/tileset.json'))).toBeNull();
    expect(swissRelease('<html>maintenance</html>')).toBeNull();
  });
});

describe('bag3dRelease', () => {
  it('reads the release the latest link redirected to', () => {
    expect(bag3dRelease('https://data.3dbag.nl/v20250903/cesium3dtiles/lod22/tileset.json')).toBe('v20250903');
    expect(bag3dTileset('v20250903')).toBe('https://data.3dbag.nl/v20250903/cesium3dtiles/lod22/tileset.json');
  });

  it('is null when it did not redirect to a release', () => {
    expect(bag3dRelease('https://data.3dbag.nl/latest/cesium3dtiles/lod22/tileset.json')).toBeNull();
    expect(bag3dRelease('https://example.com/v20250903/x')).toBeNull();
  });
});
