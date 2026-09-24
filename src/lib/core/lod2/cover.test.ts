import { describe, expect, it } from 'vitest';
import { suppressRing } from '@core/geo/buildingTiles';
import { lngLatToTilePixel, tilePixelToLngLat } from '@core/terrain/tiles';
import { lod2CoverOf, type Lod2Cover } from './cover';

const t = lngLatToTilePixel(4.4868, 51.9091, 14);
const key = `14/${t.x}/${t.y}`;
const mid = tilePixelToLngLat(14, t.x, t.y, 0.5, 0.5, 1);
const ring = suppressRing([
  [mid.lng, mid.lat],
  [mid.lng + 0.0001, mid.lat],
  [mid.lng, mid.lat + 0.0001]
]);
const at = (url: string, dLng: number): Lod2Cover => ({ url, bbox: [mid.lng + dLng - 0.001, mid.lat - 0.001, mid.lng + dLng + 0.001, mid.lat + 0.001], rings: [ring] });

describe('lod2CoverOf', () => {
  it('takes the tiles overlapping the Overture tile and signs them order-free', () => {
    const a = lod2CoverOf(key, [at('b', 0), at('a', 0.005), at('far', 0.5)]);
    expect(a.sig).toBe('a|b');
    expect(a.rings).toHaveLength(2);
    expect(lod2CoverOf(key, [at('a', 0.005), at('b', 0)]).sig).toBe(a.sig);
  });

  it('is empty with nothing near', () => {
    expect(lod2CoverOf(key, [at('far', 0.5)])).toEqual({ sig: '', rings: [] });
  });
});
