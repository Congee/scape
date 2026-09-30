import { describe, expect, it } from 'vitest';
import { destination } from '@core/geo/geodesy';
import { keepParked, VICINITY_M } from './retain';

const at = { lat: 51.9091, lng: 4.4868 };

describe('keepParked', () => {
  it('keeps the same spot', () => {
    expect(keepParked(at, { ...at }, false)).toBe(true);
  });

  it('keeps a pin moved within the vicinity and lets one beyond it go', () => {
    expect(keepParked(at, destination(at, 90, VICINITY_M - 1), false)).toBe(true);
    expect(keepParked(at, destination(at, 90, VICINITY_M + 1), false)).toBe(false);
    expect(keepParked(at, { lat: 52.3731, lng: 4.8926 }, false)).toBe(false);
  });

  it('lets a lost context go even at the same spot', () => {
    expect(keepParked(at, at, true)).toBe(false);
  });

  it('takes the radius it is given', () => {
    const p = destination(at, 0, 300);
    expect(keepParked(at, p, false, 200)).toBe(false);
    expect(keepParked(at, p, false, 400)).toBe(true);
  });
});
