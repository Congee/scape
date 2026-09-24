/**
 * Cascaded shadow map fitting, in the same eye-relative ENU frame the terrain mesh and the prism
 * VBOs already live in, so a caster needs no transform beyond the light matrix built here.
 */

import { dirFromAzAlt, type Camera, type CameraBasis, type Vec3 } from '@core/optics/projection';

/** Baked into the shadow GLSL and the depth array, so it cannot vary per frame. */
export const CASCADE_COUNT = 4;
/** Shadow map side, per cascade layer. */
export const CASCADE_RES = 2048;
/** The sun subtends 0.53°, so an occluder Δz upwind casts a penumbra of about this times Δz. */
export const SUN_ANGULAR = 0.00925;
/** Practical-split blend; pure log starves the wide-angle mid range, pure uniform the long lenses. */
const SPLIT_LAMBDA = 0.95;
/** Frame half-height at the near split bound: a shadow smaller than this is never resolved. */
const NEAR_FRAME_HALF_M = 1.5;
/** Light frame yaw step, radians; one step slides a footprint edge by half a texel. */
const LIGHT_ANGLE_STEP = 1 / CASCADE_RES;
/** Rungs per octave for the geometry-derived split bounds; coarse, so a block entering the cone
 * cannot slide them. */
const SPLIT_RUNGS = 4;
/** Below this the view is too close to the sun axis to give a stable in-plane direction. */
const VIEW_ALIGN_MIN = 0.09;
/** Sun flatter than this makes the per-cascade near plane blow up, so the mesh box is used instead. */
const LIGHT_DOWN_MIN = 0.02;

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
/** Half-angle tangent to the frame corner; the frustum is bounded by this cone, not by its corners. */
const coneTan = (cam: Camera) => Math.hypot(cam.frameWmm, cam.frameHmm) / (2 * cam.focalMm);


/**
 * Light frame: `forward` points the way the sunlight travels, so depth grows away from the sun.
 * Given the view axis, `right` is turned to lie along its projection into the light plane, which is
 * the long axis of a narrow-lens frustum; the yaw is quantised so panning cannot make texels crawl.
 */
export function lightBasis(sunAzDeg: number, sunAltDeg: number, view?: Vec3): CameraBasis {
  const toSun = dirFromAzAlt(sunAzDeg, sunAltDeg);
  const forward = { x: -toSun.x, y: -toSun.y, z: -toSun.z };
  // Any stable reference that is not parallel to the light.
  const ref: Vec3 = Math.abs(forward.z) > 0.95 ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
  const right = norm(cross(ref, forward));
  const up = cross(forward, right);
  if (!view) return { forward, right, up };
  const px = dot(view, right);
  const py = dot(view, up);
  if (Math.hypot(px, py) < VIEW_ALIGN_MIN) return { forward, right, up };
  const a = Math.round(Math.atan2(py, px) / LIGHT_ANGLE_STEP) * LIGHT_ANGLE_STEP;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const r2 = { x: right.x * c + up.x * s, y: right.y * c + up.y * s, z: right.z * c + up.z * s };
  return { forward, right: r2, up: cross(forward, r2) };
}

/** Bisection steps for the cone clip; a 50 km span lands well inside a metre. */
const CONE_CLIP_STEPS = 24;

const axialCentre = (box: Float32Array, o: number, F: Vec3) => ((box[o] + box[o + 3]) / 2) * F.x + ((box[o + 1] + box[o + 4]) / 2) * F.y + ((box[o + 2] + box[o + 5]) / 2) * F.z;
const axialHalf = (box: Float32Array, o: number, F: Vec3) => Math.abs(F.x) * (box[o + 3] - (box[o] + box[o + 3]) / 2) + Math.abs(F.y) * (box[o + 4] - (box[o + 1] + box[o + 4]) / 2) + Math.abs(F.z) * (box[o + 5] - (box[o + 2] + box[o + 5]) / 2);

/** Nearest and farthest axial depth of a box, the eye clamped out; `coneDepthRange` never leaves them. */
export const axialNear = (box: Float32Array, o: number, F: Vec3) => Math.max(0, axialCentre(box, o, F) - axialHalf(box, o, F));
export const axialFar = (box: Float32Array, o: number, F: Vec3) => axialCentre(box, o, F) + axialHalf(box, o, F);

