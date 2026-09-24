import { describe, expect, it } from 'vitest';
import { cameraBasis, dirFromAzAlt, type Camera, type CameraBasis, type Vec3 } from '@core/optics/projection';
import { boxCastsInto, CASCADE_COUNT, CASCADE_RES, cascadeSplits, coneDepthRange, fitCascades, sphereMisses, lightBasis, mergeScene, type Cascade, type SceneBounds } from './shadowFit';

const CAM: Camera = { azimuthDeg: 120, elevationDeg: -2, focalMm: 50, frameWmm: 36, frameHmm: 24 };
const BASIS = cameraBasis(CAM);
const SCENE: SceneBounds = { halfM: 49_152, minU: -1500, maxU: 3000 };
/** Gornergrat aimed at the Matterhorn: the mesh box and the cone clip a 1200 mm frame really gives. */
const SUMMIT: Camera = { azimuthDeg: 265.8, elevationDeg: 7.1, focalMm: 1200, frameWmm: 36, frameHmm: 24 };
const SUMMIT_BOX: SceneBounds = { halfM: 49_152, minU: -2944, maxU: 1330 };
const SUMMIT_SEEN: SceneBounds = { ...SUMMIT_BOX, viewNearM: 8489, viewFarM: 10_661 };
const RES = 1024;
const TELE: Camera = { ...CAM, focalMm: 2400, frameWmm: 23.5, frameHmm: 15.6 };
const box = (e: number, n: number, u: number, h: number) => new Float32Array([e - h, n - h, u - h, e + h, n + h, u + h]);
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;

/** Eye-relative point through the cascade matrix, to clip space. */
function project(c: Cascade, x: number, y: number, z: number): { x: number; y: number; z: number } {
  const m = c.matrix;
  return {
    x: m[0] * x + m[4] * y + m[8] * z + m[12],
    y: m[1] * x + m[5] * y + m[9] * z + m[13],
    z: m[2] * x + m[6] * y + m[10] * z + m[14]
  };
}

/** Light space back to eye-relative metres. */
const fromLight = (l: CameraBasis, x: number, y: number, z: number): Vec3 => ({
  x: x * l.right.x + y * l.up.x + z * l.forward.x,
  y: x * l.right.y + y * l.up.y + z * l.forward.y,
  z: x * l.right.z + y * l.up.z + z * l.forward.z
});

const mix = (a: Vec3, b: Vec3, ka: number, kb: number): Vec3 => ({ x: a.x * ka + b.x * kb, y: a.y * ka + b.y * kb, z: a.z * ka + b.z * kb });

/** The camera rolled about its own aim axis, which the fit must ignore. */
function rolled(basis: CameraBasis, deg: number): CameraBasis {
  const c = Math.cos(deg * (Math.PI / 180));
  const s = Math.sin(deg * (Math.PI / 180));
  return { forward: basis.forward, right: mix(basis.right, basis.up, c, s), up: mix(basis.right, basis.up, -s, c) };
}

/**
 * Widest shadow texel a terminator can step by on screen at a given distance, in metres across the
 * line of sight. The light frame turns its right axis onto the view, so that axis is the long one at
 * a long focal and only the part of it transverse to the view shows.
 */
function screenTexelM(cam: Camera, distM: number, res = RES, scene: SceneBounds = SCENE): number {
  const basis = cameraBasis(cam);
  const light = lightBasis(215, 28, basis.forward);
  const cs = fitCascades(cam, basis, light, scene, res);
  const c = cs.find((x) => x.farM >= distM) ?? cs[cs.length - 1];
  const along = Math.abs(dot(basis.forward, light.right));
  return Math.max(c.texelXM * Math.sqrt(Math.max(0, 1 - along * along)), c.texelYM);
}

