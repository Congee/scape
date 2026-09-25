import { describe, expect, it } from 'vitest';
import { bortleOf } from './brightness';
import { domeText, GlowLevel, glowLevel, glowTowardText, moonCurve, skyReadout, SkySourceKind } from './readout';
import type { Skyglow } from './skyglow';

const sky = (mag: number): Skyglow => ({ artificialCdm2: 0, mag, bortle: bortleOf(mag), sectorShare: new Float64Array(36), sectorDistKm: new Float64Array(36), domes: [] });

describe('sky readout', () => {
  it('reads as the brief spells it', () => {
    expect(skyReadout(sky(21.34), { kind: SkySourceKind.Yearly, year: 2024 })).toBe('Sky ≈ 21.3 mag/arcsec² · Bortle ≈ 3 · VIIRS 2024 model');
    expect(skyReadout(sky(17.2), { kind: SkySourceKind.Yearly, year: 2023 })).toContain('Bortle ≈ 8–9');
    expect(skyReadout(sky(21.34), { kind: SkySourceKind.Nightly, nights: ['2026-09-20', '2026-09-12'] })).toBe('Sky ≈ 21.3 mag/arcsec² · Bortle ≈ 3 · VIIRS nightly, 2 nights to 2026-09-20');
  });

  it('names domes by azimuth and height', () => {
    expect(domeText({ azimuthDeg: 245, heightDeg: 3.2, distanceKm: 54, share: 0.4, skylineDeg: null, hidden: false })).toBe('dome 245° WSW, ~3° high');
    expect(domeText({ azimuthDeg: 5, heightDeg: 0.6, distanceKm: 290, share: 0.2, skylineDeg: 2, hidden: true })).toBe('dome 5° N, ~0.6° high, behind terrain');
  });

  it('bands the glow toward the target', () => {
    expect(glowLevel({ prominence: 0.5, heightDeg: 3, hidden: false })).toBe(GlowLevel.None);
    expect(glowLevel({ prominence: 6, heightDeg: 3, hidden: false })).toBe(GlowLevel.Dome);
    expect(glowLevel({ prominence: 6, heightDeg: 3, hidden: true })).toBe(GlowLevel.None);
    expect(glowTowardText({ prominence: 3, heightDeg: 4.4, hidden: false }, 90)).toBe('glow toward 90° E, ~4° high');
    expect(glowTowardText({ prominence: 6, heightDeg: 4.4, hidden: true }, 90)).toBe('no notable glow toward 90° E (behind terrain)');
  });
});

const up = () => ({ altDeg: 40, azDeg: 180, illumination: 1 });
const down = () => ({ altDeg: -10, azDeg: 180, illumination: 1 });

describe('moon curve', () => {
  it('samples both ends inclusive', () => {
    const c = moonCurve(21.5, 180, 30, 0, 3_600_000, 1_800_000, down);
    expect(c.map((s) => s.t)).toEqual([0, 1_800_000, 3_600_000]);
    for (const s of c) expect(s.deltaMag).toBeCloseTo(0, 9);
  });

  it('brightens most near a full moon and less far from it', () => {
    const near = moonCurve(21.5, 180, 30, 0, 1, 1, up)[0];
    const far = moonCurve(21.5, 0, 30, 0, 1, 1, up)[0];
    expect(near.deltaMag).toBeLessThan(-3);
    expect(far.deltaMag).toBeGreaterThan(near.deltaMag);
    expect(far.deltaMag).toBeLessThan(-1);
  });

  it('is empty for an empty night', () => {
    expect(moonCurve(21.5, 0, 30, 5, 5, 1, up)).toEqual([]);
  });
});
