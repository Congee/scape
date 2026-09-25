import { describe, expect, it } from 'vitest';
import { segmentHitsRect } from './segmentRect';

const frame = { x: 100, y: 100, w: 200, h: 100 };

describe('segmentHitsRect', () => {
  it('hits a segment with an end inside', () => {
    expect(segmentHitsRect({ x: 150, y: 150 }, { x: 0, y: 0 }, frame)).toBe(true);
  });

  it('hits a chord that crosses with both ends outside', () => {
    expect(segmentHitsRect({ x: 50, y: 150 }, { x: 400, y: 160 }, frame)).toBe(true);
    expect(segmentHitsRect({ x: 200, y: 0 }, { x: 210, y: 400 }, frame)).toBe(true);
  });

  it('misses a chord that passes beside the frame', () => {
    expect(segmentHitsRect({ x: 50, y: 50 }, { x: 400, y: 60 }, frame)).toBe(false);
    expect(segmentHitsRect({ x: 50, y: 120 }, { x: 120, y: 50 }, frame)).toBe(false);
  });

  it('grows the frame by the margin', () => {
    expect(segmentHitsRect({ x: 50, y: 90 }, { x: 400, y: 90 }, frame)).toBe(false);
    expect(segmentHitsRect({ x: 50, y: 90 }, { x: 400, y: 90 }, frame, 20)).toBe(true);
  });

  it('handles a degenerate point', () => {
    expect(segmentHitsRect({ x: 150, y: 150 }, { x: 150, y: 150 }, frame)).toBe(true);
    expect(segmentHitsRect({ x: 10, y: 10 }, { x: 10, y: 10 }, frame)).toBe(false);
  });
});
