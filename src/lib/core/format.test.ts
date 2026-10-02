import { describe, expect, it } from 'vitest';
import { azimuth, moonPhase } from './format';

describe('azimuth', () => {
  it('shows one decimal and the compass point', () => {
    expect(azimuth(135.04)).toBe('135.0° SE');
    expect(azimuth(359.96)).toBe('360.0° N');
  });
});

describe('moonPhase', () => {
  it('shows two decimals below 10 % so a thin crescent is not 0', () => {
    expect(moonPhase('Waxing crescent', 0.0123)).toBe('Waxing crescent · 1.23%');
    expect(moonPhase('Full', 0.987)).toBe('Full · 98.7%');
  });
});
