/** Synthetic Overture batches for the tests, laid out in local metres around a pin. */

import { RoofShape, type BuildingBatch } from '@workers/buildings.protocol';
import { destination, type LngLat } from './geodesy';

export const PIN: LngLat = { lng: -74, lat: 40.75 };

/** Local east/north metres to lng/lat around the pin. */
export const at = (e: number, n: number) => destination(PIN, (Math.atan2(e, n) * 180) / Math.PI, Math.hypot(e, n));

export interface Box {
  /** Footprint in local east/north metres. */
  ring: [number, number][];
  heightM: number;
  minHeightM?: number;
  groundM?: number;
  roofShape?: RoofShape;
  roofHeightM?: number;
  roofDirDeg?: number;
  roofAcross?: number;
}

export function batchOf(boxes: Box[]): BuildingBatch {
  const ringStart = new Int32Array(boxes.length + 1);
  for (const [i, b] of boxes.entries()) ringStart[i + 1] = ringStart[i] + b.ring.length;
  const nv = ringStart[boxes.length];
  const batch: BuildingBatch = {
    tileKey: '14/0/0',
    count: boxes.length,
    ringStart,
    lng: new Float64Array(nv),
    lat: new Float64Array(nv),
    heightM: new Float32Array(boxes.length),
    minHeightM: new Float32Array(boxes.length),
    roofShape: new Uint8Array(boxes.length),
    roofHeightM: new Float32Array(boxes.length),
    roofDirDeg: new Float32Array(boxes.length).fill(NaN),
    roofAcross: new Uint8Array(boxes.length),
    cLng: new Float64Array(boxes.length),
    cLat: new Float64Array(boxes.length),
    groundM: new Float32Array(boxes.length)
  };
  for (const [i, b] of boxes.entries()) {
    batch.heightM[i] = b.heightM;
    batch.minHeightM[i] = b.minHeightM ?? 0;
    batch.groundM[i] = b.groundM ?? 0;
    batch.roofShape[i] = b.roofShape ?? RoofShape.Flat;
    batch.roofHeightM[i] = b.roofHeightM ?? 0;
    batch.roofDirDeg[i] = b.roofDirDeg ?? NaN;
    batch.roofAcross[i] = b.roofAcross ?? 0;
    let ce = 0;
    let cn = 0;
    for (const [k, [e, n]] of b.ring.entries()) {
      const p = at(e, n);
      batch.lng[ringStart[i] + k] = p.lng;
      batch.lat[ringStart[i] + k] = p.lat;
      ce += e;
      cn += n;
    }
    const c = at(ce / b.ring.length, cn / b.ring.length);
    batch.cLng[i] = c.lng;
    batch.cLat[i] = c.lat;
  }
  return batch;
}

export const square = (cE: number, cN: number, side: number): [number, number][] => [
  [cE - side / 2, cN - side / 2],
  [cE + side / 2, cN - side / 2],
  [cE + side / 2, cN + side / 2],
  [cE - side / 2, cN + side / 2]
];

export const rect = (cE: number, cN: number, we: number, dn: number): [number, number][] => [
  [cE - we / 2, cN - dn / 2],
  [cE + we / 2, cN - dn / 2],
  [cE + we / 2, cN + dn / 2],
  [cE - we / 2, cN + dn / 2]
];
