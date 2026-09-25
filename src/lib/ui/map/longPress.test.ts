import { describe, expect, it } from 'vitest';
import { LONG_PRESS_SLOP_PX, LongPress } from './longPress';

const at = (x: number, y: number) => [{ x, y }];

describe('LongPress', () => {
  it('fires at the press point when held still', () => {
    const lp = new LongPress();
    expect(lp.down(at(100, 50))).toBe(true);
    expect(lp.move(at(102, 51))).toBe(false);
    expect(lp.elapse()).toEqual({ x: 100, y: 50 });
    expect(lp.up(0)).toBe(true);
  });

  it('is cancelled by movement past the slop', () => {
    const lp = new LongPress();
    lp.down(at(100, 50));
    expect(lp.move(at(100 + LONG_PRESS_SLOP_PX + 1, 50))).toBe(true);
    expect(lp.elapse()).toBeNull();
    expect(lp.up(0)).toBe(false);
  });

  it('is cancelled by a second finger', () => {
    const lp = new LongPress();
    lp.down(at(100, 50));
    expect(lp.down([{ x: 100, y: 50 }, { x: 200, y: 80 }])).toBe(false);
    expect(lp.pending).toBe(false);
    expect(lp.elapse()).toBeNull();
  });

  it('is cancelled by a pinch that reports two touches on move', () => {
    const lp = new LongPress();
    lp.down(at(100, 50));
    expect(lp.move([{ x: 100, y: 50 }, { x: 101, y: 50 }])).toBe(true);
    expect(lp.elapse()).toBeNull();
  });

  it('does not re-arm until every finger lifts after firing', () => {
    const lp = new LongPress();
    lp.down(at(10, 10));
    lp.elapse();
    lp.down([{ x: 10, y: 10 }, { x: 50, y: 50 }]);
    expect(lp.up(1)).toBe(true);
    expect(lp.down(at(10, 10))).toBe(false);
    expect(lp.up(0)).toBe(true);
    expect(lp.down(at(10, 10))).toBe(true);
  });

  it('lets an early lift pass as a tap', () => {
    const lp = new LongPress();
    lp.down(at(10, 10));
    expect(lp.up(0)).toBe(false);
    expect(lp.elapse()).toBeNull();
  });
});
