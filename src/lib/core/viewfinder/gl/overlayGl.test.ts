import { describe, expect, it } from 'vitest';
import { hexRgba, OVERLAY_STRIDE, OverlayBatch, OverlayFlag, OverlayShape } from './overlayGl';

const WHITE = [1, 1, 1, 1] as const;

describe('OverlayBatch', () => {
  it('packs a segment as ends, half width, shape and flags, ghost, colour', () => {
    const b = new OverlayBatch();
    b.segment(1, 2, 3, 4, 1.5, OverlayFlag.Hidden | OverlayFlag.RoundEnd, 0.35, [0.1, 0.2, 0.3, 0.9]);
    expect(b.count).toBe(1);
    expect([...b.data.subarray(0, OVERLAY_STRIDE)].map((v) => +v.toFixed(4))).toEqual([1, 2, 3, 4, 0.75, OverlayShape.Segment | OverlayFlag.Hidden | OverlayFlag.RoundEnd, 0.35, 0, 0.1, 0.2, 0.3, 0.9]);
  });

  it('stores boxes and discs at one point with radius as half width', () => {
    const b = new OverlayBatch();
    b.box(5, 6, 0.8, WHITE);
    b.disc(7, 8, 2, WHITE);
    const d = b.data;
    expect([d[0], d[1], d[2], d[3], d[4], d[5]]).toEqual([5, 6, 5, 6, Math.fround(0.8), OverlayShape.Box]);
    const o = OVERLAY_STRIDE;
    expect([d[o], d[o + 1], d[o + 2], d[o + 3], d[o + 4], d[o + 5]]).toEqual([7, 8, 7, 8, 2, OverlayShape.Disc]);
  });

  it('grows past its first buffer and keeps what it had', () => {
    const b = new OverlayBatch();
    const first = b.data.length / OVERLAY_STRIDE;
    for (let i = 0; i < first + 3; i++) b.disc(i, -i, 1, WHITE);
    expect(b.count).toBe(first + 3);
    expect(b.data.length).toBeGreaterThanOrEqual((first + 3) * OVERLAY_STRIDE);
    expect(b.data[0]).toBe(0);
    expect(b.data[(first + 2) * OVERLAY_STRIDE]).toBe(first + 2);
    expect(b.data[(first + 2) * OVERLAY_STRIDE + 1]).toBe(-(first + 2));
  });

  it('reuses its buffer after clear', () => {
    const b = new OverlayBatch();
    b.disc(1, 1, 1, WHITE);
    const data = b.data;
    b.clear();
    expect(b.count).toBe(0);
    b.disc(2, 2, 1, WHITE);
    expect(b.data).toBe(data);
    expect(b.data[0]).toBe(2);
  });

  it('keeps shape and flags in separate bits', () => {
    const all = OverlayFlag.RoundStart | OverlayFlag.RoundEnd | OverlayFlag.Hidden;
    for (const s of Object.values(OverlayShape)) expect((s | all) & 3).toBe(s);
  });
});

describe('hexRgba', () => {
  it('splits #rrggbb into 0..1 channels', () => {
    expect(hexRgba('#ff8000', 0.5)).toEqual([1, 128 / 255, 0, 0.5]);
  });
});
