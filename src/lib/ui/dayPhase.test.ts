import { describe, expect, it } from 'vitest';
import { phaseLightness, phaseStep } from './dayPhase';

describe('phaseStep', () => {
  it('steps from night through twilight to day', () => {
    expect(phaseStep(-40)).toBe(0);
    expect(phaseStep(-18)).toBe(1);
    expect(phaseStep(-5)).toBe(3);
    expect(phaseStep(-0.1)).toBe(4);
    expect(phaseStep(0)).toBe(5);
    expect(phaseStep(60)).toBe(9);
  });

  it('lightens with each step', () => {
    expect(phaseLightness(0)).toBe(8);
    expect(phaseLightness(9)).toBeCloseTo(84.5);
  });
});
