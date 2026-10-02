import { describe, expect, it } from 'vitest';
import { bboxCentre, bboxContains, bboxFromCorners, bboxIntersects, distinctBboxes } from './bbox';

const alps = { west: 6, south: 45, east: 9, north: 47 };
const dateline = { west: 170, south: -10, east: -170, north: 10 };

describe('bbox', () => {
  it('orders corners into a box', () => {
    expect(bboxFromCorners({ lng: 9, lat: 45 }, { lng: 6, lat: 47 })).toEqual(alps);
  });

  it('counts each box once, whatever its precision', () => {
    expect(distinctBboxes([])).toBe(0);
    expect(distinctBboxes([alps, { ...alps, digits: { lat: 2, lng: 2 } }, dateline])).toBe(2);
  });

  it('wraps out-of-range corner longitudes', () => {
    expect(bboxFromCorners({ lng: 190, lat: 0 }, { lng: -175, lat: 1 })).toMatchObject({ west: -175, east: -170 });
  });

  it('contains points inside and rejects points outside', () => {
    expect(bboxContains(alps, { lng: 7.5, lat: 46 })).toBe(true);
    expect(bboxContains(alps, { lng: 7.5, lat: 48 })).toBe(false);
    expect(bboxContains(alps, { lng: 10, lat: 46 })).toBe(false);
  });

  it('contains points across the antimeridian', () => {
    expect(bboxContains(dateline, { lng: 179, lat: 0 })).toBe(true);
    expect(bboxContains(dateline, { lng: -179, lat: 0 })).toBe(true);
    expect(bboxContains(dateline, { lng: 180, lat: 0 })).toBe(true);
    expect(bboxContains(dateline, { lng: 0, lat: 0 })).toBe(false);
  });

  it('intersects boxes, wrapping included', () => {
    expect(bboxIntersects(alps, { west: 8, south: 46, east: 20, north: 50 })).toBe(true);
    expect(bboxIntersects(alps, { west: 10, south: 46, east: 20, north: 50 })).toBe(false);
    expect(bboxIntersects(dateline, { west: 175, south: 0, east: 178, north: 5 })).toBe(true);
    expect(bboxIntersects(dateline, { west: -175, south: 0, east: -172, north: 5 })).toBe(true);
    expect(bboxIntersects(dateline, { west: 0, south: 0, east: 10, north: 5 })).toBe(false);
    expect(bboxIntersects(dateline, { west: 175, south: 20, east: 178, north: 30 })).toBe(false);
  });

  it('centres a box, taking the short way round the antimeridian', () => {
    expect(bboxCentre(alps)).toEqual({ lng: 7.5, lat: 46 });
    expect(bboxCentre(dateline).lng).toBe(-180); // 180 normalized
  });
});
