import { describe, expect, it } from 'vitest';
import { labelHitsDiscs, rectHitsDisc } from './labelClash';

const label = { x: 100, y: 50, w: 40, h: 12 };

describe('rectHitsDisc', () => {
  it('hits a disc centred inside the rect', () => {
    expect(rectHitsDisc(label, { x: 120, y: 56, r: 1 })).toBe(true);
  });

  it('hits a disc that swallows the rect', () => {
    expect(rectHitsDisc(label, { x: 120, y: 56, r: 200 })).toBe(true);
  });

  it('hits across an edge and misses just past it', () => {
    expect(rectHitsDisc(label, { x: 145, y: 56, r: 5 })).toBe(true);
    expect(rectHitsDisc(label, { x: 145.1, y: 56, r: 5 })).toBe(false);
  });

  it('uses the true corner distance, not the bounding box', () => {
    // 4 px right and 4 px above the top-right corner: 5.66 px away.
    expect(rectHitsDisc(label, { x: 144, y: 46, r: 5.5 })).toBe(false);
    expect(rectHitsDisc(label, { x: 144, y: 46, r: 5.7 })).toBe(true);
  });

  it('grows the rect by the margin', () => {
    const disc = { x: 150, y: 56, r: 8 };
    expect(rectHitsDisc(label, disc)).toBe(false);
    expect(rectHitsDisc(label, disc, 2)).toBe(true);
    expect(rectHitsDisc(label, disc, 1.9)).toBe(false);
  });

  it('handles discs to the left of and below the rect', () => {
    expect(rectHitsDisc(label, { x: 95, y: 56, r: 5 }, 0)).toBe(true);
    expect(rectHitsDisc(label, { x: 120, y: 70, r: 5 }, 2)).toBe(false);
    expect(rectHitsDisc(label, { x: 120, y: 70, r: 5 }, 3)).toBe(true);
  });
});

describe('labelHitsDiscs', () => {
  it('is false with no discs', () => {
    expect(labelHitsDiscs(label, [])).toBe(false);
  });

  it('hides while any disc covers it and shows again once the disc moves off', () => {
    const sun = { x: 400, y: 300, r: 20 };
    const moonAt = (x: number) => [sun, { x, y: 56, r: 6 }];
    expect(labelHitsDiscs(label, moonAt(120), 1.5)).toBe(true);
    expect(labelHitsDiscs(label, moonAt(146), 1.5)).toBe(true);
    expect(labelHitsDiscs(label, moonAt(160), 1.5)).toBe(false);
    expect(labelHitsDiscs(label, moonAt(120), 1.5)).toBe(true);
  });
});
