import { describe, expect, it } from 'vitest';
import { GlowAt, glowPointFor } from './glowPoint';
import { EYE_HEIGHT_M, horizonKeyFor } from './terrain';

const pin = { lat: 46.02, lng: 7.75 };
const peak = { lat: 45.9766, lng: 7.6585 };
const on = { terrain: true, terrainHorizon: true, horizonRangeKm: 150 };

describe('glowPointFor', () => {
  it('follows the target at eye height on its ground, apart from the camera height', () => {
    const g = glowPointFor({ pin, pinHeightM: 30, pin2: peak }, on);
    expect(g).toMatchObject({ at: GlowAt.Target, point: peak, aboveGroundM: EYE_HEIGHT_M });
    expect(g.horizonKey).toBe(horizonKeyFor({ pin: peak, pinHeightM: 0, pin2: null, pin2HeightM: 0 }, on));
  });

  it('falls back to the pin with its skyline key when no target is set', () => {
    const w = { pin, pinHeightM: 30, pin2: null };
    const g = glowPointFor(w, on);
    expect(g).toMatchObject({ at: GlowAt.Pin, point: pin, aboveGroundM: 30 + EYE_HEIGHT_M });
    expect(g.horizonKey).toBe(horizonKeyFor({ ...w, pin2HeightM: 0 }, on));
  });

  it('keys each point apart, so a moved target needs a new skyline', () => {
    const a = glowPointFor({ pin, pinHeightM: 0, pin2: peak }, on).horizonKey;
    const b = glowPointFor({ pin, pinHeightM: 0, pin2: { lat: peak.lat + 0.01, lng: peak.lng } }, on).horizonKey;
    expect(a).not.toBe(b);
    expect(a).not.toBe(glowPointFor({ pin, pinHeightM: 0, pin2: null }, on).horizonKey);
  });

  it('needs no skyline while terrain or the horizon is off', () => {
    expect(glowPointFor({ pin, pinHeightM: 0, pin2: peak }, { ...on, terrainHorizon: false }).horizonKey).toBe('');
    expect(glowPointFor({ pin, pinHeightM: 0, pin2: null }, { ...on, terrain: false }).horizonKey).toBe('');
  });
});