/**
 * Whether the gap is positive over all of [lo, hi] for every point of the sphere, so the search would
 * find no overlap anyway. `d` is the centre's axial depth; the margin keeps rounding on the far side.
 */
export function sphereMisses(ce: number, cn: number, cu: number, r: number, d: number, lo: number, hi: number, tr: number): boolean {
  if (tr >= 1) return false;
  const p = Math.sqrt(Math.max(0, ce * ce + cn * cn + cu * cu - d * d));
  // Distance to the centre less the cone radius is convex in depth, least at d + tr·p/√(1 − tr²).
  const t = clamp(d + (tr * p) / Math.sqrt(1 - tr * tr), lo, hi);
  return Math.hypot(t - d, p) - tr * t > r * (1 + 1e-9) + 1e-3;
}

/**
 * Axial depth range over which a box of eye-relative metres overlaps the view cone, or null when it
 * misses it. Distance from the cone axis to the box, less the cone radius at that depth, is convex
 * in depth, so the overlap is a single interval and a search finds its ends. A bounding sphere
 * cannot stand in for this: a block's radius is kilometres at the coarse levels.
 */
export function coneDepthRange(box: Float32Array, o: number, basis: CameraBasis, cam: Camera): [number, number] | null {
  const F = basis.forward;
  const tr = coneTan(cam);
  const gap = (t: number) => {
    const dx = F.x * t - clamp(F.x * t, box[o], box[o + 3]);
    const dy = F.y * t - clamp(F.y * t, box[o + 1], box[o + 4]);
    const dz = F.z * t - clamp(F.z * t, box[o + 2], box[o + 5]);
    return Math.hypot(dx, dy, dz) - tr * t;
  };
  // Depths at which the box has any thickness; beyond them it contributes no geometry.
  const ce = (box[o] + box[o + 3]) / 2;
  const cn = (box[o + 1] + box[o + 4]) / 2;
  const cu = (box[o + 2] + box[o + 5]) / 2;
  const d = ce * F.x + cn * F.y + cu * F.z;
  const lo = axialNear(box, o, F);
  const hi = axialFar(box, o, F);
  if (hi <= lo) return null;
  if (Math.abs(F.x * F.x + F.y * F.y + F.z * F.z - 1) < 1e-9 && sphereMisses(ce, cn, cu, Math.hypot(box[o + 3] - ce, box[o + 4] - cn, box[o + 5] - cu), d, lo, hi, tr)) return null;
  let a = lo;
  let b = hi;
  for (let i = 0; i < CONE_CLIP_STEPS; i++) {
    const m1 = a + (b - a) / 3;
    const m2 = b - (b - a) / 3;
    if (gap(m1) < gap(m2)) b = m2;
    else a = m1;
  }
  const mid = (a + b) / 2;
  if (gap(mid) > 0) return null;
  // Each end from the outside, so the range is never reported short.
  const edge = (to: number) => {
    let p = mid;
    let q = to;
    for (let i = 0; i < CONE_CLIP_STEPS; i++) {
      const m = (p + q) / 2;
      if (gap(m) <= 0) p = m;
      else q = m;
    }
    return q;
  };
  return [gap(lo) <= 0 ? lo : edge(lo), gap(hi) <= 0 ? hi : edge(hi)];
}

export interface SceneBounds {
  /** Half-extent of the terrain mesh on east and north, metres. */
  halfM: number;
  minU: number;
  maxU: number;
  /** Axial depth of the first geometry the view cone touches; absent when it touches none. */
  viewNearM?: number;
  /** The last, reported for diagnostics only: the splits keep the lens and mesh far bound. */
  viewFarM?: number;
}

/** Widens one bounds over another; the buildings reach far above the terrain band they stand on. */
export function mergeScene(a: SceneBounds | null, b: SceneBounds | null): SceneBounds | null {
  if (!a || !b) return a ?? b;
  const out: SceneBounds = { halfM: Math.max(a.halfM, b.halfM), minU: Math.min(a.minU, b.minU), maxU: Math.max(a.maxU, b.maxU) };
  const near = Math.min(a.viewNearM ?? Infinity, b.viewNearM ?? Infinity);
  const far = Math.max(a.viewFarM ?? -Infinity, b.viewFarM ?? -Infinity);
  if (far > near) {
    out.viewNearM = near;
    out.viewFarM = far;
  }
  return out;
}

