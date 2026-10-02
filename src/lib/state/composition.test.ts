import { describe, expect, it } from 'vitest';
import { Teleconverter } from '@core/optics/fov';
import { AimLock, aimPatch, COMPOSITION_VERSION, DEFAULT_COMPOSITION, legacyAimLock, migrateComposition, parseAimLock } from './composition';

describe('migrateComposition', () => {
  it('turns the v0 scalar teleconverter into a stack', () => {
    const v0 = { ...DEFAULT_COMPOSITION, teleconverters: undefined, teleconverter: Teleconverter.X20 };
    expect(migrateComposition(v0, 0).teleconverters).toEqual([Teleconverter.X20]);
  });

  it('reads v0 “none” as an empty stack', () => {
    expect(migrateComposition({ ...DEFAULT_COMPOSITION, teleconverter: 1 }, 0).teleconverters).toEqual([]);
    expect(migrateComposition({}, 0).teleconverters).toEqual([]);
  });

  it('drops the old key so it cannot come back', () => {
    expect(migrateComposition({ teleconverter: 2 }, 0)).not.toHaveProperty('teleconverter');
  });

  it('turns the v1 target flag into a lock', () => {
    expect(migrateComposition({ aimAtTarget: true }, 1).aimLock).toBe(AimLock.Target);
    expect(migrateComposition({ aimAtTarget: false }, 1).aimLock).toBe(AimLock.Free);
    expect(migrateComposition({}, 1).aimLock).toBe(AimLock.Free);
    expect(migrateComposition({ aimAtTarget: true }, 1)).not.toHaveProperty('aimAtTarget');
  });

  it('runs both steps on a v0 profile', () => {
    const m = migrateComposition({ teleconverter: 1.4, aimAtTarget: true }, 0);
    expect(m).toMatchObject({ teleconverters: [1.4], aimLock: AimLock.Target });
  });

  it('leaves a current profile alone', () => {
    expect(migrateComposition(DEFAULT_COMPOSITION, COMPOSITION_VERSION)).toEqual(DEFAULT_COMPOSITION);
  });
});

describe('aimPatch', () => {
  it('normalises the bearing and clamps the elevation', () => {
    expect(aimPatch(-10, 120)).toEqual({ azimuthDeg: 350, elevationDeg: 89, aimLock: 'Free' });
  });

  it('refuses a non-finite angle rather than persisting it', () => {
    expect(aimPatch(NaN, 10)).toEqual({});
    expect(aimPatch(10, NaN)).toEqual({});
    expect(aimPatch(Infinity, 10)).toEqual({});
  });
});

describe('parseAimLock', () => {
  it('keeps known locks and frees anything else', () => {
    expect(parseAimLock('Gc')).toBe(AimLock.Gc);
    expect(parseAimLock('gc')).toBe(AimLock.Free);
    expect(parseAimLock(null)).toBe(AimLock.Free);
    expect(legacyAimLock('yes')).toBe(AimLock.Free);
  });
});