describe('lightBasis', () => {
  it('points the way the light travels and stays orthonormal', () => {
    const l = lightBasis(200, 35);
    expect(l.forward.z).toBeCloseTo(-Math.sin(35 * (Math.PI / 180)), 12);
    for (const v of [l.forward, l.right, l.up]) expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 12);
    expect(l.forward.x * l.right.x + l.forward.y * l.right.y + l.forward.z * l.right.z).toBeCloseTo(0, 12);
    expect(l.forward.x * l.up.x + l.forward.y * l.up.y + l.forward.z * l.up.z).toBeCloseTo(0, 12);
  });

  it('handles the sun overhead, where the usual reference is parallel to it', () => {
    const l = lightBasis(0, 90);
    expect(Math.hypot(l.right.x, l.right.y, l.right.z)).toBeCloseTo(1, 12);
  });

  it('turns its right axis onto the view, so a needle frustum lies along one axis', () => {
    const l = lightBasis(215, 28, BASIS.forward);
    for (const v of [l.forward, l.right, l.up]) expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 12);
    expect(dot(l.forward, l.right)).toBeCloseTo(0, 12);
    // The view has no component along the short axis once the frame is turned onto it.
    expect(Math.abs(dot(BASIS.forward, l.up))).toBeLessThan(1e-3);
  });

  it('keeps the arbitrary reference frame when the view is almost along the light', () => {
    const sun = { azimuthDeg: 215, altitudeDeg: 28 };
    const view = dirFromAzAlt(sun.azimuthDeg + 180, -sun.altitudeDeg);
    const l = lightBasis(sun.azimuthDeg, sun.altitudeDeg, view);
    expect(l.right).toEqual(lightBasis(sun.azimuthDeg, sun.altitudeDeg).right);
  });

  it('quantises that turn, so panning steps the texel grid rather than sliding it', () => {
    const seen = new Set<number>();
    for (let d = 0; d < 0.02; d += 0.0005) seen.add(lightBasis(215, 28, cameraBasis({ ...CAM, azimuthDeg: 120 + d }).forward).right.x);
    expect(seen.size).toBeLessThan(20);
  });
});

