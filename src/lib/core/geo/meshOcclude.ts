/** Occlusion by placed model meshes, for the overlay objects the GPU picture cannot hide. */

import type { SurfaceMesh } from './surfaces';

/** Triangles per leaf. */
const LEAF = 4;
/** Box slack, metres, so float rounding in the slab test never drops a triangle the exact test would hit. */
const PAD_M = 1e-4;

/** Anything that can say whether it blocks the eye's view along a direction. */
export interface Occluder {
  occludes(e: number, n: number, u: number, distM: number): boolean;
}

let stack = new Int32Array(64);

/** A built hierarchy as plain arrays, so a worker can build it and transfer it. */
export interface MeshOccluderParts {
  /** Nine coordinates per triangle, in leaf order. */
  tris: Float64Array;
  /** minE, minN, minU, maxE, maxN, maxU per node; a node's left child follows it. */
  boxes: Float64Array;
  /** Per node: right child and 0, or first triangle and count for a leaf. */
  nodes: Int32Array;
}

/** Triangles in a bounding-volume hierarchy, tested by Möller–Trumbore at the leaves. */
export class MeshOccluder implements Occluder {
  private readonly tris: Float64Array;
  private readonly boxes: Float64Array;
  private readonly nodes: Int32Array;

  constructor(from: Iterable<SurfaceMesh> | MeshOccluderParts) {
    const p = 'tris' in from ? from : meshOccluderParts(from);
    this.tris = p.tris;
    this.boxes = p.boxes;
    this.nodes = p.nodes;
  }

  get triangles(): number {
    return this.tris.length / 9;
  }

  occludes(e: number, n: number, u: number, distM: number): boolean {
    const len = Math.hypot(e, n, u);
    if (len < 1e-9 || this.tris.length === 0) return false;
    const dx = e / len;
    const dy = n / len;
    const dz = u / len;
    const ix = 1 / dx;
    const iy = 1 / dy;
    const iz = 1 / dz;
    const B = this.boxes;
    const N = this.nodes;
    const T = this.tris;
    let sp = 0;
    stack[sp++] = 0;
    while (sp > 0) {
      const id = stack[--sp];
      const b = id * 6;
      // The ray starts at the eye, so each slab is entered at box/d; a zero component must straddle it.
      let tmin = 0;
      let tmax = distM;
      if (dx === 0) {
        if (B[b] > 0 || B[b + 3] < 0) continue;
      } else {
        const p = B[b] * ix;
        const q = B[b + 3] * ix;
        tmin = Math.max(tmin, Math.min(p, q));
        tmax = Math.min(tmax, Math.max(p, q));
      }
      if (dy === 0) {
        if (B[b + 1] > 0 || B[b + 4] < 0) continue;
      } else {
        const p = B[b + 1] * iy;
        const q = B[b + 4] * iy;
        tmin = Math.max(tmin, Math.min(p, q));
        tmax = Math.min(tmax, Math.max(p, q));
      }
      if (dz === 0) {
        if (B[b + 2] > 0 || B[b + 5] < 0) continue;
      } else {
        const p = B[b + 2] * iz;
        const q = B[b + 5] * iz;
        tmin = Math.max(tmin, Math.min(p, q));
        tmax = Math.min(tmax, Math.max(p, q));
      }
      if (tmin > tmax) continue;
      const cnt = N[id * 2 + 1];
      if (cnt === 0) {
        if (sp + 2 > stack.length) {
          const s = new Int32Array(stack.length * 2);
          s.set(stack);
          stack = s;
        }
        stack[sp++] = N[id * 2];
        stack[sp++] = id + 1;
        continue;
      }
      for (let t = N[id * 2], end = t + cnt; t < end; t++) {
        const o = t * 9;
        const e1x = T[o + 3] - T[o];
        const e1y = T[o + 4] - T[o + 1];
        const e1z = T[o + 5] - T[o + 2];
        const e2x = T[o + 6] - T[o];
        const e2y = T[o + 7] - T[o + 1];
        const e2z = T[o + 8] - T[o + 2];
        const px = dy * e2z - dz * e2y;
        const py = dz * e2x - dx * e2z;
        const pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det;
        // The eye is the origin, so s = -v0.
        const sx = -T[o];
        const sy = -T[o + 1];
        const sz = -T[o + 2];
        const bu = (sx * px + sy * py + sz * pz) * inv;
        if (bu < 0 || bu > 1) continue;
        const qx = sy * e1z - sz * e1y;
        const qy = sz * e1x - sx * e1z;
        const qz = sx * e1y - sy * e1x;
        const bv = (dx * qx + dy * qy + dz * qz) * inv;
        if (bv < 0 || bu + bv > 1) continue;
        const d = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (d > 0 && d < distM) return true;
      }
    }
    return false;
  }
}

