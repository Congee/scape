import { describe, expect, it } from 'vitest';
import { WGS84_A } from '@core/geo/geodesy';
import { fromGradient, slopeBand, tileSlopeAt } from './slope';
import { lngLatToTilePixel, tilePixelToLngLat } from './tiles';

const D2R = Math.PI / 180;
const DIM = 512;
const Z = 13;

/** A padded tile of `f(lng, lat)` around a latitude, and the post nearest that latitude. */
function tileAround(lat: number, lng: number, f: (lng: number, lat: number) => number) {
  const p = lngLatToTilePixel(lng, lat, Z, DIM);
  const stride = DIM + 4;
  const elev = new Float64Array(stride * stride);
  for (let r = 0; r < stride; r++)
    for (let c = 0; c < stride; c++) {
      const ll = tilePixelToLngLat(Z, p.x, p.y, c - 2 + 0.5, r - 2 + 0.5, DIM);
      elev[r * stride + c] = f(ll.lng, ll.lat);
    }
  return { elev, y: p.y, i: Math.floor(p.px), j: Math.floor(p.py) };
}

/** Great-circle distance on the Web Mercator sphere, metres. */
const dist = (a: [number, number], b: [number, number]) => {
  const s = Math.sin(((b[1] - a[1]) * D2R) / 2) ** 2 + Math.cos(a[1] * D2R) * Math.cos(b[1] * D2R) * Math.sin(((b[0] - a[0]) * D2R) / 2) ** 2;
  return 2 * WGS84_A * Math.asin(Math.sqrt(s));
};

describe('tileSlopeAt', () => {
  for (const lat of [0, 45, 70]) {
    it(`reads a 30° east-rising plane at ${lat}°`, () => {
      const lng0 = 7.65;
      const k = Math.tan(30 * D2R);
      const t = tileAround(lat, lng0, (lng, la) => 1000 + k * (lng - lng0) * D2R * WGS84_A * Math.cos(la * D2R));
      const s = tileSlopeAt(t.elev, DIM, Z, t.y, t.i, t.j);
      expect(s.slopeDeg).toBeCloseTo(30, 1);
      expect(s.aspectDeg).toBeCloseTo(270, 1);
    });

    it(`reads a 45° north-rising plane at ${lat}°`, () => {
      const t = tileAround(lat, 0, (_lng, la) => (la - lat) * D2R * WGS84_A);
      const s = tileSlopeAt(t.elev, DIM, Z, t.y, t.i, t.j);
      expect(s.slopeDeg).toBeCloseTo(45, 1);
      expect(s.aspectDeg).toBeCloseTo(180, 1);
    });

    it(`reads a cone at ${lat}°`, () => {
      const apex: [number, number] = [10, lat];
      const k = Math.tan(38 * D2R);
      const f = (lng: number, la: number) => 4000 - k * dist(apex, [lng, la]);
      const north = tileAround(lat + 0.01, 10, f);
      const n = tileSlopeAt(north.elev, DIM, Z, north.y, north.i, north.j);
      expect(n.slopeDeg).toBeCloseTo(38, 1);
      expect(Math.min(n.aspectDeg, 360 - n.aspectDeg)).toBeLessThan(0.5);
      const east = tileAround(lat, 10 + 0.01 / Math.cos(lat * D2R), f);
      const e = tileSlopeAt(east.elev, DIM, Z, east.y, east.i, east.j);
      expect(e.slopeDeg).toBeCloseTo(38, 1);
      expect(e.aspectDeg).toBeCloseTo(90, 0);
    });
  }
});

describe('fromGradient', () => {
  it('points aspect downhill', () => {
    expect(fromGradient(0, 1).aspectDeg).toBeCloseTo(180);
    expect(fromGradient(0, -1).aspectDeg).toBeCloseTo(0);
    expect(fromGradient(-1, 0).aspectDeg).toBeCloseTo(90);
    expect(fromGradient(1, 0).aspectDeg).toBeCloseTo(270);
  });
});

describe('slopeBand', () => {
  it('bands by lower edge', () => {
    expect([0, 14.9, 15, 29.9, 30, 34.9, 35, 44.9, 45, 80].map(slopeBand)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });
});
