import { describe, expect, it } from 'vitest';
import { npfShutterS, pixelPitchUm, trailLengthPx } from './startrails';

describe('star trail rules', () => {
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
