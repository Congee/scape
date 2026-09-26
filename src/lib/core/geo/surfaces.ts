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
  earClipAt(px, py, px.length, base, out, out.length);
}

let ring = new Int32Array(64);

/** {@link earClip} of the first `m` points into `out` from `at`: always `m - 2` triangles, returns the end. */
export function earClipAt(px: ArrayLike<number>, py: ArrayLike<number>, m: number, base: number, out: Uint32Array | number[], at: number): number {
  if (m < 3) return at;
  if (ring.length < m) ring = new Int32Array(m * 2);
  const idx = ring;
  let len = m;
  let area = 0;
  for (let i = 0, j = m - 1; i < m; j = i++) area += px[j] * py[i] - px[i] * py[j];
  for (let i = 0; i < m; i++) idx[i] = area >= 0 ? i : m - 1 - i;
  const cross = (a: number, b: number, c: number) => (px[b] - px[a]) * (py[c] - py[a]) - (py[b] - py[a]) * (px[c] - px[a]);
  let guard = m * m + 8;
  while (len > 3 && guard-- > 0) {
    let cut = -1;
    for (let i = 0; i < len; i++) {
      const a = idx[(i + len - 1) % len];
      const b = idx[i];
      const c = idx[(i + 1) % len];
      if (cross(a, b, c) <= 0) continue;
      let clear = true;
      for (let r = 0; r < len; r++) {
        const q = idx[r];
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
    out[at++] = base + idx[(cut + len - 1) % len];
    out[at++] = base + idx[cut];
    out[at++] = base + idx[(cut + 1) % len];
    idx.copyWithin(cut, cut + 1, len);
    len--;
  }
  // A self-intersecting ring has no ear left; a fan still covers most of it.
  for (let i = 1; i + 1 < len; i++) {
    out[at++] = base + idx[0];
    out[at++] = base + idx[i];
    out[at++] = base + idx[i + 1];
  }
  return at;
}

/**
 * Drops the face normal's dominant axis so the ear clip runs in the plane's own two dimensions.
 * Each pair is right-handed about the axis it drops, and the pair is swapped where the normal runs
 * the other way, so the ear clip's counter-clockwise output always faces outward.
 */
export function flatten(nx: number, ny: number, nz: number, e: readonly number[], n: readonly number[], u: readonly number[]): { px: number[]; py: number[] } {
  const ax = flatAxes(nx, ny, nz);
  const src = [e, n, u];
  return { px: src[ax >> 2].slice(), py: src[ax & 3].slice() };
}

/** The e/n/u axes (0, 1, 2) {@link flatten} keeps, as `px << 2 | py`. */
function flatAxes(nx: number, ny: number, nz: number): number {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  if (az >= ax && az >= ay) return nz >= 0 ? 0b0001 : 0b0100;
  if (ax >= ay) return nx >= 0 ? 0b0110 : 0b1001;
  return ny >= 0 ? 0b1000 : 0b0010;
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

/** Flattened points of the face being clipped, reused across tiles. */
let scratchPx = new Float64Array(64);
let scratchPy = new Float64Array(64);

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
  // Sized up front: this runs per tile on every rebuild, and grown arrays are GC the idle view pays for.
  let nv = 0;
  let ns = 0;
  for (let i = 0; i < tile.count; i++) {
    const s0 = tile.ringStart[i];
    const len = tile.ringStart[i + 1] - s0;
    if (len < 3) continue;
    for (let q = tile.faceStart[i]; q < tile.faceStart[i + 1]; q++) {
      const mv = tile.faceVert[q + 1] - tile.faceVert[q];
      if (mv < 3) continue;
      nv += mv;
      ns++;
    }
    for (let j = 0; j < len; j++)
      if (tile.wOk[s0 + j]) {
        nv += 4;
        ns++;
      }
  }
  const pos = new Float32Array(nv * 3);
  const surfId = new Float32Array(nv);
  const bldgId = new Float32Array(nv);
  // Each face of m points ear-clips to m - 2 triangles.
  const idx = new Uint32Array((nv - 2 * ns) * 3);
  const plane = new Float32Array(ns * 4);
  const surf = new Float32Array(ns * 4);
  let v = 0;
  let s = 0;
  let k = 0;

  /** Emits the surface whose `m` points were just written to pos from vertex `v`. */
  const emit = (bldg: number, m: number, nx: number, ny: number, nz: number, pc: number, kind: number, bearing: number, hor: number, dist: number) => {
    plane[s * 4] = nx;
    plane[s * 4 + 1] = ny;
    plane[s * 4 + 2] = nz;
    plane[s * 4 + 3] = pc;
    surf[s * 4] = kind;
    surf[s * 4 + 1] = bearing;
    surf[s * 4 + 2] = hor;
    surf[s * 4 + 3] = dist;
    if (scratchPx.length < m) {
      scratchPx = new Float64Array(m * 2);
      scratchPy = new Float64Array(m * 2);
    }
    const ax = flatAxes(nx, ny, nz);
    for (let j = 0; j < m; j++) {
      surfId[v + j] = s;
      bldgId[v + j] = bldg;
      scratchPx[j] = pos[(v + j) * 3 + (ax >> 2)];
      scratchPy[j] = pos[(v + j) * 3 + (ax & 3)];
    }
    k = earClipAt(scratchPx, scratchPy, m, v, idx, k);
    v += m;
    s++;
  };
  const put = (j: number, e: number, n: number, u: number) => {
    pos[j * 3] = e;
    pos[j * 3 + 1] = n;
    pos[j * 3 + 2] = u;
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
      for (let j = 0; j < mv; j++) put(v + j, tile.fE[vs + j], tile.fN[vs + j], tile.fU[vs + j]);
      emit(i, mv, tile.fNx[q], tile.fNy[q], tile.fNz[q], tile.fPc[q], 1, tile.fBear[q], tile.fHor[q], dist);
    }
    for (let j = 0; j < len; j++) {
      const a = s0 + j;
      if (!tile.wOk[a]) continue;
      const b = s0 + ((j + 1) % len);
      const nx = tile.wNx[a];
      const ny = tile.wNy[a];
      put(v, tile.e[a], tile.n[a], tile.uBase[a]);
      put(v + 1, tile.e[b], tile.n[b], tile.uBase[b]);
      put(v + 2, tile.e[b], tile.n[b], tile.uTop[b]);
      put(v + 3, tile.e[a], tile.n[a], tile.uTop[a]);
      emit(i, 4, nx, ny, 0, nx * tile.e[a] + ny * tile.n[a], 0, tile.wBear[a], 0, dist);
    }
  }

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
  return {
    pos,
    surfId,
    bldgId,
    idx,
    plane,
    surf,
    sphere,
    size,
    box: boxOf(pos),
    doubleSided: false,
    count: tile.count
  };
}
