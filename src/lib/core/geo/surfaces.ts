/**
 * Planar surfaces in eye-relative metres, the one shape the GPU draws: the prisms and the precise
 * models both land here, so per-pixel plane depth, culls and cascades treat them alike.
 */

import type { PrismTile } from './prismRaster';

export interface SurfaceMesh {
  /** e, n, u per vertex. */
  pos: Float32Array;
  /** Surface and building row of each vertex. */
  surfId: Float32Array;
  bldgId: Float32Array;
  idx: Uint32Array;
  /** Per surface: plane `N·P = pc` as nx, ny, nz, pc. */
  plane: Float32Array;
  /** Per surface: kind (0 wall, 1 roof), bearing, horizontality, distance. */
  surf: Float32Array;
  /** Per building row: bounding sphere e, n, u, r. */
  sphere: Float32Array;
  /** Per building row: distance, span, rise, and 1 to draw, 2 to draw without the sub-pixel cull. */
  size: Float32Array;
  /** minE, minN, minU, maxE, maxN, maxU. */
  box: Float32Array;
  /** Open meshes: no face culling, and the plane turns toward the eye per pixel. */
  doubleSided: boolean;
  /** Building rows, for the stats. */
  count: number;
}

/** Ear clip of one face, already flattened onto its own plane; the output winds counter-clockwise in it. */
export function earClip(px: readonly number[], py: readonly number[], base: number, out: number[]): void {
  const m = px.length;
  if (m < 3) return;
  const idx: number[] = [];
  let area = 0;
  for (let i = 0, j = m - 1; i < m; j = i++) area += px[j] * py[i] - px[i] * py[j];
  for (let i = 0; i < m; i++) idx.push(area >= 0 ? i : m - 1 - i);
  const cross = (a: number, b: number, c: number) => (px[b] - px[a]) * (py[c] - py[a]) - (py[b] - py[a]) * (px[c] - px[a]);
  let guard = m * m + 8;
  while (idx.length > 3 && guard-- > 0) {
    let cut = -1;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length];
      const b = idx[i];
      const c = idx[(i + 1) % idx.length];
      if (cross(a, b, c) <= 0) continue;
      let clear = true;
      for (const q of idx) {
        if (q === a || q === b || q === c) continue;
        if (cross(a, b, q) >= 0 && cross(b, c, q) >= 0 && cross(c, a, q) >= 0) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      cut = i;
      break;
    }
    if (cut < 0) break;
    const a = idx[(cut + idx.length - 1) % idx.length];
    const c = idx[(cut + 1) % idx.length];
    out.push(base + a, base + idx[cut], base + c);
    idx.splice(cut, 1);
  }
  // A self-intersecting ring has no ear left; a fan still covers most of it.
  for (let i = 1; i + 1 < idx.length; i++) out.push(base + idx[0], base + idx[i], base + idx[i + 1]);
}

/**
 * Drops the face normal's dominant axis so the ear clip runs in the plane's own two dimensions.
 * Each pair is right-handed about the axis it drops, and the pair is swapped where the normal runs
 * the other way, so the ear clip's counter-clockwise output always faces outward.
 */
export function flatten(nx: number, ny: number, nz: number, e: readonly number[], n: readonly number[], u: readonly number[]): { px: number[]; py: number[] } {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  if (az >= ax && az >= ay) return nz >= 0 ? { px: e.slice(), py: n.slice() } : { px: n.slice(), py: e.slice() };
  if (ax >= ay) return nx >= 0 ? { px: n.slice(), py: u.slice() } : { px: u.slice(), py: n.slice() };
  return ny >= 0 ? { px: u.slice(), py: e.slice() } : { px: e.slice(), py: u.slice() };
}

/** Bounds of a flat e, n, u array. */
export function boxOf(pos: ArrayLike<number>): Float32Array {
  const box = new Float32Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
  for (let j = 0; j + 2 < pos.length; j += 3)
    for (let k = 0; k < 3; k++) {
      const v = pos[j + k];
      if (v < box[k]) box[k] = v;
      if (v > box[k + 3]) box[k + 3] = v;
    }
  return box;
}

const built = new WeakMap<PrismTile, SurfaceMesh>();

/** Adopts the mesh the buildings worker built for `tile`. */
export function adoptPrismSurfaces(tile: PrismTile, mesh: SurfaceMesh): void {
  built.set(tile, mesh);
}

