import { describe, expect, it } from 'vitest';
import { fitPhoto, focal35ForHfov, photoHfovDeg } from './fit';

const frame = { x: 10, y: 20, w: 720, h: 480, pxPerMm: 20 };
const at = (focal35: number, over: Partial<{ dx: number; dy: number; rotDeg: number; w: number; h: number }> = {}) => ({ w: 6000, h: 4000, focal35, dx: 0, dy: 0, rotDeg: 0, ...over });

describe('photoHfovDeg', () => {
  it('matches a full-frame lens for a 3:2 photo', () => {
    expect(photoHfovDeg(24, 3, 2)).toBeCloseTo((2 * Math.atan(18 / 24) * 180) / Math.PI, 9);
    expect(photoHfovDeg(200, 3, 2)).toBeCloseTo((2 * Math.atan(18 / 200) * 180) / Math.PI, 9);
  });

  it('keeps the diagonal for other aspects', () => {
    const w = 4;
    const h = 3;
    const half = Math.tan((photoHfovDeg(50, w, h) * Math.PI) / 360);
    expect(Math.hypot(half, (half * h) / w) * 2 * 50).toBeCloseTo(Math.hypot(36, 24), 9);
  });
});

describe('fitPhoto', () => {
  it('fills a full-frame frame when the photo was shot at the same focal length', () => {
    for (const f of [24, 200, 600]) {
      const b = fitPhoto(frame, f, at(f));
      expect(b.w).toBeCloseTo(frame.w, 6);
      expect(b.h).toBeCloseTo(frame.h, 6);
      expect(b.cx).toBe(370);
      expect(b.cy).toBe(260);
    }
  });

  it('scales with the lens by angle', () => {
    expect(fitPhoto(frame, 600, at(200)).w).toBeCloseTo(frame.w * 3, 6);
    expect(fitPhoto(frame, 24, at(200)).w).toBeCloseTo(frame.w * 0.12, 6);
  });

  it('locks a photo without Exif to the lens it was loaded under', () => {
    // A 3:4 photo loaded at 200 mm on a 36 mm-wide frame, then zoomed to 600 mm.
    const hfov = (2 * Math.atan(18 / 200) * 180) / Math.PI;
    const f35 = focal35ForHfov(hfov, 3000, 4000);
    expect(photoHfovDeg(f35, 3000, 4000)).toBeCloseTo(hfov, 9);
    expect(fitPhoto(frame, 200, at(f35, { w: 3000, h: 4000 })).w).toBeCloseTo(frame.w, 6);
    const b = fitPhoto(frame, 600, at(f35, { w: 3000, h: 4000 }));
    expect(b.w).toBeCloseTo(frame.w * 3, 6);
    expect(b.h).toBeCloseTo(frame.w * 4, 6);
  });

  it('offsets in photo widths, y up, and passes the rotation through', () => {
    const b = fitPhoto(frame, 200, at(200, { dx: 0.01, dy: 0.02, rotDeg: -1.5 }));
    expect(b.cx).toBeCloseTo(370 + 7.2, 6);
    expect(b.cy).toBeCloseTo(260 - 14.4, 6);
    expect(b.rotDeg).toBe(-1.5);
  });
});
