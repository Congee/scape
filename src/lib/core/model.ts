/** Precise building models: drawn from parts in the app, or imported meshes. */

import { bearingDeg, destination, distanceM, type LngLat } from './geo/geodesy';
import type { RoofShape } from '@workers/buildings.protocol';

export const ModelSource = { Drawn: 'Drawn', Imported: 'Imported' } as const;
export type ModelSource = (typeof ModelSource)[keyof typeof ModelSource];

export const AltitudeRef = { Ground: 'Ground', Absolute: 'Absolute' } as const;
export type AltitudeRef = (typeof AltitudeRef)[keyof typeof AltitudeRef];

/** Where the model's local frame sits: ENU at `lat`/`lng`, turned by `headingDeg`, scaled by `scale`. */
export interface ModelAnchor {
  lat: number;
  lng: number;
  altRef: AltitudeRef;
  /** Above the model's ground for Ground, above sea level for Absolute. */
  altM: number;
  /** Clockwise from north: local north points this way. */
  headingDeg: number;
  scale: number;
}

/** One extruded footprint in the anchor's frame, with Overture's height meanings. */
export interface ModelPart {
  id: string;
  ring: [e: number, n: number][];
  /** Bottom above the model's base, metres. */
  baseM: number;
  /** Apex above the model's base, metres. */
  heightM: number;
  roof: RoofShape;
  /** 0 lets the roof builder pick. */
  roofHeightM: number;
  /** NaN lets the roof builder pick. */
  roofDirDeg: number;
  roofAcross: 0 | 1;
}

/** Local-frame triangles, three indices each, wound counter-clockwise seen from outside. */
export interface ModelMesh {
  pos: Float32Array;
  idx: Uint32Array;
  /** minE, minN, minU, maxE, maxN, maxU. */
  box: Float32Array;
}

export interface SavedModel {
  id: string;
  name: string;
  source: ModelSource;
  anchor: ModelAnchor;
  /** Source of truth for a Drawn model. */
  parts?: ModelPart[];
  /** Source of truth for an Imported model. */
  glb?: ArrayBuffer;
  /** Plan-view outline, the suppression and target-height test. */
  footprint: [lng: number, lat: number][];
  /** Lowest DEM under the footprint, metres; NaN when unknown, which stands it at sea level. */
  groundM: number;
  suppressOverture: boolean;
  visible: boolean;
  attribution: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Sea-level altitude of the local frame's U = 0. */
export function modelBaseM(anchor: ModelAnchor, groundM: number): number {
  if (anchor.altRef === AltitudeRef.Absolute) return anchor.altM;
  // Same rule as the prisms: no DEM is sea level, and water reads as bathymetry.
  return (Number.isNaN(groundM) ? 0 : Math.max(groundM, 0)) + anchor.altM;
}

/** Local e, n metres to lng/lat, heading and scale applied. */
export function localToLngLat(anchor: ModelAnchor, e: number, n: number): LngLat {
  const h = anchor.headingDeg * D2R;
  const c = Math.cos(h);
  const s = Math.sin(h);
  const E = anchor.scale * (e * c + n * s);
  const N = anchor.scale * (n * c - e * s);
  const d = Math.hypot(E, N);
  return d === 0 ? { lng: anchor.lng, lat: anchor.lat } : destination(anchor, Math.atan2(E, N) * R2D, d);
}

/** Inverse of `localToLngLat`. */
export function lngLatToLocal(anchor: ModelAnchor, p: LngLat): [e: number, n: number] {
  const d = distanceM(anchor, p) / anchor.scale;
  const az = bearingDeg(anchor, p) * D2R - anchor.headingDeg * D2R;
  return [d * Math.sin(az), d * Math.cos(az)];
}

/** Convex hull of the parts' rings, in lng/lat, counter-clockwise. */
export function partsFootprint(anchor: ModelAnchor, parts: readonly ModelPart[]): [number, number][] {
  const pts: [number, number][] = [];
  for (const p of parts) for (const [e, n] of p.ring) pts.push([e, n]);
  return convexHull(pts).map(([e, n]) => {
    const g = localToLngLat(anchor, e, n);
    return [g.lng, g.lat];
  });
}

const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Andrew's monotone chain; counter-clockwise, no repeated end point. */
export function convexHull(pts: readonly [number, number][]): [number, number][] {
  const p = pts.toSorted((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Even-odd point in a lng/lat ring. */
export function inLngLatRing(ring: readonly (readonly [number, number])[], p: LngLat): boolean {
  let inside = false;
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const [xa, ya] = ring[a];
    const [xb, yb] = ring[b];
    if (ya > p.lat === yb > p.lat) continue;
    if (p.lng < xa + ((p.lat - ya) / (yb - ya)) * (xb - xa)) inside = !inside;
  }
  return inside;
}