export interface Cascade {
  /** Eye-relative ENU to light clip space, column-major; reversed-Z, near maps to 1. */
  matrix: Float32Array;
  /** Side of one shadow texel along light right and light up; a long lens makes these differ a lot. */
  texelXM: number;
  texelYM: number;
  /** Light-space depth covered by the full [0,1] range, metres. */
  depthRangeM: number;
  /** Axial depth this cascade stops being used at, metres. */
  farM: number;
  halfXM: number;
  halfYM: number;
  /** Snapped centre in light space, and the depth slab the pass covers. */
  cx: number;
  cy: number;
  zNear: number;
  zFar: number;
}

/**
 * Axial far edge of each cascade, blending a logarithmic and a uniform split. The bounds come from
 * the lens and the mesh: the near one is where the frame is a few metres tall, so a long lens does
 * not spend a whole cascade on ground it cannot resolve, and the far one is where the frustum drops
 * out of the bottom of the mesh, past which there is nothing left to shadow. Where the caller knows
 * where the geometry the view cone touches starts, that raises the near one, since a long lens aimed
 * off a summit otherwise hands the last cascade a slab kilometres deep over empty air.
 */
export function cascadeSplits(cam: Camera, basis: CameraBasis, scene: SceneBounds): number[] {
  const ty = cam.frameHmm / (2 * cam.focalMm);
  const fz = basis.forward.z;
  // Least-descending ray of the cone, so the bound cannot change when the camera rolls.
  const dzMin = Math.max(0, Math.abs(fz) - coneTan(cam) * Math.sqrt(Math.max(0, 1 - fz * fz)));
  const uLimit = Math.max(1, fz < 0 ? -scene.minU : scene.maxU);
  const lensFar = clamp(dzMin > 1e-4 ? uLimit / dzMin : Infinity, 16, scene.halfM);
  const lensNear = clamp(NEAR_FRAME_HALF_M / ty, 1, lensFar / 16);
  // Looking up from a summit there is nothing in the first kilometres, so the lens bound alone
  // hands the last cascade a slab kilometres deep. Raising the near bound onto the first geometry
  // the cone touches only pays with a cascade of its own for the empty foreground — otherwise it
  // just inflates cascade zero, which starts at the eye either way — so the two go together. The
  // far bound is deliberately left to the lens and the mesh: pulling it in risks leaving a distant
  // receiver outside every cascade, and it is worth almost nothing once the near bound is tight.
  const far = lensFar;
  const seen = scene.viewNearM === undefined ? 0 : clamp(rung(scene.viewNearM, Math.floor), 1, far / 2 ** (1 / SPLIT_RUNGS));
  const lead = seen > lensNear && seen * seen > lensNear * far;
  const near = lead ? seen : lensNear;
  // Cascade zero still reaches the eye, for anything the cone clip did not see.
  const out: number[] = [];
  if (lead) out.push(near);
  const n = CASCADE_COUNT - out.length;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    out.push(SPLIT_LAMBDA * (near * (far / near) ** t) + (1 - SPLIT_LAMBDA) * (near + (far - near) * t));
  }
  return out;
}

/** Snapped to the split ladder, so the bound steps rather than tracking every block. */
function rung(v: number, round: (x: number) => number): number {
  return 2 ** (round(Math.log2(Math.max(v, 1)) * SPLIT_RUNGS) / SPLIT_RUNGS);
}

/** Quantised so a slow focal or aim change cannot make the cascade breathe by a texel. */
function quantiseExtent(r: number): number {
  return 2 ** (Math.ceil(Math.log2(Math.max(r, 1)) * 16) / 16);
}

/**
 * One orthographic cascade per view-frustum slice. The slice is bounded by the cone around the view
 * axis rather than by its corners, so the fit depends only on the aim and the diagonal half-angle
 * and cannot change when the camera rolls; its light-space extents are sized per axis, because at a
 * long focal the slice is a needle whose length must not set the resolution across it. Extents are
 * quantised and the centre snapped to whole texels so the shadow edge cannot crawl.
 */
