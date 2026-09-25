import { describe, expect, it } from 'vitest';
import { lightPointObserver } from './lightProbe';
import { EYE_HEIGHT_M } from './terrain';

describe('lightPointObserver', () => {
  it('stands on the point’s ground, or sea level where it is unknown', () => {
    const p = { lat: 46.5475, lng: 7.9625 };
    expect(lightPointObserver(p, { groundM: 3000 }).height).toBe(3000 + EYE_HEIGHT_M);
    expect(lightPointObserver(p, { groundM: Number.NaN }).height).toBe(EYE_HEIGHT_M);
  });
});
