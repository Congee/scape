/** Precise building models: drawn from parts in the app, or imported meshes. */

import type { LngLat } from './geo/geodesy';
import { frameAt } from './geo/pinFrame';
import type { RoofShape } from '@workers/buildings.protocol';
import type { ImportOptions } from './model/gltf';

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
  /** How `glb` was read: units, up axis, origin. */
  importOptions?: ImportOptions;
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

/** Sea-level altitude of the local frame's U = 0. */
export function modelBaseM(anchor: ModelAnchor, groundM: number): number {
  assertPlaceable(anchor, groundM);
  if (anchor.altRef === AltitudeRef.Absolute) return anchor.altM;
  // Same rule as the prisms: no DEM is sea level.
  return (Number.isNaN(groundM) ? 0 : groundM) + anchor.altM;
}

/** Throws on an anchor or ground that would place the model at NaN; a NaN ground is the "no DEM" sentinel. */
export function assertPlaceable(anchor: ModelAnchor, groundM: number): void {
  for (const k of ['lat', 'lng', 'altM', 'headingDeg', 'scale'] as const) if (!Number.isFinite(anchor[k])) throw new Error(`Model anchor ${k} is ${anchor[k]}`);
  if (typeof groundM !== 'number' || groundM === Infinity || groundM === -Infinity) throw new Error(`Model ground is ${groundM}`);
}

/** Local e, n metres to lng/lat, heading and scale applied. */
export function localToLngLat(anchor: ModelAnchor, e: number, n: number): LngLat {
  const h = anchor.headingDeg * D2R;
  const c = Math.cos(h);
  const s = Math.sin(h);
  const E = anchor.scale * (e * c + n * s);
  const N = anchor.scale * (n * c - e * s);
  return E === 0 && N === 0 ? { lng: anchor.lng, lat: anchor.lat } : frameAt(anchor).fromEn(E, N);
}

/** Inverse of `localToLngLat`. */
export function lngLatToLocal(anchor: ModelAnchor, p: LngLat): [e: number, n: number] {
  const [E, N] = frameAt(anchor).toEn(p.lng, p.lat);
  const h = anchor.headingDeg * D2R;
  const c = Math.cos(h) / anchor.scale;
  const s = Math.sin(h) / anchor.scale;
  return [E * c - N * s, E * s + N * c];
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

/** Local e, n points to lng/lat at the anchor. */
export function hullFootprint(anchor: ModelAnchor, hull: readonly [number, number][]): [number, number][] {
  return hull.map(([e, n]) => {
    const g = localToLngLat(anchor, e, n);
    return [g.lng, g.lat];
  });
}

const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/**
 * Plan outlines in lng/lat that hide Overture rows and answer the target height: each part's ring for a
 * Drawn model, since a hull over a podium would swallow its neighbours; the footprint otherwise.
 */
export function modelOutlines(m: Pick<SavedModel, 'anchor' | 'parts' | 'footprint'>): [number, number][][] {
  if (!m.parts) return m.footprint.length >= 3 ? [m.footprint] : [];
  return m.parts
    .filter((p) => p.ring.length >= 3)
    .map((p) =>
      p.ring.map(([e, n]) => {
        const g = localToLngLat(m.anchor, e, n);
        return [g.lng, g.lat] as [number, number];
      })
    );
}

/** Andrew's monotone chain; counter-clockwise, no repeated end point. */
export function convexHull(pts: readonly [number, number][]): [number, number][] {
  const p = pts.toSorted((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  // Round-off twins (one vertex at two heights through ECEF) must not survive as a sliver.
  const EPS = 1e-18;
  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= EPS) lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= EPS) upper.pop();
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
