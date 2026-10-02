import { describe, expect, it } from 'vitest';
import { distanceM, type LngLat } from '@core/geo/geodesy';
import { analyzeSightline, endpointHeightM } from '@core/terrain/los';
import type { MeshResult, ProfileResult } from '@workers/terrain.protocol';
import { AimLock, aimFor } from './composition';
import { isComplete, meshEyeKeyFor, meshKeyFor, mergeLevel, profileKeyFor, retiredBuffers, targetAngleFor, type TerrainState } from './terrain';

// Zermatt to the Matterhorn: 8.5 km, the target 1.7 km above the eye.
const PIN: LngLat = { lat: 46.0207, lng: 7.7491 };
const PIN2: LngLat = { lat: 45.9763, lng: 7.6586 };
const GROUND_A = 1608;
const GROUND_B = 4478;

const world = (over: Partial<{ pin: LngLat; pinHeightM: number; pin2: LngLat | null; pin2HeightM: number }> = {}) => ({
  pin: PIN,
  pinHeightM: 0,
  pin2: PIN2 as LngLat | null,
  pin2HeightM: 0,
  ...over
});
const settings = (terrain = true) => ({ terrain, terrainHorizon: true, horizonRangeKm: 120 });
const terrain = (over: Partial<TerrainState> = {}): Pick<TerrainState, 'profile' | 'profileKey' | 'pinGroundM' | 'pin2GroundM'> => ({
  profile: null,
  profileKey: '',
  pinGroundM: null,
  pin2GroundM: null,
  ...over
});

describe('targetAngleFor', () => {
  it('agrees with analyzeSightline over the same endpoints', () => {
    const total = distanceM(PIN, PIN2);
    const n = 400;
    const distM = Float32Array.from({ length: n }, (_, i) => (total * i) / (n - 1));
    // A trench between the ends: it changes the occlusion verdict but must not move the angle.
    const groundM = Float32Array.from({ length: n }, () => 0);
    const eyeAboveGroundM = 1.6;
    const targetAboveGroundM = 12;
    const los = analyzeSightline(distM, groundM, endpointHeightM(GROUND_A, eyeAboveGroundM), endpointHeightM(GROUND_B, targetAboveGroundM));

    const angle = targetAngleFor(
      world({ pin2HeightM: targetAboveGroundM }),
      settings(),
      terrain({ pinGroundM: GROUND_A, pin2GroundM: GROUND_B })
    );
    // Not exact only because the profile carries its distances as Float32, worth about 1e-6°.
    expect(angle).toBeCloseTo(los.targetAngleDeg, 5);
  });

  it('takes the profile when its key is current', () => {
    const w = world();
    const s = settings();
    const profile = { los: { targetAngleDeg: 11.25 } } as ProfileResult;
    const from = targetAngleFor(w, s, terrain({ profile, profileKey: profileKeyFor(w, s), pinGroundM: GROUND_A, pin2GroundM: GROUND_B }));
    expect(from).toBe(11.25);
    // A profile for somewhere else is not an answer for here.
    expect(targetAngleFor(w, s, terrain({ profile, profileKey: 'elsewhere', pinGroundM: GROUND_A, pin2GroundM: GROUND_B }))).not.toBe(11.25);
  });

  it('is null while either endpoint ground is unknown, unless a ground is assumed', () => {
    const w = world();
    const s = settings();
    expect(targetAngleFor(w, s, terrain({ pinGroundM: GROUND_A }))).toBeNull();
    expect(targetAngleFor(w, s, terrain({ pin2GroundM: GROUND_B }))).toBeNull();
    expect(targetAngleFor(w, s, terrain())).toBeNull();
    expect(targetAngleFor(w, s, terrain(), 0)).toBeCloseTo(-0.044, 3);
  });

  it('reads a NaN ground and a terrain-free world as sea level', () => {
    const s = settings();
    const atSea = targetAngleFor(world(), s, terrain({ pinGroundM: 0, pin2GroundM: 0 }));
    expect(targetAngleFor(world(), s, terrain({ pinGroundM: NaN, pin2GroundM: NaN }))).toBe(atSea);
    expect(targetAngleFor(world(), settings(false), terrain())).toBe(atSea);
  });

  it('stands an endpoint on ground below sea level', () => {
    const s = settings();
    const level = targetAngleFor(world(), s, terrain({ pinGroundM: 0, pin2GroundM: 0 }))!;
    expect(targetAngleFor(world(), s, terrain({ pinGroundM: -6, pin2GroundM: -6 }))).toBeCloseTo(level, 9);
    expect(targetAngleFor(world(), s, terrain({ pinGroundM: -6, pin2GroundM: 0 }))).toBeGreaterThan(level);
  });

  it('has no answer without a target', () => {
    expect(targetAngleFor(world({ pin2: null }), settings(), terrain({ pinGroundM: GROUND_A }))).toBeNull();
  });
});