describe('cascadeSplits', () => {
  it('grows outward and stays inside the mesh', () => {
    for (const cam of [CAM, TELE, { ...CAM, focalMm: 24 }]) {
      const s = cascadeSplits(cam, cameraBasis(cam), SCENE);
      expect(s).toHaveLength(CASCADE_COUNT);
      for (const [i, d] of s.entries()) {
        expect(Number.isFinite(d)).toBe(true);
        if (i > 0) expect(d).toBeGreaterThan(s[i - 1]);
      }
      expect(s[0]).toBeGreaterThan(1);
      expect(s[s.length - 1]).toBeLessThanOrEqual(SCENE.halfM);
    }
  });

  it('follows the lens, so a longer focal spends finer texels on the same distant ridge', () => {
    // Only once the near bound is tight: on the lens bound alone the along-view axis grows with
    // the focal, which is the stair-stepping this fit exists to stop.
    const scene = { ...SCENE, viewNearM: 8000, viewFarM: 14_000 };
    let last = Infinity;
    for (const focalMm of [24, 50, 135, 300, 600, 1200]) {
      const t = screenTexelM({ ...CAM, elevationDeg: 7.1, focalMm }, 8500, RES, scene);
      expect(t).toBeLessThan(last);
      last = t;
    }
    // The 600 mm ridge the stair-stepping was photographed on, in metres across the line of sight.
    expect(screenTexelM({ ...CAM, elevationDeg: 7.1, focalMm: 600 }, 8500, CASCADE_RES, scene)).toBeLessThan((2 * (8500 * CAM.frameHmm)) / (600 * 1013));
  });

  it('spends a cascade on the empty foreground and the rest on the geometry beyond it', () => {
    const basis = cameraBasis(SUMMIT);
    const loose = cascadeSplits(SUMMIT, basis, SUMMIT_BOX);
    const tight = cascadeSplits(SUMMIT, basis, SUMMIT_SEEN);
    // The far edge is the lens and mesh bound either way; only the near one moves.
    expect(tight[3]).toBeCloseTo(loose[3], 6);
    expect(tight[0]).toBeGreaterThan(4000);
    expect(tight[0]).toBeLessThanOrEqual(8489);
    // The last cascade stops being a slab kilometres deep.
    expect(tight[3] - tight[2]).toBeLessThan((loose[3] - loose[2]) / 4);
  });

  it('leaves a view whose geometry starts at the eye exactly as it was', () => {
    for (const focalMm of [24, 135, 600, 1200]) {
      const cam = { ...CAM, elevationDeg: 7.1, focalMm };
      const basis = cameraBasis(cam);
      for (const viewNearM of [1, 55, 300]) expect(cascadeSplits(cam, basis, { ...SCENE, viewNearM, viewFarM: SCENE.halfM })).toEqual(cascadeSplits(cam, basis, SCENE));
    }
  });

  it('falls back to the lens bound when the cone clip found nothing', () => {
    const basis = cameraBasis(TELE);
    expect(cascadeSplits(TELE, basis, SCENE)).toEqual(cascadeSplits(TELE, basis, { ...SCENE }));
    expect(cascadeSplits(TELE, basis, { halfM: SCENE.halfM, minU: SCENE.minU, maxU: SCENE.maxU })).toEqual(cascadeSplits(TELE, basis, SCENE));
  });

  it('steps the near bound, so blocks entering the cone cannot slide it', () => {
    const cam = { ...CAM, elevationDeg: 7.1, focalMm: 1200 };
    const basis = cameraBasis(cam);
    const seen = new Set<number>();
    for (let d = 0; d < 2000; d += 10) seen.add(cascadeSplits(cam, basis, { ...SCENE, viewNearM: 8000 + d, viewFarM: 12_000 })[0]);
    expect(seen.size).toBeLessThan(4);
  });

  it('keeps the along-view texel off the metre scale at the ridge it steps on', () => {
    const basis = cameraBasis(SUMMIT);
    const light = lightBasis(215, 40, basis.forward);
    const at = (scene: SceneBounds) => fitCascades(SUMMIT, basis, light, scene, CASCADE_RES).find((x) => x.farM >= 9700)!.texelXM;
    // Measured at 3.5 m in the browser while the splits came from the lens alone.
    expect(at(SUMMIT_BOX)).toBeGreaterThan(3);
    expect(at(SUMMIT_SEEN)).toBeLessThan(1.5);
  });

  it('does not collapse at 2400 mm on APS-C, the longest the viewfinder can reach', () => {
    const basis = cameraBasis(TELE);
    const cs = fitCascades(TELE, basis, lightBasis(215, 28, basis.forward), SCENE, RES);
    for (const c of cs) {
      expect(c.halfXM).toBeGreaterThan(1);
      expect(c.halfYM).toBeGreaterThan(1);
      expect(c.depthRangeM).toBeGreaterThan(0);
      for (const v of c.matrix) expect(Number.isFinite(v)).toBe(true);
    }
    // Across the view it still beats the 50 mm fit at the same distance by a wide margin.
    expect(screenTexelM(TELE, 8500)).toBeLessThan(screenTexelM(CAM, 8500) / 20);
  });
});

