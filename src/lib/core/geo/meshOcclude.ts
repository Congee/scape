/** Occlusion by placed model meshes, for the overlay objects the GPU picture cannot hide. */

import type { SurfaceMesh } from './surfaces';

const R2D = 180 / Math.PI;
const BUCKETS = 360;

/** Anything that can say whether it blocks the eye's view along a direction. */
export interface Occluder {
  occludes(e: number, n: number, u: number, distM: number): boolean;
}

/** Triangles bucketed by the azimuths they span, tested by Möller–Trumbore. */
export class MeshOccluder implements Occluder {
  private readonly buckets: number[][] = Array.from({ length: BUCKETS }, () => []);
  private readonly tris: Float64Array;

  constructor(meshes: Iterable<SurfaceMesh>) {
    const all: number[] = [];
    for (const m of meshes) {
      for (let t = 0; t + 2 < m.idx.length; t += 3) for (let k = 0; k < 3; k++) all.push(m.pos[m.idx[t + k] * 3], m.pos[m.idx[t + k] * 3 + 1], m.pos[m.idx[t + k] * 3 + 2]);
    }
    this.tris = Float64Array.from(all);
    for (let t = 0; t < this.tris.length / 9; t++) {
      const o = t * 9;
      const a0 = Math.atan2(this.tris[o], this.tris[o + 1]) * R2D;
      let lo = 0;
      let hi = 0;
      let everywhere = false;
      for (let k = 1; k < 3; k++) {
        const e = this.tris[o + k * 3];
        const n = this.tris[o + k * 3 + 1];
        if (Math.hypot(e, n) < 1e-6) everywhere = true;
        const d = ((((Math.atan2(e, n) * R2D - a0) % 360) + 540) % 360) - 180;
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
      }
      // Unwrapped against the first vertex; a triangle wrapping the eye can span more than a half turn.
      if (everywhere || Math.hypot(this.tris[o], this.tris[o + 1]) < 1e-6 || hi - lo >= 180) {
        for (const b of this.buckets) b.push(t);
        continue;
      }
      const b0 = Math.floor(a0 + lo) - 1;
      const b1 = Math.min(Math.ceil(a0 + hi) + 1, b0 + BUCKETS - 1);
      for (let b = b0; b <= b1; b++) this.buckets[((b % BUCKETS) + BUCKETS) % BUCKETS].push(t);
    }
  }

  get triangles(): number {
    return this.tris.length / 9;
  }

  occludes(e: number, n: number, u: number, distM: number): boolean {
    const len = Math.hypot(e, n, u);
    if (len < 1e-9) return false;
    const dx = e / len;
    const dy = n / len;
    const dz = u / len;
    const az = Math.atan2(dx, dy) * R2D;
    const bucket = this.buckets[((Math.floor(az) % BUCKETS) + BUCKETS) % BUCKETS];
    const T = this.tris;
    for (const t of bucket) {
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
    return false;
  }
}

/** Blocks when any of its parts does. */
export function anyOccluder(parts: readonly (Occluder | null)[]): Occluder | null {
  const live = parts.filter((p): p is Occluder => !!p);
  if (live.length <= 1) return live[0] ?? null;
  return { occludes: (e, n, u, d) => live.some((p) => p.occludes(e, n, u, d)) };
}