describe('aimFor over targetAngleFor', () => {
  const composition = { aimLock: AimLock.Target, azimuthDeg: 123, elevationDeg: 45 };

  it('yields the true angle with no profile, where the profile-only aim fabricated 0', () => {
    const w = world();
    const t = terrain({ pinGroundM: GROUND_A, pin2GroundM: GROUND_B });
    const aim = aimFor(composition, w, targetAngleFor(w, settings(), t));
    expect(aim.locked).toBe(true);
    expect(aim.elevationDeg).toBeCloseTo(18.5, 1);
    // What the old call site passed, for contrast.
    expect(aimFor(composition, w, null).elevationDeg).toBe(0);
  });

  it('leaves a manual aim alone whatever the terrain says', () => {
    const w = world();
    const t = terrain({ pinGroundM: GROUND_A, pin2GroundM: GROUND_B });
    const manual = { ...composition, aimLock: AimLock.Free };
    expect(aimFor(manual, w, targetAngleFor(w, settings(), t))).toEqual({ azimuthDeg: 123, elevationDeg: 45, locked: false });
    expect(aimFor(manual, w, null)).toEqual({ azimuthDeg: 123, elevationDeg: 45, locked: false });
  });
});

const lvl = (level: number, levels = 3, tag = 0) => ({ mesh: { level }, levels, ms: tag }) as unknown as MeshResult;
const withBuffers = (level: number) => ({ mesh: { level, pos: new Float32Array(3), nrm: new Float32Array(3), idx: new Uint32Array(3) }, levels: 2 }) as unknown as MeshResult;

describe('mesh sets', () => {
  const win = { azimuthDeg: 220, hfovDeg: 60, vfovDeg: 40, pitchDeg: 10, elHalfDeg: 30, targetRad: 0.001, rangeM: 120_000 };

  it('keys a re-aimed window under the same eye', () => {
    const a = meshKeyFor(world(), settings(), win);
    const b = meshKeyFor(world(), settings(), { ...win, azimuthDeg: 242 });
    const eye = meshEyeKeyFor(world(), settings(), win);
    expect(a).not.toBe(b);
    expect(a.startsWith(eye) && b.startsWith(eye)).toBe(true);
    expect(a.startsWith(meshEyeKeyFor(world({ pinHeightM: 5 }), settings(), win))).toBe(false);
    expect(meshEyeKeyFor(world(), settings(false), win)).toBe('');
    expect(meshEyeKeyFor(world(), settings(), null)).toBe('');
  });

  it('merges levels in order and replaces a rebuilt one', () => {
    const set = mergeLevel(mergeLevel(mergeLevel([], lvl(2)), lvl(0)), lvl(2, 3, 7));
    expect(set.map((m) => [m.mesh.level, m.ms])).toEqual([
      [0, 0],
      [2, 7]
    ]);
    expect(isComplete(set)).toBe(false);
    expect(isComplete(mergeLevel(set, lvl(1)))).toBe(true);
    expect(isComplete([])).toBe(false);
  });

  it('retires only levels no set still holds, each buffer once', () => {
    const [a, b, c] = [withBuffers(0), withBuffers(1), withBuffers(0)];
    expect(retiredBuffers([a, b], [[b], null])).toEqual([a.mesh.pos.buffer, a.mesh.nrm.buffer, a.mesh.idx.buffer]);
    expect(retiredBuffers([a, a], [])).toHaveLength(3);
    structuredClone(c.mesh.pos.buffer, { transfer: [c.mesh.pos.buffer] });
    expect(retiredBuffers([c], [])).toEqual([c.mesh.nrm.buffer, c.mesh.idx.buffer]);
  });
});