export function fitCascades(cam: Camera, basis: CameraBasis, light: CameraBasis, scene: SceneBounds, res = CASCADE_RES): Cascade[] {
  const tr = coneTan(cam);
  const splits = cascadeSplits(cam, basis, scene);

  // Light-space span of the mesh box: receivers cannot leave it, and it is the near-plane fallback.
  const bLo = { x: Infinity, y: Infinity, z: Infinity };
  const bHi = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const se of [-scene.halfM, scene.halfM])
    for (const sn of [-scene.halfM, scene.halfM])
      for (const su of [scene.minU, scene.maxU]) {
        const p = { x: se, y: sn, z: su };
        for (const [k, axis] of [['x', light.right], ['y', light.up], ['z', light.forward]] as const) {
          const v = dot(p, axis);
          bLo[k] = Math.min(bLo[k], v);
          bHi[k] = Math.max(bHi[k], v);
        }
      }

  const out: Cascade[] = [];
  let near = 1;
  for (const far of splits) {
    const rn = near * tr;
    const rf = far * tr;
    const span = (axis: Vec3, lo: number, hi: number): [number, number] => {
      const a = dot(basis.forward, axis);
      const s0 = near * a;
      const s1 = far * a;
      const min = Math.max(lo, Math.min(s0 - rn, s1 - rf));
      return [min, Math.max(min + 1, Math.min(hi, Math.max(s0 + rn, s1 + rf)))];
    };
    const [xMin, xMax] = span(light.right, bLo.x, bHi.x);
    const [yMin, yMax] = span(light.up, bLo.y, bHi.y);
    const [zMin, zMax] = span(light.forward, bLo.z, bHi.z);

    const hx = quantiseExtent((xMax - xMin) / 2);
    const hy = quantiseExtent((yMax - yMin) / 2);
    const texelXM = (2 * hx) / res;
    const texelYM = (2 * hy) / res;
    const cx = Math.round((xMin + xMax) / (2 * texelXM)) * texelXM;
    const cy = Math.round((yMin + yMax) / (2 * texelYM)) * texelYM;

    // A caster only reaches this cascade through its own footprint, so the slab need clear the
    // top of the scene over those four corners rather than over the whole mesh box.
    let zNear = zMin;
    if (light.forward.z < -LIGHT_DOWN_MIN) {
      let top = Infinity;
      for (const sx of [-1, 1])
        for (const sy of [-1, 1])
          top = Math.min(top, (scene.maxU - (cx + sx * hx) * light.right.z - (cy + sy * hy) * light.up.z) / light.forward.z);
      zNear = Math.min(zNear, top);
    } else zNear = Math.min(zNear, bLo.z);

    const zFar = zMax;
    const range = zFar - zNear;
    const sx = 1 / hx;
    const sy = 1 / hy;
    const sz = -2 / range;
    out.push({
      matrix: new Float32Array([
        sx * light.right.x, sy * light.up.x, sz * light.forward.x, 0,
        sx * light.right.y, sy * light.up.y, sz * light.forward.y, 0,
        sx * light.right.z, sy * light.up.z, sz * light.forward.z, 0,
        -sx * cx, -sy * cy, (2 * zFar) / range - 1, 1,
      ]),
      texelXM,
      texelYM,
      depthRangeM: range,
      farM: far,
      halfXM: hx,
      halfYM: hy,
      cx,
      cy,
      zNear,
      zFar,
    });
    near = far;
  }
  return out;
}

/**
 * True where a box of eye-relative metres can cast into a cascade: it has to overlap the cascade's
 * light-space footprint and lie no further downwind than its far plane, since anything upwind of
 * the slab still throws a shadow across it.
 */
export function boxCastsInto(box: Float32Array, o: number, light: CameraBasis, c: Cascade): boolean {
  const hx = (box[o + 3] - box[o]) / 2;
  const hy = (box[o + 4] - box[o + 1]) / 2;
  const hz = (box[o + 5] - box[o + 2]) / 2;
  const mx = box[o] + hx;
  const my = box[o + 1] + hy;
  const mz = box[o + 2] + hz;
  const span = (a: Vec3) => Math.abs(a.x) * hx + Math.abs(a.y) * hy + Math.abs(a.z) * hz;
  const at = (a: Vec3) => a.x * mx + a.y * my + a.z * mz;
  if (Math.abs(at(light.right) - c.cx) > c.halfXM + span(light.right)) return false;
  if (Math.abs(at(light.up) - c.cy) > c.halfYM + span(light.up)) return false;
  return at(light.forward) - span(light.forward) <= c.zFar;
}
