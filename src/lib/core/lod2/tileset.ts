/** A pure 3D Tiles walker: which content a pinhole view at the pin needs, nearest first. */

import { bearingDeg, distanceM, normalizeBearing, type LngLat } from '@core/geo/geodesy';
import { ecefToGeodetic, geodeticToEcef } from './ecef';

export interface BoundingVolume {
  box?: number[];
  region?: number[];
  sphere?: number[];
}

export interface TileContentJson {
  uri?: string;
  /** 3D Tiles 1.0 pre-release spelling. */
  url?: string;
}

export interface TileJson {
  boundingVolume: BoundingVolume;
  geometricError: number;
  refine?: string;
  transform?: number[];
  content?: TileContentJson;
  contents?: TileContentJson[];
  children?: TileJson[];
}

export interface TilesetJson {
  asset?: { version?: string };
  geometricError?: number;
  root: TileJson;
}

/** ECEF centre and radius. */
export interface Sphere {
  x: number;
  y: number;
  z: number;
  r: number;
}

export interface WalkView {
  pin: LngLat;
  /** Eye height above the ellipsoid; metres of datum error only nudge the error test. */
  eyeH: number;
  /** Screen pixels per radian at the frame centre. */
  pxPerRad: number;
  /** Refine while a tile's error would exceed this many pixels. */
  maxErrorPx: number;
  rangeM: number;
  azFromDeg: number;
  /** 360 or more sees all around. */
  azSpanDeg: number;
}

export interface WalkContent {
  url: string;
  /** Column-major tile transform chain, applied after the content's y-up to z-up turn. */
  transform: Float64Array;
  sphere: Sphere;
  /** Ground distance from the pin to the volume's nearest edge. */
  distM: number;
  geometricError: number;
}

export interface WalkResult {
  /** Nearest first. */
  contents: WalkContent[];
  /** External tilesets the walk reached but `get` did not have yet. */
  pending: string[];
}

export const Refine = { Add: 'ADD', Replace: 'REPLACE' } as const;
export type Refine = (typeof Refine)[keyof typeof Refine];

const IDENTITY = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const MAX_DEPTH = 64;

export function mul4(a: Float64Array, b: ArrayLike<number>): Float64Array {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  return o;
}

function apply(m: Float64Array, x: number, y: number, z: number, w: number): [number, number, number] {
  return [m[0] * x + m[4] * y + m[8] * z + m[12] * w, m[1] * x + m[5] * y + m[9] * z + m[13] * w, m[2] * x + m[6] * y + m[10] * z + m[14] * w];
}

/** The volume's bounding sphere in ECEF; a region ignores `m`, as the spec says. */
export function volumeSphere(v: BoundingVolume, m: Float64Array): Sphere {
  if (v.box && v.box.length === 12) {
    const b = v.box;
    const [x, y, z] = apply(m, b[0], b[1], b[2], 1);
    let r2 = 0;
    for (let k = 3; k < 12; k += 3) {
      const h = apply(m, b[k], b[k + 1], b[k + 2], 0);
      r2 += h[0] * h[0] + h[1] * h[1] + h[2] * h[2];
    }
    return { x, y, z, r: Math.sqrt(r2) };
  }
  if (v.sphere && v.sphere.length === 4) {
    const s = v.sphere;
    const [x, y, z] = apply(m, s[0], s[1], s[2], 1);
    const scale = Math.max(Math.hypot(m[0], m[1], m[2]), Math.hypot(m[4], m[5], m[6]), Math.hypot(m[8], m[9], m[10]));
    return { x, y, z, r: s[3] * scale };
  }
  if (v.region && v.region.length === 6) {
    const [w, s, e, n, h0, h1] = v.region;
    const R2D = 180 / Math.PI;
    const pts: [number, number, number][] = [];
    for (const lng of [w, (w + e) / 2, e])
      for (const lat of [s, (s + n) / 2, n]) for (const h of [h0, h1]) pts.push(geodeticToEcef(lng * R2D, lat * R2D, h));
    const c = [0, 0, 0];
    for (const p of pts) for (let k = 0; k < 3; k++) c[k] += p[k] / pts.length;
    const r = Math.max(...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])));
    return { x: c[0], y: c[1], z: c[2], r };
  }
  throw new Error('Tile bounding volume is not a box, region or sphere');
}

