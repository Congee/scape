import { describe, expect, it } from 'vitest';
import { Orientation, Teleconverter } from './optics/fov';
import { planOptics, planTeleconverters, type PlanComposition } from './plan';

const base: PlanComposition = { sensorId: 'ff', focalMm: 600, fNumber: 4, orientation: Orientation.Landscape, azimuthDeg: 0, elevationDeg: 0, aimLock: 'Target' };

describe('planTeleconverters', () => {
  it('reads a plan saved before teleconverter support', () => {
    expect(planTeleconverters(base)).toEqual([]);
  });

  it('reads the scalar of a plan saved before they stacked', () => {
    expect(planTeleconverters({ ...base, teleconverter: Teleconverter.X14 })).toEqual([Teleconverter.X14]);
    expect(planTeleconverters({ ...base, teleconverter: 1 as Teleconverter })).toEqual([]);
  });

  it('prefers the stack when a plan carries both', () => {
    expect(planTeleconverters({ ...base, teleconverter: Teleconverter.X14, teleconverters: [Teleconverter.X20] })).toEqual([Teleconverter.X20]);
  });
});

describe('planOptics', () => {
  it('multiplies through the whole stack', () => {
    expect(planOptics(base)).toEqual({ focalMm: 600, fNumber: 4 });
    expect(planOptics({ ...base, teleconverter: Teleconverter.X20 })).toEqual({ focalMm: 1200, fNumber: 8 });
    expect(planOptics({ ...base, teleconverters: [Teleconverter.X14, Teleconverter.X20] })).toEqual({ focalMm: 1680, fNumber: 11.2 });
  });
});
