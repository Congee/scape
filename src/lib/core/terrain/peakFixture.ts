import type { LngLat } from '@core/geo/geodesy';
import { pinFrame } from '@core/geo/pinFrame';
import type { DemSource, DemTile } from './dem';
import { TILE_SIZE, tileKey, tilePixelToLngLat } from './tiles';

/** Synthetic DEM for tests: flat ground with a cone `eastM` east of `pin`; every post is its cell's mean, like a real DEM pyramid. */
export function peakSource(pin: LngLat, eastM: number, heightM: number, radiusM: number): DemSource {
  const frame = pinFrame(pin);
  const tiles = new Map<string, DemTile>();
  const cone = (lng: number, lat: number) => {
    const [e, n] = frame.toEn(lng, lat);
    return heightM * Math.max(0, 1 - Math.hypot(e - eastM, n) / radiusM);
  };
  return {
    get(z, x, y) {
      const k = tileKey(z, x, y);
      let t = tiles.get(k);
      if (!t) {
        const elev = new Float32Array(TILE_SIZE * TILE_SIZE);
        const sw = tilePixelToLngLat(z, x, y, 0, TILE_SIZE);
        const ne = tilePixelToLngLat(z, x, y, TILE_SIZE, 0);
        const [w, s] = frame.toEn(sw.lng, sw.lat);
        const [e, n] = frame.toEn(ne.lng, ne.lat);
        if (eastM > w - radiusM && eastM < e + radiusM && s < radiusM && n > -radiusM) {
          const sub = Math.min(16, Math.ceil((e - w) / TILE_SIZE / (radiusM / 20)));
          for (let py = 0; py < TILE_SIZE; py++)
            for (let px = 0; px < TILE_SIZE; px++) {
              let sum = 0;
              for (let i = 0; i < sub; i++)
                for (let j = 0; j < sub; j++) {
                  const p = tilePixelToLngLat(z, x, y, px + (i + 0.5) / sub, py + (j + 0.5) / sub);
                  sum += cone(p.lng, p.lat);
                }
              elev[py * TILE_SIZE + px] = sum / (sub * sub);
            }
        }
        t = { z, x, y, size: TILE_SIZE, elev };
        tiles.set(k, t);
      }
      return t;
    }
  };
}
