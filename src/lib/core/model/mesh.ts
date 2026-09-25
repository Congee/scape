/** A Drawn model's parts as a closed, outward-wound triangle mesh in the anchor's frame. */

import { buildRoof } from '@core/geo/roofs';
import { boxOf, earClip, flatten } from '@core/geo/surfaces';
import { hullFootprint, partsFootprint, type ModelMesh, type ModelPart, type SavedModel } from '@core/model';
import { DEFAULT_IMPORT, GltfError, parseGlb, validateMesh, type ImportOptions, type ValidMesh } from './gltf';
import { modelApexM } from './seed';

/** Walls, roof faces and a floor under every part: a closed solid. */
export function partsMesh(parts: readonly ModelPart[]): ModelMesh {
  const pos: number[] = [];
  const tri = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number) => {
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    if (!(area > 1e-9)) return;
    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  };
  /** A planar polygon, ear-clipped facing along `nz`'s sign: up for roofs, down for floors. */
  const face = (e: readonly number[], n: readonly number[], u: readonly number[], up: boolean) => {
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let j = 0, k = e.length - 1; j < e.length; k = j++) {
      nx += (n[k] - n[j]) * (u[k] + u[j]);
      ny += (u[k] - u[j]) * (e[k] + e[j]);
      nz += (e[k] - e[j]) * (n[k] + n[j]);
    }
    if (!(Math.hypot(nx, ny, nz) > 1e-12)) return;
    const s = (nz >= 0) === up ? 1 : -1;
    const flat = flatten(nx * s, ny * s, nz * s, e, n, u);
    const idx: number[] = [];
    earClip(flat.px, flat.py, 0, idx);
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
      tri(e[a], n[a], u[a], e[b], n[b], u[b], e[c], n[c], u[c]);
    }
  };

  for (const p of parts) {
    if (p.ring.length < 3 || !(p.heightM > p.baseM)) continue;
    const re = p.ring.map((v) => v[0]);
    const rn = p.ring.map((v) => v[1]);
    const roof = buildRoof(re, rn, p.heightM - p.baseM, p.heightM, p.roof, p.roofHeightM, p.roofDirDeg, p.roofAcross);
    const len = roof.ringE.length;
    if (len < 3) continue;
    let area = 0;
    for (let j = 0, k = len - 1; j < len; k = j++) area += roof.ringE[k] * roof.ringN[j] - roof.ringE[j] * roof.ringN[k];
    const ccw = area >= 0;
    const b = p.baseM;
    for (let j = 0; j < len; j++) {
      const k = (j + 1) % len;
      const [ae, an, au] = [roof.ringE[j], roof.ringN[j], roof.ringU[j]];
      const [be, bn, bu] = [roof.ringE[k], roof.ringN[k], roof.ringU[k]];
      // Seen from outside, a counter-clockwise ring's edge runs left to right.
      if (ccw) {
        tri(ae, an, b, be, bn, b, be, bn, bu);
        tri(ae, an, b, be, bn, bu, ae, an, au);
      } else {
        tri(ae, an, b, be, bn, bu, be, bn, b);
        tri(ae, an, b, ae, an, au, be, bn, bu);
      }
    }
    for (const f of roof.faces) {
      const m = f.length / 3;
      if (m < 3) continue;
      const fe: number[] = [];
      const fn: number[] = [];
      const fu: number[] = [];
      for (let j = 0; j < m; j++) {
        fe.push(f[j * 3]);
        fn.push(f[j * 3 + 1]);
        fu.push(f[j * 3 + 2]);
      }
      face(fe, fn, fu, true);
    }
    face(roof.ringE, roof.ringN, roof.ringE.map(() => b), false);
  }
  return { pos: Float32Array.from(pos), idx: Uint32Array.from({ length: pos.length / 3 }, (_, i) => i), box: boxOf(pos) };
}

const parsed = new WeakMap<ArrayBuffer, Map<string, ValidMesh | GltfError>>();

/** An Imported model's bytes parsed and cleaned once per buffer and options; throws GltfError. */
export function importedMesh(glb: ArrayBuffer, opts: ImportOptions = DEFAULT_IMPORT): ValidMesh {
  const key = `${opts.units}|${opts.zUp}|${opts.origin}`;
  let byOpts = parsed.get(glb);
  if (!byOpts) parsed.set(glb, (byOpts = new Map()));
  let v = byOpts.get(key);
  if (!v) {
    try {
      v = validateMesh(parseGlb(glb, opts).mesh);
    } catch (e) {
      v = e instanceof GltfError ? e : new GltfError(String(e));
    }
    byOpts.set(key, v);
  }
  if (v instanceof GltfError) throw v;
  return v;
}

/** The mesh a saved model draws; throws GltfError when an Imported model's bytes do not parse. */
export function modelMesh(m: SavedModel): ModelMesh {
  if (m.parts) return partsMesh(m.parts);
  return importedMesh(glbOf(m), m.importOptions).mesh;
}

function glbOf(m: SavedModel): ArrayBuffer {
  if (!m.glb) throw new GltfError(`Model “${m.name}” has neither parts nor a mesh.`);
  return m.glb;
}

/** Plan-view outline at the model's anchor: the parts' hull, or the mesh's. */
export function modelFootprint(m: SavedModel): [number, number][] {
  const fp = m.parts ? partsFootprint(m.anchor, m.parts) : hullFootprint(m.anchor, importedMesh(glbOf(m), m.importOptions).hull);
  if (!fp.every(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))) throw new Error(`Model “${m.name}” footprint is not finite`);
  return fp;
}

/** Highest point above the local frame's U = 0, unscaled. */
export function modelTopM(m: SavedModel): number {
  return m.parts ? modelApexM(m.parts) : modelMesh(m).box[5];
}
