import { Refraction } from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import { horizontalFast, type SkySample } from '@core/astro/fastHorizon';
import { bearingDeg, destination, distanceM, elevationAngleDeg, type LngLat } from '@core/geo/geodesy';
import { cellCentre, cellOf, gridAround } from '@core/geo/grid';
import type { DemSource, DemTile } from '@core/terrain/dem';
import { planSweep } from '@core/terrain/horizon';
import { tileKey, tilePixelToLngLat } from '@core/terrain/tiles';
import { alignAt, alignGrid, landmarkTopM } from './alignment';
import { bodyVisibleGrid, rayLadder, viewshedGrid } from './visibility';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** DEM tiles built on demand from an elevation function. */
class FnDem implements DemSource {
  private tiles = new Map<string, DemTile>();
  constructor(private f: (p: LngLat) => number) {}
  get(z: number, x: number, y: number): DemTile {
    const k = tileKey(z, x, y);
    let t = this.tiles.get(k);
    if (!t) {
      const elev = new Float32Array(256 * 256);
      for (let py = 0; py < 256; py++) for (let px = 0; px < 256; px++) elev[py * 256 + px] = this.f(tilePixelToLngLat(z, x, y, px + 0.5, py + 0.5));
      t = { z, x, y, size: 256, elev };
      this.tiles.set(k, t);
    }
    return t;
  }
}

/** A sky sample that puts a body at the given apparent direction as seen from `p`. */
function sampleFor(p: LngLat, azDeg: number, altDeg: number, ms = 0): SkySample {
  let alt = altDeg;
  for (let i = 0; i < 4; i++) alt = altDeg - Refraction('normal', alt);
  const φ = p.lat * D2R;
  const a = alt * D2R;
  const A = azDeg * D2R;
  const sinδ = Math.sin(a) * Math.sin(φ) + Math.cos(a) * Math.cos(φ) * Math.cos(A);
  const δ = Math.asin(sinδ);
  const cosH = (Math.sin(a) - Math.sin(φ) * sinδ) / (Math.cos(φ) * Math.cos(δ));
  const H = Math.acos(Math.max(-1, Math.min(1, cosH))) * (azDeg > 180 ? 1 : -1);
  return { ms, gastH: (H * R2D) / 15 - p.lng / 15, raH: 0, decDeg: δ * R2D };
}

const L: LngLat = { lat: 46.0, lng: 7.75 };
// Flat plain with an east–west ridge 600 m high running 2 km south of the landmark.
const ridgeLat = destination(L, 180, 2000).lat;
const dem = new FnDem((p) => (Math.abs(p.lat - ridgeLat) < 0.003 ? 600 : 0));
const landmark = { ...L, heightM: 300 };

describe('shot alignment', () => {
  it('recovers the camera position that puts the body behind the landmark', () => {
    const grid = gridAround(L, 8000, 64);
    const cell = cellOf(grid, destination(L, 20, 5000))!;
    // The grid evaluates cell centres, so aim the samples at one.
    const P = cellCentre(grid, cell.row, cell.col);
    const eye = 1.6;
    const angle = elevationAngleDeg(distanceM(P, L), 300 - eye);
    const az = bearingDeg(P, L);
    const sample = sampleFor(P, az, angle + 1, 1000);
    const h = horizontalFast(sample, P.lat, P.lng);
    expect(h.azimuth).toBeCloseTo(az, 4);
    expect(h.altitude).toBeCloseTo(angle + 1, 4);
    const samples = [sampleFor(P, az - 1, angle + 1.4, 0), sample, sampleFor(P, az + 1, angle + 0.6, 2000)];
    const res = alignGrid(dem, 12, grid, samples, 1000, landmark, { eyeAboveGroundM: eye, offsetAzDeg: 0, offsetAltDeg: 1, capDeg: 3 });
    const k = cell.row * grid.n + cell.col;
    expect(res.sepDeg[k]).toBeLessThan(0.15);
    expect(res.dtMs[k]).toBe(0);
    // Elsewhere the direction to the landmark differs, so the separation grows.
    const far = cellOf(grid, destination(L, 250, 5000))!;
    const kf = far.row * grid.n + far.col;
    expect(Number.isNaN(res.sepDeg[kf]) || res.sepDeg[kf] > 1).toBe(true);
    expect(res.landmarkGroundM).toBe(0);
  });

  it('drops positions whose sightline the ridge blocks', () => {
    const behind = destination(L, 180, 4000);
    const clear = destination(L, 0, 4000);
    const angle = elevationAngleDeg(4000, 300 - 1.6);
    const ok = alignAt(dem, 12, clear, [sampleFor(clear, 180, angle, 0)], landmark, landmarkTopM(dem, 12, landmark), { eyeAboveGroundM: 1.6, offsetAzDeg: 0, offsetAltDeg: 0, capDeg: 3 }, 250)!;
    expect(ok.blocked).toBe(false);
    expect(ok.sepDeg).toBeLessThan(0.05);
    expect(ok.distM).toBeCloseTo(4000, -1);
    const bad = alignAt(dem, 12, behind, [sampleFor(behind, 0, angle, 0)], landmark, landmarkTopM(dem, 12, landmark), { eyeAboveGroundM: 1.6, offsetAzDeg: 0, offsetAltDeg: 0, capDeg: 3 }, 250)!;
    expect(bad.blocked).toBe(true);
  });
});

describe('visibility', () => {
  it('hides a low body behind the ridge only where the ridge stands high enough', () => {
    const grid = gridAround(destination(L, 180, 10_000), 12_000, 48);
    const ladder = rayLadder(L.lat, 30_000, { minZoom: 9, maxZoom: 12, stepFraction: 0.02 });
    // Body 2° up in the north; the ridge (600 m) hides it out to 600 / tan 2° ≈ 17 km south of the ridge.
    const centre = cellCentre(grid, 24, 24);
    const sample = sampleFor(centre, 0, 2, 0);
    const vis = bodyVisibleGrid(dem, grid, sample, ladder, { eyeAboveGroundM: 1.6, minAltAboveTerrainDeg: 0 });
    const at = (p: LngLat) => {
      const c = cellOf(grid, p)!;
      return vis[c.row * grid.n + c.col];
    };
    expect(at(destination(L, 180, 6000))).toBe(0);
    expect(at(destination(L, 180, 12_000))).toBe(0);
    expect(at(destination(L, 180, 17_000))).toBe(0);
    expect(at(destination(L, 180, 21_000))).toBe(1);
    expect(at(destination(L, 180, 1000))).toBe(1);
  });

  it('marks ground behind the ridge as unseen from the landmark', () => {
    const grid = gridAround(L, 6000, 48);
    const plan = planSweep(L, 6000, { azStepDeg: 1, minDistM: 30, maxZoom: 12, stepFraction: 0.01 });
    const vs = viewshedGrid(dem, plan, grid, 1.6);
    const at = (p: LngLat) => {
      const c = cellOf(grid, p)!;
      return vs[c.row * grid.n + c.col];
    };
    expect(at(destination(L, 180, 1000))).toBe(1);
    expect(at(destination(L, 0, 4000))).toBe(1);
    expect(at(destination(L, 180, 3500))).toBe(0);
    expect(at(destination(L, 180, 5500))).toBe(0);
  });
});