describe('fitCascades', () => {
  const light = lightBasis(215, 28, BASIS.forward);
  const cs = fitCascades(CAM, BASIS, light, SCENE, RES);

  it('returns one cascade per split, growing outward', () => {
    const splits = cascadeSplits(CAM, BASIS, SCENE);
    expect(cs).toHaveLength(CASCADE_COUNT);
    for (const [i, c] of cs.entries()) {
      expect(c.farM).toBe(splits[i]);
      expect(c.texelXM).toBeCloseTo((2 * c.halfXM) / RES, 9);
      expect(c.texelYM).toBeCloseTo((2 * c.halfYM) / RES, 9);
    }
  });

  it('covers its own slice of the frustum', () => {
    const tr = Math.hypot(CAM.frameWmm, CAM.frameHmm) / (2 * CAM.focalMm);
    const splits = cascadeSplits(CAM, BASIS, SCENE);
    // The last cascade runs out of the mesh box, so its slice is deliberately clipped.
    for (const [i, c] of cs.slice(0, -1).entries()) {
      for (const a of [i === 0 ? 1 : splits[i - 1], c.farM]) {
        for (let k = 0; k < 8; k++) {
          const phi = (k * Math.PI) / 4;
          const lat = { c: tr * Math.cos(phi), s: tr * Math.sin(phi) };
          const p = {
            x: a * (BASIS.forward.x + lat.c * BASIS.right.x + lat.s * BASIS.up.x),
            y: a * (BASIS.forward.y + lat.c * BASIS.right.y + lat.s * BASIS.up.y),
            z: a * (BASIS.forward.z + lat.c * BASIS.right.z + lat.s * BASIS.up.z)
          };
          const q = project(c, p.x, p.y, p.z);
          expect(Math.abs(q.x)).toBeLessThanOrEqual(1.0001);
          expect(Math.abs(q.y)).toBeLessThanOrEqual(1.0001);
        }
      }
    }
  });

  it('is reversed-Z: near the light maps high, far maps low, all inside the slab', () => {
    const c = cs[0];
    const near = fromLight(light, c.cx, c.cy, c.zNear);
    const far = fromLight(light, c.cx, c.cy, c.zFar);
    expect(project(c, near.x, near.y, near.z).z).toBeCloseTo(1, 4);
    expect(project(c, far.x, far.y, far.z).z).toBeCloseTo(-1, 4);
  });

  it('clears every caster that can reach it, from a near plane no looser than the whole box', () => {
    let boxMin = Infinity;
    for (const se of [-SCENE.halfM, SCENE.halfM])
      for (const sn of [-SCENE.halfM, SCENE.halfM])
        for (const su of [SCENE.minU, SCENE.maxU]) boxMin = Math.min(boxMin, dot({ x: se, y: sn, z: su }, light.forward));
    for (const c of cs) {
      expect(c.zNear).toBeGreaterThanOrEqual(boxMin - 1e-6);
      // Highest caster that can reach each footprint corner: the top of the scene above it.
      for (const sx of [-1, 1])
        for (const sy of [-1, 1]) {
          const x = c.cx + sx * c.halfXM;
          const y = c.cy + sy * c.halfYM;
          const z = (SCENE.maxU - x * light.right.z - y * light.up.z) / light.forward.z;
          const p = fromLight(light, x, y, z);
          expect(project(c, p.x, p.y, p.z).z).toBeLessThanOrEqual(1.0001);
        }
    }
  });

  it('is tighter in depth than a near plane taken from the whole mesh box', () => {
    const tele = cameraBasis(TELE);
    const teleLight = lightBasis(215, 28, tele.forward);
    for (const c of fitCascades(TELE, tele, teleLight, SCENE, RES)) expect(c.depthRangeM).toBeLessThan(30_000);
  });

  it('snaps the centre to whole texels, so a slow pan cannot make the edge crawl', () => {
    for (const c of cs) {
      expect(c.cx / c.texelXM).toBeCloseTo(Math.round(c.cx / c.texelXM), 6);
      expect(c.cy / c.texelYM).toBeCloseTo(Math.round(c.cy / c.texelYM), 6);
    }
  });

  it('holds the snapped centre and the texel size through a small aim nudge', () => {
    const nudged = cameraBasis({ ...CAM, azimuthDeg: CAM.azimuthDeg + 0.004, elevationDeg: CAM.elevationDeg + 0.004 });
    for (const [i, c] of fitCascades(CAM, nudged, light, SCENE, RES).entries()) {
      expect(c.texelXM).toBe(cs[i].texelXM);
      expect(c.texelYM).toBe(cs[i].texelYM);
      expect(Math.abs(c.cx - cs[i].cx)).toBeLessThanOrEqual(c.texelXM * 1.0001);
      expect(Math.abs(c.cy - cs[i].cy)).toBeLessThanOrEqual(c.texelYM * 1.0001);
    }
  });

  it('ignores camera roll, so the cascade cannot breathe as the frame turns', () => {
    for (const deg of [17, 45, 90, 180]) {
      for (const [i, c] of fitCascades(CAM, rolled(BASIS, deg), light, SCENE, RES).entries()) {
        expect(c.halfXM).toBe(cs[i].halfXM);
        expect(c.halfYM).toBe(cs[i].halfYM);
        expect(c.farM).toBeCloseTo(cs[i].farM, 9);
      }
    }
  });

  it('quantises the extents so a focal sweep steps rather than breathes', () => {
    const sizes = new Set<number>();
    for (let f = 50; f <= 56; f += 0.05) sizes.add(fitCascades({ ...CAM, focalMm: f }, BASIS, light, SCENE, RES)[1].halfYM);
    expect(sizes.size).toBeLessThan(8);
  });
});

