import { describe, expect, it } from 'vitest';
import { RoofShape, type BuildingBatch } from '@workers/buildings.protocol';
import { destination, type LngLat } from './geodesy';
import { PrismOccluder } from './prismOcclude';
import { buildPrisms } from './prismRaster';

const PIN: LngLat = { lng: -74, lat: 40.75 };
const D2R = Math.PI / 180;

const at = (e: number, n: number) => destination(PIN, (Math.atan2(e, n) * 180) / Math.PI, Math.hypot(e, n));

/** One axis-aligned box, `side` metres across, centred at (cE, cN) in local east/north metres. */
function boxOccluder(cE: number, cN: number, side: number, heightM: number, rangeM = 10_000): PrismOccluder {
  const ring: [number, number][] = [
    [cE - side / 2, cN - side / 2],
    [cE + side / 2, cN - side / 2],
    [cE + side / 2, cN + side / 2],
    [cE - side / 2, cN + side / 2]
  ];
  const batch: BuildingBatch = {
    tileKey: '14/0/0',
    count: 1,
    ringStart: new Int32Array([0, 4]),
    lng: new Float64Array(4),
    lat: new Float64Array(4),
    heightM: new Float32Array([heightM]),
    minHeightM: new Float32Array(1),
    roofShape: new Uint8Array([RoofShape.Flat]),
    roofHeightM: new Float32Array(1),
    roofDirDeg: new Float32Array(1).fill(NaN),
    roofAcross: new Uint8Array(1),
    cLng: new Float64Array(1),
    cLat: new Float64Array(1),
    groundM: new Float32Array(1)
  };
  for (const [k, [e, n]] of ring.entries()) {
    const p = at(e, n);
    batch.lng[k] = p.lng;
    batch.lat[k] = p.lat;
  }
  const c = at(cE, cN);
  batch.cLng[0] = c.lng;
  batch.cLat[0] = c.lat;
  return new PrismOccluder([buildPrisms(batch, PIN, 0)], rangeM);
}

/** Direction from an azimuth and an elevation, as the viewfinder builds it. */
const dir = (azDeg: number, altDeg: number): [number, number, number] => {
  const ca = Math.cos(altDeg * D2R);
  return [ca * Math.sin(azDeg * D2R), ca * Math.cos(azDeg * D2R), Math.sin(altDeg * D2R)];
};

describe('PrismOccluder', () => {
  // A 20 m box 100 m due north, so its top subtends about 11 degrees.
  const occ = boxOccluder(0, 100, 40, 20);

  it('hides a point straight behind the wall', () => {
    expect(occ.occludes(...dir(0, 0), Infinity)).toBe(true);
    expect(occ.occludes(...dir(0, 5), Infinity)).toBe(true);
  });

  it('leaves a point in front of the wall alone', () => {
    expect(occ.occludes(...dir(0, 0), 50)).toBe(false);
    expect(occ.occludes(...dir(0, 0), 99)).toBe(false);
    expect(occ.occludes(...dir(0, 0), 150)).toBe(true);
  });

  it('leaves other bearings alone', () => {
    expect(occ.occludes(...dir(180, 0), Infinity)).toBe(false);
    expect(occ.occludes(...dir(90, 0), Infinity)).toBe(false);
    expect(occ.occludes(...dir(30, 0), Infinity)).toBe(false);
  });

  it('leaves sight lines over the roof alone', () => {
    expect(occ.occludes(...dir(0, 20), Infinity)).toBe(false);
    expect(occ.occludes(0, 0, 1, Infinity)).toBe(false);
  });

  it('drops buildings beyond the draw range', () => {
    expect(boxOccluder(0, 100, 40, 20, 50).occludes(...dir(0, 0), Infinity)).toBe(false);
  });

  it('covers a bearing that wraps past north', () => {
    const west = boxOccluder(-100, 0, 40, 20);
    expect(west.occludes(...dir(270, 0), Infinity)).toBe(true);
    expect(west.occludes(...dir(275, 0), Infinity)).toBe(true);
    expect(west.occludes(...dir(300, 0), Infinity)).toBe(false);
  });
});
