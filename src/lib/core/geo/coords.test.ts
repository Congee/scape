import { describe, expect, it } from 'vitest';
import { CoordFormat, formatLngLat, parseLngLat } from './coords';

describe('coords', () => {
  it('parses decimal degrees', () => {
    expect(parseLngLat('40.7463, -74.1553')).toEqual({ lat: 40.7463, lng: -74.1553 });
    expect(parseLngLat('40.7463 -74.1553')).toEqual({ lat: 40.7463, lng: -74.1553 });
  });

  it('parses DMS with hemispheres in either position', () => {
    const p = parseLngLat(`40°44'46.7"N 74°09'19.1"W`)!;
    expect(p.lat).toBeCloseTo(40.7463, 4);
    expect(p.lng).toBeCloseTo(-74.1553, 4);
    const q = parseLngLat('W74 09.32 N40 44.78')!;
    expect(q.lat).toBeCloseTo(40.7463, 3);
    expect(q.lng).toBeCloseTo(-74.1553, 3);
  });

  it('rejects non-coordinates', () => {
    expect(parseLngLat('Yosemite')).toBeNull();
    expect(parseLngLat('95, 10')).toBeNull();
    expect(parseLngLat('10 70 5, 20')).toBeNull();
  });

  it('formats', () => {
    const p = { lat: 40.7463, lng: -74.1553 };
    expect(formatLngLat(p)).toBe('40.7463°N 74.1553°W');
    expect(formatLngLat(p, CoordFormat.DMS)).toBe('40°44′46.7″N 74°09′19.1″W');
  });
});