describe('coneDepthRange', () => {
  const TELE_BASIS = cameraBasis({ ...TELE, elevationDeg: 7.1 });
  const TELE_UP = { ...TELE, elevationDeg: 7.1 };
  const at = (dist: number, off: number, u: number, h: number) => {
    const f = TELE_BASIS.forward;
    const r = TELE_BASIS.right;
    return box(f.x * dist + r.x * off, f.y * dist + r.y * off, f.z * dist + r.z * off + u, h);
  };

  it('drops a near block that lies wholly outside the cone, whatever its radius', () => {
    expect(coneDepthRange(at(100, 300, 0, 96), 0, TELE_BASIS, TELE_UP)).toBe(null);
  });

  it('keeps a block the cone passes through, over its own thickness', () => {
    const seen = coneDepthRange(at(9700, 0, 0, 100), 0, TELE_BASIS, TELE_UP);
    expect(seen).not.toBe(null);
    expect(seen![0]).toBeGreaterThan(9400);
    expect(seen![1]).toBeLessThan(10_000);
  });

  it('clips a coarse block to the slice the cone passes through, not its whole diagonal', () => {
    // A level-8 block: 24 km across, but the ground in it tops out 1500 m above the eye.
    const b = new Float32Array([-12_288, -12_288, -1500, 12_288, 12_288, 1500]);
    const seen = coneDepthRange(b, 0, TELE_BASIS, TELE_UP)!;
    expect(seen).not.toBe(null);
    // The axis rises at 7.1 deg, so it leaves the top of the block near 12 km, not at 17 km.
    expect(seen[1]).toBeLessThan(13_500);
    expect(seen[1]).toBeGreaterThan(11_000);
  });

  it('reaches the eye for a block the eye sits inside', () => {
    expect(coneDepthRange(box(0, 0, 0, 96), 0, TELE_BASIS, TELE_UP)![0]).toBe(0);
  });

  it('keeps off-axis blocks a wide lens really does see', () => {
    const wide = { ...CAM, focalMm: 24, elevationDeg: 7.1 };
    const wideBasis = cameraBasis(wide);
    const f = wideBasis.forward;
    const r = wideBasis.right;
    const b = box(f.x * 100 + r.x * 60, f.y * 100 + r.y * 60, f.z * 100 + r.z * 60, 20);
    expect(coneDepthRange(b, 0, wideBasis, wide)).not.toBe(null);
    expect(coneDepthRange(b, 0, TELE_BASIS, TELE_UP)).toBe(null);
  });
});

describe('sphereMisses', () => {
  it('only rejects spheres whose every point stays outside the cone over the depth range', () => {
    const F = { x: 0.6, y: 0.64, z: 0.48 };
    let rejected = 0;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let n = 0; n < 2000; n++) {
      const [ce, cn, cu] = [rnd() * 20_000, rnd() * 20_000, rnd() * 3000];
      const r = Math.abs(rnd()) * 3000;
      const tr = Math.abs(rnd()) * 0.95;
      const d = ce * F.x + cn * F.y + cu * F.z;
      const [lo, hi] = [Math.max(0, d - r), d + r];
      if (hi <= lo || !sphereMisses(ce, cn, cu, r, d, lo, hi, tr)) continue;
      rejected++;
      for (let i = 0; i <= 200; i++) {
        const t = lo + ((hi - lo) * i) / 200;
        expect(Math.hypot(F.x * t - ce, F.y * t - cn, F.z * t - cu) - r - tr * t).toBeGreaterThan(0);
      }
    }
    expect(rejected).toBeGreaterThan(100);
  });
});

