import { describe, expect, it } from 'vitest';
import { CoordFormat, copyLngLat, formatLngLat, parseLngLat } from './coords';

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

  it('parses a Google Maps URL or fragment', () => {
    expect(parseLngLat('https://www.google.com/maps/@40.7195497,-74.1408596,17z')).toEqual({ lat: 40.7195497, lng: -74.1408596 });
    expect(parseLngLat('@40.7195497,-74.1408596')).toEqual({ lat: 40.7195497, lng: -74.1408596 });
  });

  it('parses a trailing zoom suffix', () => {
    expect(parseLngLat('40.7195497,-74.1408596,17z')).toEqual({ lat: 40.7195497, lng: -74.1408596 });
    expect(parseLngLat('40.7195497, -74.1408596, 17.5z')).toEqual({ lat: 40.7195497, lng: -74.1408596 });
  });

  it('parses plain signed decimals', () => {
    expect(parseLngLat('40.7195497,-74.1408596')).toEqual({ lat: 40.7195497, lng: -74.1408596 });
  });

  it('rejects non-coordinates', () => {
    expect(parseLngLat('Yosemite')).toBeNull();
    expect(parseLngLat('95, 10')).toBeNull();
    expect(parseLngLat('10 70 5, 20')).toBeNull();
  });

  it('formats', () => {
    const p = { lat: 40.7463, lng: -74.1553 };
    expect(formatLngLat(p, CoordFormat.DD)).toBe('40.7463°N 74.1553°W');
    expect(formatLngLat(p, CoordFormat.DMS)).toBe('40°44′46.7″N 74°09′19.1″W');
  });

  it('defaults to signed lat,lng at four decimals', () => {
    const p = { lat: 44.470342, lng: -72.740381 };
    expect(formatLngLat(p)).toBe('44.4703,-72.7404');
    expect(formatLngLat(p, CoordFormat.Signed)).toBe('44.4703,-72.7404');
  });

  it('copies signed at six decimals and other formats as shown', () => {
    const p = { lat: 44.470342, lng: -72.740381 };
    expect(copyLngLat(p)).toBe('44.470342,-72.740381');
    expect(copyLngLat(p, CoordFormat.DMS)).toBe(formatLngLat(p, CoordFormat.DMS));
  });

  it('parses its own output back', () => {
    const p = { lat: 44.470342, lng: -72.740381 };
    expect(parseLngLat(copyLngLat(p))).toEqual(p);
    expect(parseLngLat('44.470342, -72.740381')).toEqual(p);
  });
});