/** The adopted mesh of `tile`, else built here once. */
export function tileSurfaces(tile: PrismTile): SurfaceMesh {
  let m = built.get(tile);
  if (!m) built.set(tile, (m = prismSurfaces(tile)));
  return m;
}

/** Every typed array of `m`, for a transfer list. */
export function surfaceBuffers(m: SurfaceMesh): ArrayBuffer[] {
  return [m.pos, m.surfId, m.bldgId, m.idx, m.plane, m.surf, m.sphere, m.size, m.box].map((a) => a.buffer as ArrayBuffer);
}

/** One tile's prisms as closed, outward-wound surfaces: a plane per roof face and per wall. */
export function prismSurfaces(tile: PrismTile): SurfaceMesh {
  const pos: number[] = [];
  const attr: number[] = [];
  const idx: number[] = [];
  const plane: number[] = [];
  const surf: number[] = [];
  const fe: number[] = [];
  const fn: number[] = [];
  const fu: number[] = [];

  const emit = (bldg: number, nx: number, ny: number, nz: number, pc: number, kind: number, bearing: number, hor: number, dist: number, e: readonly number[], n: readonly number[], u: readonly number[]) => {
    const s = surf.length / 4;
    plane.push(nx, ny, nz, pc);
    surf.push(kind, bearing, hor, dist);
    const base = pos.length / 3;
    for (let j = 0; j < e.length; j++) {
      pos.push(e[j], n[j], u[j]);
      attr.push(s, bldg);
    }
    const flat = flatten(nx, ny, nz, e, n, u);
    earClip(flat.px, flat.py, base, idx);
  };

  for (let i = 0; i < tile.count; i++) {
    const s0 = tile.ringStart[i];
    const len = tile.ringStart[i + 1] - s0;
    if (len < 3) continue;
    const dist = Math.max(1, tile.distM[i]);
    for (let q = tile.faceStart[i]; q < tile.faceStart[i + 1]; q++) {
      const vs = tile.faceVert[q];
      const mv = tile.faceVert[q + 1] - vs;
      if (mv < 3) continue;
      fe.length = 0;
      fn.length = 0;
      fu.length = 0;
      for (let j = 0; j < mv; j++) {
        fe.push(tile.fE[vs + j]);
        fn.push(tile.fN[vs + j]);
        fu.push(tile.fU[vs + j]);
      }
      emit(i, tile.fNx[q], tile.fNy[q], tile.fNz[q], tile.fPc[q], 1, tile.fBear[q], tile.fHor[q], dist, fe, fn, fu);
    }
    for (let j = 0; j < len; j++) {
      const a = s0 + j;
      if (!tile.wOk[a]) continue;
      const b = s0 + ((j + 1) % len);
      const nx = tile.wNx[a];
      const ny = tile.wNy[a];
      emit(i, nx, ny, 0, nx * tile.e[a] + ny * tile.n[a], 0, tile.wBear[a], 0, dist, [tile.e[a], tile.e[b], tile.e[b], tile.e[a]], [tile.n[a], tile.n[b], tile.n[b], tile.n[a]], [tile.uBase[a], tile.uBase[b], tile.uTop[b], tile.uTop[a]]);
    }
  }

  const nv = pos.length / 3;
  const nb = Math.max(1, tile.count);
  const sphere = new Float32Array(nb * 4);
  const size = new Float32Array(nb * 4);
  for (let i = 0; i < tile.count; i++) {
    sphere[i * 4] = tile.cE[i];
    sphere[i * 4 + 1] = tile.cN[i];
    sphere[i * 4 + 2] = tile.cU[i];
    sphere[i * 4 + 3] = tile.radiusM[i];
    size[i * 4] = tile.distM[i];
    size[i * 4 + 1] = tile.spanM[i];
    size[i * 4 + 2] = tile.riseM[i];
    size[i * 4 + 3] = tile.ringStart[i + 1] - tile.ringStart[i] >= 3 ? 1 : 0;
  }
  const surfId = new Float32Array(nv);
  const bldgId = new Float32Array(nv);
  for (let j = 0; j < nv; j++) {
    surfId[j] = attr[j * 2];
    bldgId[j] = attr[j * 2 + 1];
  }
  return {
    pos: Float32Array.from(pos),
    surfId,
    bldgId,
    idx: Uint32Array.from(idx),
    plane: Float32Array.from(plane),
    surf: Float32Array.from(surf),
    sphere,
    size,
    box: boxOf(pos),
    doubleSided: false,
    count: tile.count
  };
}
