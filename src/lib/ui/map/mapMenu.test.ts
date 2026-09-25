import { describe, expect, it } from 'vitest';
import { placeMenu } from './mapMenu';

const PHONE = { left: 0, top: 0, right: 390, bottom: 844 };

describe('placeMenu', () => {
  it('opens down and right of the pointer when it fits', () => {
    expect(placeMenu({ x: 100, y: 200 }, 180, 160, PHONE)).toEqual({ x: 100, y: 200 });
  });

  it('flips to the left and up near the far edges', () => {
    expect(placeMenu({ x: 350, y: 800 }, 180, 160, PHONE)).toEqual({ x: 170, y: 640 });
  });

  it('clamps inside the bounds when neither side fits', () => {
    expect(placeMenu({ x: 150, y: 10 }, 180, 160, { left: 0, top: 0, right: 200, bottom: 820 })).toEqual({ x: 4, y: 10 });
    expect(placeMenu({ x: 2, y: 2 }, 180, 160, PHONE, 4)).toEqual({ x: 4, y: 4 });
  });

  it('keeps a menu wider than the bounds at the left margin', () => {
    expect(placeMenu({ x: 50, y: 50 }, 500, 100, PHONE, 4).x).toBe(4);
  });

  it('respects bounds that do not start at zero', () => {
    const b = { left: 20, top: 30, right: 300, bottom: 400 };
    const p = placeMenu({ x: 25, y: 35 }, 100, 100, b, 4);
    expect(p).toEqual({ x: 25, y: 35 });
    expect(placeMenu({ x: 0, y: 0 }, 100, 100, b, 4)).toEqual({ x: 24, y: 34 });
  });
});
