/** One decoded LoD2 tile in lng/lat/sea level, and its placement in the viewfinder's eye-relative frame. */

import { bearingDeg, curvatureDropM, distanceM, type LngLat } from '@core/geo/geodesy';
import { boxOf, type SurfaceMesh } from '@core/geo/surfaces';
import { convexHull } from '@core/model';
import { propertyColumn, type GltfWorld } from '@core/model/gltf';
import { ecefToGeodetic } from './ecef';
import type { Lod2Region } from './regions';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export interface Lod2Building {
  id: string;
  /** Convex hull of the building's vertices, lng/lat, counter-clockwise. */
  hull: [number, number][];
  /** Sea-level altitude of its lowest and highest vertex. */
  baseM: number;
  apexM: number;
  /** Hull centroid. */
  c: LngLat;
}

export interface Lod2Tile {
  /** lng, lat, sea-level altitude per vertex, Float64. */
  world: Float64Array;
  idx: Uint32Array;
  /** Index into `buildings` per vertex; -1 for a vertex outside any feature. */
  building: Int32Array;
  buildings: Lod2Building[];
  /** Metres subtracted from ellipsoidal heights to reach sea level; at the bbox centre when a geoid grid sets it per vertex. */
  datumM: number;
  /** Heights went through an imported geoid grid. */
  geoidGrid: boolean;
  /** lng0, lat0, lng1, lat1 over every vertex. */
  bbox: [number, number, number, number];
}