describe('boxCastsInto', () => {
  const light = lightBasis(180, 30, BASIS.forward);
  const c = fitCascades(CAM, BASIS, light, SCENE, RES)[0];

  it('keeps a box sitting on the cascade centre', () => {
    const p = fromLight(light, c.cx, c.cy, 0);
    expect(boxCastsInto(box(p.x, p.y, p.z, 20), 0, light, c)).toBe(true);
  });

  it('drops a box well outside the footprint', () => {
    const p = fromLight(light, c.cx + 40 * c.halfXM, c.cy, 0);
    expect(boxCastsInto(box(p.x, p.y, p.z, 20), 0, light, c)).toBe(false);
  });

  it('keeps an upwind caster that is outside the slab but shadows into it', () => {
    const p = fromLight(light, c.cx, c.cy, -5000);
    expect(boxCastsInto(box(p.x, p.y, p.z, 50), 0, light, c)).toBe(true);
  });

  it('drops a box downwind of the far plane, which can shadow nothing in the slab', () => {
    const p = fromLight(light, c.cx, c.cy, c.zFar + 4 * c.halfXM);
    expect(boxCastsInto(box(p.x, p.y, p.z, 50), 0, light, c)).toBe(false);
  });
});

describe('mergeScene', () => {
  // Elevated Midtown pin: the terrain band is tens of metres deep while the towers reach hundreds.
  const CITY: Camera = { azimuthDeg: 210, elevationDeg: 4, focalMm: 50, frameWmm: 36, frameHmm: 24 };
  const CITY_BASIS = cameraBasis(CITY);
  const CITY_LIGHT = lightBasis(30, 40, CITY_BASIS.forward);
  const TERRAIN: SceneBounds = { halfM: 20_000, minU: -120, maxU: -60, viewNearM: 1, viewFarM: 20_000 };
  const PRISMS: SceneBounds = { halfM: 3000, minU: -120, maxU: 300, viewNearM: 30, viewFarM: 3000 };

  /** The shader's depth test on a receiver, in the cascade the fall-through would start from. */
  const depthOf = (scene: SceneBounds, axialM: number, upM: number) => {
    const cs = fitCascades(CITY, CITY_BASIS, CITY_LIGHT, scene, CASCADE_RES);
    const c = cs.find((x) => x.farM >= axialM) ?? cs[cs.length - 1];
    const F = CITY_BASIS.forward;
    return project(c, F.x * axialM, F.y * axialM, upM).z * 0.5 + 0.5;
  };

  // A 400 m tower seen from a 120 m pin, 300 m out: above the terrain band, so the slab's near edge
  // cuts it and the shader falls through to a coarser cascade.
  it('brings a tower top back inside the cascade the terrain band alone drops it from', () => {
    expect(depthOf(TERRAIN, 300, 280)).toBeGreaterThan(1);
    const both = mergeScene(TERRAIN, PRISMS)!;
    expect(both.maxU).toBe(300);
    const z = depthOf(both, 300, 280);
    expect(z).toBeGreaterThan(0);
    expect(z).toBeLessThan(1);
  });

  it('widens the extent and the cone range over both', () => {
    const m = mergeScene(TERRAIN, PRISMS)!;
    expect(m).toEqual({ halfM: 20_000, minU: -120, maxU: 300, viewNearM: 1, viewFarM: 20_000 });
  });

  it('leaves a bounds alone when the other side has no geometry', () => {
    expect(mergeScene(SUMMIT_SEEN, null)).toEqual(SUMMIT_SEEN);
    expect(mergeScene(null, SUMMIT_SEEN)).toEqual(SUMMIT_SEEN);
    expect(mergeScene(null, null)).toBe(null);
  });
});