/** Resolve `uri` against the tileset URL it appears in. */
export function resolveUri(base: string, uri: string): string {
  return new URL(uri, base).href;
}

const isTileset = (url: string) => /\.json($|\?)/i.test(url);

interface Placed {
  sphere: Sphere;
  /** Ground distance from the pin to the sphere's edge. */
  distM: number;
  /** Straight-line distance from the eye to the sphere's edge. */
  eyeDistM: number;
  visible: boolean;
}

function place(s: Sphere, view: WalkView, eye: readonly number[]): Placed {
  const g = ecefToGeodetic(s.x, s.y, s.z);
  const d = distanceM(view.pin, g);
  const distM = Math.max(0, d - s.r);
  const eyeDistM = Math.max(0, Math.hypot(s.x - eye[0], s.y - eye[1], s.z - eye[2]) - s.r);
  let visible = distM <= view.rangeM;
  if (visible && view.azSpanDeg < 360 && d > s.r) {
    const half = Math.asin(Math.min(1, s.r / d)) * (180 / Math.PI);
    const off = normalizeBearing(bearingDeg(view.pin, g) - view.azFromDeg);
    // Inside the wedge, or within the volume's angular radius of either edge.
    visible = off <= view.azSpanDeg + half || off >= 360 - half;
  }
  return { sphere: s, distM, eyeDistM, visible };
}

/**
 * Walk the tileset from `rootUrl`. `get` answers the tilesets already fetched (the root among them);
 * a reached tileset it lacks lands in `pending`, and a REPLACE parent stands in until it arrives.
 */
export function walkTileset(rootUrl: string, get: (url: string) => TilesetJson | undefined, view: WalkView): WalkResult {
  const contents: WalkContent[] = [];
  const pending = new Set<string>();
  const eye = geodeticToEcef(view.pin.lng, view.pin.lat, view.eyeH);
  const seen = new Set<string>();

  const needsRefine = (p: Placed, error: number) => (error * view.pxPerRad) / Math.max(1, p.eyeDistM) > view.maxErrorPx;

  const drawOwn = (tile: TileJson, base: string, m: Float64Array, p: Placed, depth: number, refine: string) => {
    for (const c of tile.contents ?? (tile.content ? [tile.content] : [])) {
      const rel = c.uri ?? c.url;
      if (!rel) continue;
      const url = resolveUri(base, rel);
      if (isTileset(url)) {
        const ts = get(url);
        if (!ts) pending.add(url);
        else if (!seen.has(url)) {
          seen.add(url);
          visit(ts.root, url, m, depth + 1, refine);
          seen.delete(url);
        }
      } else contents.push({ url, transform: m, sphere: p.sphere, distM: p.distM, geometricError: tile.geometricError });
    }
  };

  const visit = (tile: TileJson, base: string, parent: Float64Array, depth: number, inherited: string) => {
    if (depth > MAX_DEPTH) throw new Error('Tileset nests too deep');
    const m = tile.transform ? mul4(parent, tile.transform) : parent;
    const p = place(volumeSphere(tile.boundingVolume, m), view, eye);
    if (!p.visible) return;
    const refine = (tile.refine ?? inherited).toUpperCase();
    const kids = tile.children ?? [];
    if (kids.length === 0 || !needsRefine(p, tile.geometricError)) {
      drawOwn(tile, base, m, p, depth, refine);
      return;
    }
    if (refine === Refine.Add) drawOwn(tile, base, m, p, depth, refine);
    // REPLACE keeps the parent's content until every child tileset is here.
    const mark = contents.length;
    const before = pending.size;
    for (const k of kids) visit(k, base, m, depth + 1, refine);
    if (refine !== Refine.Add && pending.size > before && (tile.content || tile.contents?.length)) {
      contents.length = mark;
      drawOwn(tile, base, m, p, depth, refine);
    }
  };

  const root = get(rootUrl);
  if (!root) return { contents, pending: [rootUrl] };
  seen.add(rootUrl);
  visit(root.root, rootUrl, IDENTITY, 0, Refine.Replace);
  contents.sort((a, b) => a.distM - b.distM);
  return { contents, pending: [...pending] };
}