function median(v: number[]): number {
  const s = v.toSorted((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * The tile's GLB world through `transform` (3D Tiles' y-up turn first) into lng/lat and sea-level
 * altitude. With a ground column the datum is the median of each building's lowest vertex above
 * its recorded ground, so the geoid is read off the data rather than assumed. `batch` holds a b3dm's
 * batch-table columns, read where the GLB has no property table. `geoid` (lat, lng → metres) replaces
 * `region.geoidM` per vertex when there is no ground column.
 */
export function lod2Tile(w: GltfWorld, transform: Float64Array, region: Lod2Region, batch: Readonly<Record<string, readonly unknown[]>> = {}, geoid?: (lat: number, lng: number) => number): Lod2Tile {
  const nv = w.pos.length / 3;
  const m = transform;
  const geo = new Float64Array(nv * 3);
  const [rx, ry, rz] = w.rtc ?? [0, 0, 0];
  for (let v = 0; v < nv; v++) {
    const x = w.pos[v * 3] + rx;
    const y = ry - w.pos[v * 3 + 2];
    const z = w.pos[v * 3 + 1] + rz;
    const g = ecefToGeodetic(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
    geo[v * 3] = g.lng;
    geo[v * 3 + 1] = g.lat;
    geo[v * 3 + 2] = g.h;
  }
  const column = (name?: string) => (name ? (propertyColumn(w, 0, name) ?? batch[name]) : undefined);
  const ground = column(region.groundProperty);
  const ids = column(region.idProperty);
  const slot = new Map<number, number>();
  const building = new Int32Array(nv).fill(-1);
  const pts: [number, number][][] = [];
  const lo: number[] = [];
  const hi: number[] = [];
  const fid: number[] = [];
  for (let v = 0; v < nv; v++) {
    const f = w.feature[v];
    if (f < 0) continue;
    let b = slot.get(f);
    if (b === undefined) {
      b = pts.length;
      slot.set(f, b);
      pts.push([]);
      lo.push(Infinity);
      hi.push(-Infinity);
      fid.push(f);
    }
    building[v] = b;
    pts[b].push([geo[v * 3], geo[v * 3 + 1]]);
    lo[b] = Math.min(lo[b], geo[v * 3 + 2]);
    hi[b] = Math.max(hi[b], geo[v * 3 + 2]);
  }
  const offs: number[] = [];
  if (ground) for (let b = 0; b < fid.length; b++) if (typeof ground[fid[b]] === 'number' && Number.isFinite(ground[fid[b]])) offs.push(lo[b] - (ground[fid[b]] as number));
  const perVertex = offs.length === 0 ? geoid : undefined;
  const bbox: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let v = 0; v < nv; v++) {
    bbox[0] = Math.min(bbox[0], geo[v * 3]);
    bbox[1] = Math.min(bbox[1], geo[v * 3 + 1]);
    bbox[2] = Math.max(bbox[2], geo[v * 3]);
    bbox[3] = Math.max(bbox[3], geo[v * 3 + 1]);
  }
  const datumM = offs.length > 0 ? median(offs) : perVertex ? perVertex((bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2) : region.geoidM;
  for (let v = 0; v < nv; v++) geo[v * 3 + 2] -= perVertex ? perVertex(geo[v * 3 + 1], geo[v * 3]) : datumM;
  if (perVertex) {
    lo.fill(Infinity);
    hi.fill(-Infinity);
    for (let v = 0; v < nv; v++) {
      const b = building[v];
      if (b < 0) continue;
      lo[b] = Math.min(lo[b], geo[v * 3 + 2]);
      hi[b] = Math.max(hi[b], geo[v * 3 + 2]);
    }
  }
  const shift = perVertex ? 0 : datumM;
  const buildings = pts.map((p, b): Lod2Building => {
    const hull = convexHull(p);
    let cx = 0;
    let cy = 0;
    for (const [x, y] of hull) {
      cx += x / hull.length;
      cy += y / hull.length;
    }
    const id = ids?.[fid[b]];
    return { id: typeof id === 'string' ? id : `${fid[b]}`, hull, baseM: lo[b] - shift, apexM: hi[b] - shift, c: { lng: cx, lat: cy } };
  });
  return { world: geo, idx: w.idx, building, buildings, datumM, geoidGrid: perVertex !== undefined, bbox };
}

/** The triangles in the frame `buildPrisms` uses: one surface each, one sphere row per building. */
export function placeLod2(t: Lod2Tile, pin: LngLat, eyeM: number): SurfaceMesh {
  const nv = t.world.length / 3;
  const eye = new Float64Array(nv * 3);
  for (let v = 0; v < nv; v++) {
    const p = { lng: t.world[v * 3], lat: t.world[v * 3 + 1] };
    const d = distanceM(pin, p);
    const az = bearingDeg(pin, p) * D2R;
    const e = d * Math.sin(az);
    const n = d * Math.cos(az);
    eye[v * 3] = e;
    eye[v * 3 + 1] = n;
    eye[v * 3 + 2] = t.world[v * 3 + 2] - eyeM - curvatureDropM(Math.hypot(e, n));
  }
  // Rows for the buildings plus one for stray triangles outside any feature.
  const nb = t.buildings.length + 1;
  const dist = new Float64Array(nb);
  for (let b = 0; b < t.buildings.length; b++) dist[b] = distanceM(pin, t.buildings[b].c);
  dist[nb - 1] = distanceM(pin, { lng: (t.bbox[0] + t.bbox[2]) / 2, lat: (t.bbox[1] + t.bbox[3]) / 2 });
  const bb = new Float64Array(nb * 6);
  for (let b = 0; b < nb; b++) bb.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], b * 6);
  const pos: number[] = [];
  const plane: number[] = [];
  const surf: number[] = [];
  const bldg: number[] = [];
  for (let i = 0; i + 2 < t.idx.length; i += 3) {
    const a = t.idx[i] * 3;
    const b = t.idx[i + 1] * 3;
    const c = t.idx[i + 2] * 3;
    const ux = eye[b] - eye[a];
    const uy = eye[b + 1] - eye[a + 1];
    const uz = eye[b + 2] - eye[a + 2];
    const vx = eye[c] - eye[a];
    const vy = eye[c + 1] - eye[a + 1];
    const vz = eye[c + 2] - eye[a + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz);
    if (!(nl > 1e-9)) continue;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const row = t.building[t.idx[i]] < 0 ? nb - 1 : t.building[t.idx[i]];
    plane.push(nx, ny, nz, nx * eye[a] + ny * eye[a + 1] + nz * eye[a + 2]);
    surf.push(1, Math.atan2(nx, ny) * R2D, Math.hypot(nx, ny), Math.max(1, dist[row]));
    for (const o of [a, b, c]) {
      pos.push(eye[o], eye[o + 1], eye[o + 2]);
      bldg.push(row);
      for (let k = 0; k < 3; k++) {
        bb[row * 6 + k] = Math.min(bb[row * 6 + k], eye[o + k]);
        bb[row * 6 + 3 + k] = Math.max(bb[row * 6 + 3 + k], eye[o + k]);
      }
    }
  }
  const nt = plane.length / 4;
  const sphere = new Float32Array(nb * 4);
  const size = new Float32Array(nb * 4);
  for (let b = 0; b < nb; b++) {
    const o = b * 6;
    if (!(bb[o] <= bb[o + 3])) continue;
    sphere.set([(bb[o] + bb[o + 3]) / 2, (bb[o + 1] + bb[o + 4]) / 2, (bb[o + 2] + bb[o + 5]) / 2, Math.hypot(bb[o + 3] - bb[o], bb[o + 4] - bb[o + 1], bb[o + 5] - bb[o + 2]) / 2], b * 4);
    size.set([dist[b], Math.hypot(bb[o + 3] - bb[o], bb[o + 4] - bb[o + 1]), bb[o + 5] - bb[o + 2], 1], b * 4);
  }
  const surfId = new Float32Array(nt * 3);
  for (let i = 0; i < surfId.length; i++) surfId[i] = Math.floor(i / 3);
  return {
    pos: Float32Array.from(pos),
    surfId,
    bldgId: Float32Array.from(bldg),
    idx: Uint32Array.from({ length: nt * 3 }, (_, i) => i),
    plane: Float32Array.from(plane),
    surf: Float32Array.from(surf),
    sphere,
    size,
    box: boxOf(pos),
    doubleSided: false,
    count: t.buildings.length
  };
}

/** World triangles, nine numbers each, as the mask stamps them. */
export function lod2Triangles(t: Lod2Tile): Float64Array {
  const out = new Float64Array(t.idx.length * 3);
  for (let i = 0; i < t.idx.length; i++) out.set(t.world.subarray(t.idx[i] * 3, t.idx[i] * 3 + 3), i * 3);
  return out;
}

/** Index of the building whose hull holds `p`, nearest centroid first when hulls overlap; -1 for none. */
export function lod2BuildingAt(t: Lod2Tile, p: LngLat): number {
  let best = -1;
  let bestD = Infinity;
  for (let b = 0; b < t.buildings.length; b++) {
    const h = t.buildings[b].hull;
    if (!inHull(h, p)) continue;
    const d = distanceM(p, t.buildings[b].c);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

function inHull(h: readonly [number, number][], p: LngLat): boolean {
  if (h.length < 3) return false;
  for (let a = 0, b = h.length - 1; a < h.length; b = a++) if ((h[a][0] - h[b][0]) * (p.lat - h[b][1]) - (h[a][1] - h[b][1]) * (p.lng - h[b][0]) < 0) return false;
  return true;
}
