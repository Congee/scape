import { describe, expect, it } from 'vitest';
import { shadowLengthM } from './shadow';

describe('shadowLengthM', () => {
  it('has no shadow while the sun is at or below the horizon', () => {
    expect(shadowLengthM(1.8, 0)).toBeNull();
    expect(shadowLengthM(1.8, -3)).toBeNull();
  });

  it('matches the object height at 45°', () => {
    expect(shadowLengthM(1.8, 45)).toBeCloseTo(1.8, 6);
  });

  it('stretches to 9.51× the height at 6°', () => {
    expect(shadowLengthM(1, 6)).toBeCloseTo(9.514, 3);
  });

  it('rejects a non-positive height', () => {
    expect(shadowLengthM(0, 30)).toBeNull();
  });
});
