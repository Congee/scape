import { describe, expect, it } from 'vitest';
import { atPixel, CoordFormat, copyLngLat, formatLngLat, numberDigits, parseLngLat, pixelDigits, textDigits } from './coords';

describe('coords', () => {
  it('parses decimal degrees', () => {
    expect(parseLngLat('40.7463, -74.1553')).toEqual({ lat: 40.7463, lng: -74.1553, digits: { lat: 4, lng: 4 } });
    expect(parseLngLat('40.7463 -74.1553')).toEqual({ lat: 40.7463, lng: -74.1553, digits: { lat: 4, lng: 4 } });
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
    expect(parseLngLat('https://www.google.com/maps/@40.7195497,-74.1408596,17z')).toEqual({ lat: 40.7195497, lng: -74.1408596, digits: { lat: 7, lng: 7 } });
    expect(parseLngLat('@40.7195497,-74.1408596')).toMatchObject({ lat: 40.7195497, lng: -74.1408596 });
  });

  it('parses a trailing zoom suffix', () => {
    expect(parseLngLat('40.7195497,-74.1408596,17z')).toMatchObject({ lat: 40.7195497, lng: -74.1408596 });
    expect(parseLngLat('40.7195497, -74.1408596, 17.5z')).toMatchObject({ lat: 40.7195497, lng: -74.1408596 });
  });

  it('parses plain signed decimals', () => {
    expect(parseLngLat('40.7195497,-74.1408596')).toMatchObject({ lat: 40.7195497, lng: -74.1408596 });
  });

  it('rejects non-coordinates', () => {
    expect(parseLngLat('Yosemite')).toBeNull();
    expect(parseLngLat('95, 10')).toBeNull();
    expect(parseLngLat('10 70 5, 20')).toBeNull();
  });

  it('keeps typed digits per axis, trailing zeros included', () => {
    expect(parseLngLat('44.47,-72.7')!.digits).toEqual({ lat: 2, lng: 1 });
    expect(parseLngLat('44.470,-72')!.digits).toEqual({ lat: 3, lng: 0 });
    expect(parseLngLat('44.470342,-72.740381')!.digits).toEqual({ lat: 6, lng: 6 });
  });

  it('swaps digits with the axes when hemispheres say lng comes first', () => {
    expect(parseLngLat('W72.7 N44.47')).toEqual({ lat: 44.47, lng: -72.7, digits: { lat: 2, lng: 1 } });
  });

  it('gives DM and DMS the decimal digits their finest part resolves', () => {
    expect(parseLngLat('N40 44.78 W74 09.32')!.digits).toEqual({ lat: 4, lng: 4 });
    expect(parseLngLat(`40°44'46.7"N 74°09'19"W`)!.digits).toEqual({ lat: 5, lng: 4 });
  });

  it('counts decimals as written', () => {
    expect(textDigits('44')).toBe(0);
    expect(textDigits(' 44.470 ')).toBe(3);
    expect(textDigits('-0.1234567890123456')).toBe(12);
  });

  it('counts decimals of a JSON number', () => {
    expect(numberDigits(44.4703424)).toBe(7);
    expect(numberDigits(-72)).toBe(0);
    expect(numberDigits(1e-7)).toBe(7);
    expect(numberDigits(1.5e-7)).toBe(8);
  });

  it('resolves one pixel per axis from zoom', () => {
    // z0: 360/512 ≈ 0.70°/px; z11 ≈ 3.4e-4; z18 ≈ 2.7e-6; z22 clamps to 7.
    expect(pixelDigits(0, 0)).toEqual({ lat: 1, lng: 1 });
    expect(pixelDigits(0, 11)).toEqual({ lat: 4, lng: 4 });
    expect(pixelDigits(0, 18)).toEqual({ lat: 6, lng: 6 });
    expect(pixelDigits(0, 22)).toEqual({ lat: 7, lng: 7 });
    // Latitude pixels shrink toward the poles: cos(80°) ≈ 0.17.
    expect(pixelDigits(80, 11)).toEqual({ lat: 5, lng: 4 });
    expect(pixelDigits(0, -2).lng).toBe(0);
  });

  it('rounds a map pick to its pixel digits', () => {
    expect(atPixel({ lat: 44.470342, lng: -72.740381 }, 11)).toEqual({ lat: 44.4703, lng: -72.7404, digits: { lat: 4, lng: 4 } });
  });

  it('formats', () => {
    const p = { lat: 40.7463, lng: -74.1553 };
    expect(formatLngLat(p, CoordFormat.DD)).toBe('40.7463°N 74.1553°W');
    expect(formatLngLat(p, CoordFormat.DMS)).toBe('40°44′46.7″N 74°09′19.1″W');
  });

  it('shows signed lat,lng at the known digits, never padded or noisy', () => {
    expect(formatLngLat({ lat: 44.47, lng: -72.74, digits: { lat: 2, lng: 2 } })).toBe('44.47,-72.74');
    expect(formatLngLat({ lat: 44.47, lng: -72.7, digits: { lat: 2, lng: 1 } })).toBe('44.47,-72.7');
    expect(formatLngLat({ lat: 44.470342, lng: -72.740381, digits: { lat: 6, lng: 6 } }, CoordFormat.Signed)).toBe('44.470342,-72.740381');
    expect(formatLngLat({ lat: 44.1 + 0.2, lng: -72.7, digits: { lat: 1, lng: 1 } })).toBe('44.3,-72.7');
    expect(formatLngLat({ lat: 44.47, lng: -72.7, digits: { lat: 3, lng: 0 } })).toBe('44.470,-73');
  });

  it('falls back to six digits without trailing zeros when precision is unknown', () => {
    expect(formatLngLat({ lat: 44.4703421234, lng: -72.740381 })).toBe('44.470342,-72.740381');
    expect(formatLngLat({ lat: 40.7463, lng: -74 })).toBe('40.7463,-74');
  });

  it('copies the string it shows', () => {
    const p = { lat: 44.470342, lng: -72.740381, digits: { lat: 4, lng: 5 } };
    expect(copyLngLat(p)).toBe('44.4703,-72.74038');
    expect(copyLngLat(p)).toBe(formatLngLat(p));
    expect(copyLngLat(p, CoordFormat.DMS)).toBe(formatLngLat(p, CoordFormat.DMS));
  });

  it('parses its own output back with the same digits', () => {
    const p = { lat: 44.470342, lng: -72.740381, digits: { lat: 6, lng: 6 } };
    expect(parseLngLat(copyLngLat(p))).toEqual(p);
    expect(parseLngLat('44.470342, -72.740381')).toEqual(p);
    const q = { lat: 44.47, lng: -72.7, digits: { lat: 2, lng: 1 } };
    expect(parseLngLat(formatLngLat(q))).toEqual(q);
  });
});
