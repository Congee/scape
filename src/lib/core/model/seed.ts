/** A Drawn model seeded from the Overture rows of one building, and the part edits the editor offers. */

import { AltitudeRef, lngLatToLocal, ModelSource, partsFootprint, type ModelAnchor, type ModelPart, type SavedModel } from '@core/model';
import { RoofShape, type BuildingBatch } from '@workers/buildings.protocol';

/** The rows a seed reads; a `BuildingBatch` or any subset of one. */
export type SeedRows = Pick<BuildingBatch, 'count' | 'ringStart' | 'lng' | 'lat' | 'heightM' | 'minHeightM' | 'roofShape' | 'roofHeightM' | 'roofDirDeg' | 'roofAcross' | 'groundM'>;

/** Side of the square an "Add spire" part starts as, metres. */
const SPIRE_SIDE_M = 3;
const SPIRE_RISE_M = 20;

const newId = () => crypto.randomUUID();

/** One part per row, in a frame anchored at the rows' bounding-box centre. */
export function seedModel(rows: SeedRows, name: string, now = Date.now()): SavedModel | null {
  let lng0 = Infinity;
  let lng1 = -Infinity;
  let lat0 = Infinity;
  let lat1 = -Infinity;
  for (let j = 0; j < rows.ringStart[rows.count]; j++) {
    lng0 = Math.min(lng0, rows.lng[j]);
    lng1 = Math.max(lng1, rows.lng[j]);
    lat0 = Math.min(lat0, rows.lat[j]);
    lat1 = Math.max(lat1, rows.lat[j]);
  }
  if (!(lng1 >= lng0)) return null;
  const anchor: ModelAnchor = { lat: (lat0 + lat1) / 2, lng: (lng0 + lng1) / 2, altRef: AltitudeRef.Ground, altM: 0, headingDeg: 0, scale: 1 };
  const parts: ModelPart[] = [];
  let groundM = NaN;
  for (let i = 0; i < rows.count; i++) {
    const ring: [number, number][] = [];
    for (let j = rows.ringStart[i]; j < rows.ringStart[i + 1]; j++) ring.push(lngLatToLocal(anchor, { lng: rows.lng[j], lat: rows.lat[j] }));
    if (ring.length < 3) continue;
    const g = rows.groundM[i];
    if (!Number.isNaN(g) && !(g >= groundM)) groundM = g;
    parts.push({
      id: newId(),
      ring,
      baseM: rows.minHeightM[i],
      heightM: rows.heightM[i],
      roof: rows.roofShape[i] as RoofShape,
      roofHeightM: rows.roofHeightM[i],
      roofDirDeg: rows.roofDirDeg[i],
      roofAcross: rows.roofAcross[i] ? 1 : 0
    });
  }
  if (parts.length === 0) return null;
  parts.sort((a, b) => b.heightM - a.heightM);
  return {
    id: newId(),
    name,
    source: ModelSource.Drawn,
    anchor,
    parts,
    footprint: partsFootprint(anchor, parts),
    groundM,
    suppressOverture: true,
    visible: true,
    attribution: 'Seeded from Overture Maps buildings (ODbL)',
    notes: '',
    createdAt: now,
    updatedAt: now
  };
}

/** Area centroid of a ring, or its vertex mean when it has no area. */
export function ringCentroid(ring: readonly [number, number][]): [number, number] {
  let a2 = 0;
  let ce = 0;
  let cn = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const c = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a2 += c;
    ce += (ring[j][0] + ring[i][0]) * c;
    cn += (ring[j][1] + ring[i][1]) * c;
  }
  if (Math.abs(a2) < 1e-9) return [ring.reduce((s, v) => s + v[0], 0) / ring.length, ring.reduce((s, v) => s + v[1], 0) / ring.length];
  return [ce / (3 * a2), cn / (3 * a2)];
}

const square = (e: number, n: number, side: number): [number, number][] => [
  [e - side / 2, n - side / 2],
  [e + side / 2, n - side / 2],
  [e + side / 2, n + side / 2],
  [e - side / 2, n + side / 2]
];

/** A thin pyramidal part standing on the tallest part's apex. */
export function spirePart(parts: readonly ModelPart[]): ModelPart {
  const top = parts.reduce<ModelPart | null>((best, p) => (!best || p.heightM > best.heightM ? p : best), null);
  const [e, n] = top ? ringCentroid(top.ring) : [0, 0];
  const baseM = top?.heightM ?? 0;
  return { id: newId(), ring: square(e, n, SPIRE_SIDE_M), baseM, heightM: baseM + SPIRE_RISE_M, roof: RoofShape.Pyramidal, roofHeightM: SPIRE_RISE_M, roofDirDeg: NaN, roofAcross: 0 };
}

/** A copy of `from` to reshape, or a 10 m block at the origin. */
export function newPart(from: ModelPart | null): ModelPart {
  if (from) return { ...from, id: newId(), ring: from.ring.map(([e, n]) => [e, n] as [number, number]) };
  return { id: newId(), ring: square(0, 0, 10), baseM: 0, heightM: 10, roof: RoofShape.Flat, roofHeightM: 0, roofDirDeg: NaN, roofAcross: 0 };
}

/** Apex above the model's base: what Overture calls a building's height. */
export function modelApexM(parts: readonly ModelPart[]): number {
  return parts.reduce((h, p) => Math.max(h, p.heightM), 0);
}
