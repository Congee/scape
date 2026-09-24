import { describe, expect, it } from 'vitest';
import { fitPhoto, photoHfovDeg } from './fit';

const frame = { x: 10, y: 20, w: 720, h: 480, pxPerMm: 20 };
const at = (focal35: number | null, over: Partial<{ dx: number; dy: number; rotDeg: number; w: number; h: number }> = {}) => ({ w: 6000, h: 4000, focal35, dx: 0, dy: 0, rotDeg: 0, ...over });

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

  it('spans the frame without Exif, keeping its own aspect', () => {
    const b = fitPhoto(frame, 600, at(null, { w: 3000, h: 4000 }));
    expect(b.w).toBe(720);
    expect(b.h).toBe(960);
  });

  it('offsets in photo widths, y up, and passes the rotation through', () => {
    const b = fitPhoto(frame, 200, at(200, { dx: 0.01, dy: 0.02, rotDeg: -1.5 }));
    expect(b.cx).toBeCloseTo(370 + 7.2, 6);
    expect(b.cy).toBeCloseTo(260 - 14.4, 6);
    expect(b.rotDeg).toBe(-1.5);
  });
});
