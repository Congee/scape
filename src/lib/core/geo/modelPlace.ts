/** A model's local mesh placed in the viewfinder's eye-relative frame, the way `buildPrisms` places a footprint. */

import { localToLngLat, modelBaseM, type ModelAnchor, type ModelMesh } from '@core/model';
import { bearingDeg, curvatureDropM, distanceM, type LngLat } from './geodesy';
import { boxOf, type SurfaceMesh } from './surfaces';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Per vertex: lng, lat, and sea-level altitude, in Float64. */
export function modelWorld(mesh: ModelMesh, anchor: ModelAnchor, groundM: number): Float64Array {
  const base = modelBaseM(anchor, groundM);
  const nv = mesh.pos.length / 3;
  const out = new Float64Array(nv * 3);
  for (let v = 0; v < nv; v++) {
    const g = localToLngLat(anchor, mesh.pos[v * 3], mesh.pos[v * 3 + 1]);
    out[v * 3] = g.lng;
    out[v * 3 + 1] = g.lat;
    out[v * 3 + 2] = base + mesh.pos[v * 3 + 2] * anchor.scale;
  }
  return out;
}

/** World triangles, nine numbers each, as the workers take them. */
export function modelTriangles(mesh: ModelMesh, anchor: ModelAnchor, groundM: number): Float64Array {
  const w = modelWorld(mesh, anchor, groundM);
  const out = new Float64Array(mesh.idx.length * 3);
  for (let i = 0; i < mesh.idx.length; i++) out.set(w.subarray(mesh.idx[i] * 3, mesh.idx[i] * 3 + 3), i * 3);
  return out;
}

/**
 * One surface per triangle, so any mesh draws through the prism pass: pin distance and bearing,
 * and the curvature drop per vertex, exactly as `buildPrisms` does for a footprint.
 */
export function placeModel(mesh: ModelMesh, anchor: ModelAnchor, groundM: number, pin: LngLat, eyeM: number): SurfaceMesh {
  const w = modelWorld(mesh, anchor, groundM);
  const nv = w.length / 3;
  const eye = new Float64Array(nv * 3);
  for (let v = 0; v < nv; v++) {
    const p = { lng: w[v * 3], lat: w[v * 3 + 1] };
    const d = distanceM(pin, p);
    const az = bearingDeg(pin, p) * D2R;
    const ve = d * Math.sin(az);
    const vn = d * Math.cos(az);
    eye[v * 3] = ve;
    eye[v * 3 + 1] = vn;
    eye[v * 3 + 2] = w[v * 3 + 2] - eyeM - curvatureDropM(Math.hypot(ve, vn));
  }
  const dist = distanceM(pin, anchor);
  const pos: number[] = [];
  const plane: number[] = [];
  const surf: number[] = [];
  for (let t = 0; t + 2 < mesh.idx.length; t += 3) {
    const a = mesh.idx[t] * 3;
    const b = mesh.idx[t + 1] * 3;
    const c = mesh.idx[t + 2] * 3;
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
    plane.push(nx, ny, nz, nx * eye[a] + ny * eye[a + 1] + nz * eye[a + 2]);
    surf.push(1, Math.atan2(nx, ny) * R2D, Math.hypot(nx, ny), Math.max(1, dist));
    for (const o of [a, b, c]) pos.push(eye[o], eye[o + 1], eye[o + 2]);
  }
  const nt = plane.length / 4;
  const box = boxOf(pos);
  const sphere = new Float32Array(4);
  const size = new Float32Array(4);
  if (nt > 0) {
    sphere.set([(box[0] + box[3]) / 2, (box[1] + box[4]) / 2, (box[2] + box[5]) / 2, Math.hypot(box[3] - box[0], box[4] - box[1], box[5] - box[2]) / 2]);
    size.set([dist, Math.hypot(box[3] - box[0], box[4] - box[1]), box[5] - box[2], 2]);
  }
  const surfId = new Float32Array(nt * 3);
  for (let i = 0; i < surfId.length; i++) surfId[i] = Math.floor(i / 3);
  return {
    pos: Float32Array.from(pos),
    surfId,
    bldgId: new Float32Array(nt * 3),
    idx: Uint32Array.from({ length: nt * 3 }, (_, i) => i),
    plane: Float32Array.from(plane),
    surf: Float32Array.from(surf),
    sphere,
    size,
    box,
    doubleSided: true,
    count: 1
  };
}
