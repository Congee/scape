import { describe, expect, it } from 'vitest';
import { npfShutterS, pixelPitchUm, ruleOfN, trailLengthPx } from './startrails';

describe('star trail rules', () => {
  it('500 rule scales with equivalent focal length', () => {
    expect(ruleOfN(24)).toBeCloseTo(20.83, 2);
    expect(ruleOfN(24, 1.5)).toBeCloseTo(13.89, 2);
    expect(ruleOfN(24, 1, 600)).toBeCloseTo(25, 2);
  });

  it('NPF for a 14 mm f/2.8 on 5.9 µm pixels is about 9 s', () => {
    expect(npfShutterS(2.8, 14, 5.9)).toBeCloseTo(9.25, 2);
    expect(npfShutterS(2.8, 14, 5.9, 60)).toBeCloseTo(9.25 * 2, 1);
  });

  it('pixel pitch and trail length', () => {
    expect(pixelPitchUm(35.9, 6000)).toBeCloseTo(5.98, 2);
    expect(trailLengthPx(20, 24, 5.9)).toBeCloseTo(5.93, 1);
    expect(trailLengthPx(20, 24, 5.9, 60)).toBeCloseTo(5.93 / 2, 1);
  });
});