/** Builds the hierarchy, splitting on the longest centroid axis. */
export function meshOccluderParts(meshes: Iterable<SurfaceMesh>): MeshOccluderParts {
  let n = 0;
  for (const m of meshes) n += Math.floor(m.idx.length / 3);
  const src = new Float64Array(n * 9);
  const cen = new Float64Array(n * 3);
  let t = 0;
  for (const m of meshes) {
    for (let i = 0; i + 2 < m.idx.length; i += 3, t++) {
      for (let k = 0; k < 3; k++) {
        const v = m.idx[i + k] * 3;
        for (let c = 0; c < 3; c++) {
          src[t * 9 + k * 3 + c] = m.pos[v + c];
          cen[t * 3 + c] += m.pos[v + c];
        }
      }
    }
  }
  const order = Int32Array.from({ length: n }, (_, i) => i);
  const boxes = new Float64Array(Math.max(1, 2 * n) * 6);
  const nodes = new Int32Array(Math.max(1, 2 * n) * 2);
  let count = 0;
  const build = (lo: number, hi: number): void => {
    const id = count++;
    let a0 = Infinity, b0 = Infinity, c0 = Infinity, a1 = -Infinity, b1 = -Infinity, c1 = -Infinity;
    for (let i = lo; i < hi; i++) {
      const c = order[i] * 3;
      if (cen[c] < a0) a0 = cen[c];
      if (cen[c] > a1) a1 = cen[c];
      if (cen[c + 1] < b0) b0 = cen[c + 1];
      if (cen[c + 1] > b1) b1 = cen[c + 1];
      if (cen[c + 2] < c0) c0 = cen[c + 2];
      if (cen[c + 2] > c1) c1 = cen[c + 2];
    }
    const bo = id * 6;
    const ex = a1 - a0, ey = b1 - b0, ez = c1 - c0;
    if (hi - lo <= LEAF || !(Math.max(ex, ey, ez) > 0)) {
      nodes[id * 2] = lo;
      nodes[id * 2 + 1] = hi - lo;
      boxes.fill(Infinity, bo, bo + 3);
      boxes.fill(-Infinity, bo + 3, bo + 6);
      for (let i = lo; i < hi; i++) {
        const o = order[i] * 9;
        for (let k = 0; k < 9; k++) {
          const c = k % 3;
          if (src[o + k] - PAD_M < boxes[bo + c]) boxes[bo + c] = src[o + k] - PAD_M;
          if (src[o + k] + PAD_M > boxes[bo + 3 + c]) boxes[bo + 3 + c] = src[o + k] + PAD_M;
        }
      }
      return;
    }
    const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
    // Split at the centroid midpoint; a lopsided cut falls back to the median.
    const cut = axis === 0 ? a0 + ex / 2 : axis === 1 ? b0 + ey / 2 : c0 + ez / 2;
    let mid = lo;
    for (let i = lo; i < hi; i++) {
      if (cen[order[i] * 3 + axis] < cut) {
        const sw = order[i];
        order[i] = order[mid];
        order[mid++] = sw;
      }
    }
    if (mid === lo || mid === hi) {
      mid = (lo + hi) >> 1;
      select(order, cen, axis, lo, hi - 1, mid);
    }
    build(lo, mid);
    const right = count;
    nodes[id * 2] = right;
    nodes[id * 2 + 1] = 0;
    build(mid, hi);
    const l = (id + 1) * 6;
    const r = right * 6;
    for (let c = 0; c < 3; c++) {
      boxes[bo + c] = Math.min(boxes[l + c], boxes[r + c]);
      boxes[bo + 3 + c] = Math.max(boxes[l + 3 + c], boxes[r + 3 + c]);
    }
  };
  if (n > 0) build(0, n);
  const tris = new Float64Array(n * 9);
  for (let i = 0; i < n; i++) for (let k = 0, o = order[i] * 9; k < 9; k++) tris[i * 9 + k] = src[o + k];
  return { tris, boxes: boxes.slice(0, count * 6), nodes: nodes.slice(0, count * 2) };
}

/** Quickselect: puts the `k`th triangle by centroid along `axis` at `k`, smaller ones before it. */
function select(order: Int32Array, cen: Float64Array, axis: number, lo: number, hi: number, k: number): void {
  while (hi > lo) {
    const pivot = cen[order[(lo + hi) >> 1] * 3 + axis];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (cen[order[i] * 3 + axis] < pivot) i++;
      while (cen[order[j] * 3 + axis] > pivot) j--;
      if (i <= j) {
        const s = order[i];
        order[i] = order[j];
        order[j] = s;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return;
  }
}

/** Blocks when any of its parts does. */
export function anyOccluder(parts: readonly (Occluder | null)[]): Occluder | null {
  const live = parts.filter((p): p is Occluder => !!p);
  if (live.length <= 1) return live[0] ?? null;
  return { occludes: (e, n, u, d) => live.some((p) => p.occludes(e, n, u, d)) };
}
