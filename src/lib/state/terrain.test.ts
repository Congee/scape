import { describe, expect, it } from 'vitest';
import { distanceM, type LngLat } from '@core/geo/geodesy';
import { analyzeSightline, endpointHeightM } from '@core/terrain/los';
import type { ProfileResult } from '@workers/terrain.protocol';
import { aimFor } from './composition';
import { profileKeyFor, targetAngleFor, type TerrainState } from './terrain';

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

  it('never takes an endpoint below the geoid', () => {
    const s = settings();
    const below = targetAngleFor(world(), s, terrain({ pinGroundM: -400, pin2GroundM: -30 }));
    expect(below).toBe(targetAngleFor(world(), s, terrain({ pinGroundM: 0, pin2GroundM: 0 })));
  });

  it('has no answer without a target', () => {
    expect(targetAngleFor(world({ pin2: null }), settings(), terrain({ pinGroundM: GROUND_A }))).toBeNull();
  });
});

describe('aimFor over targetAngleFor', () => {
  const composition = { aimAtTarget: true, azimuthDeg: 123, elevationDeg: 45 };

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
    const manual = { ...composition, aimAtTarget: false };
    expect(aimFor(manual, w, targetAngleFor(w, settings(), t))).toEqual({ azimuthDeg: 123, elevationDeg: 45, locked: false });
    expect(aimFor(manual, w, null)).toEqual({ azimuthDeg: 123, elevationDeg: 45, locked: false });
  });
});
