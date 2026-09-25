import { describe, expect, it } from 'vitest';
import { prepareConstellations, snapToStar } from './constellations';
import { encodeStarCatalog, eqjVector, parseStarCatalog, starColor, starRadiusPx } from './stars';

describe('star catalogue', () => {
  it('round-trips through the binary format', () => {
    const buf = encodeStarCatalog([
      { raDeg: 101.2872, decDeg: -16.7161, mag: -1.44, ci: 0.009 },
      { raDeg: 37.9546, decDeg: 89.2641, mag: 1.98, ci: 0.636 }
    ]);
    expect(buf.byteLength).toBe(8 + 2 * 12);
    const cat = parseStarCatalog(buf, [[0, 'Sirius']]);
    expect(cat.n).toBe(2);
    expect(cat.raDeg[0]).toBeCloseTo(101.2872, 3);
    expect(cat.decDeg[1]).toBeCloseTo(89.2641, 3);
    expect(cat.mag[0]).toBeCloseTo(-1.44, 5);
    expect(cat.names.get(0)).toBe('Sirius');
    expect(Math.hypot(cat.x[1], cat.y[1], cat.z[1])).toBeCloseTo(1, 5);
    expect(cat.z[1]).toBeGreaterThan(0.9999);
  });

  it('rejects other data', () => {
    expect(() => parseStarCatalog(new Uint8Array([1, 2, 3, 4, 0, 0, 0, 0]).buffer)).toThrow();
  });

  it('maps directions to unit vectors', () => {
    expect(eqjVector(0, 0)).toEqual([1, 0, 0]);
    const [, , z] = eqjVector(123, 90);
    expect(z).toBeCloseTo(1, 9);
  });

  it('tints hot stars blue and cool stars orange, brighter stars larger', () => {
    const hot = starColor(-0.3);
    const cool = starColor(1.5);
    expect(hot[2]).toBeGreaterThan(hot[0]);
    expect(cool[0]).toBeGreaterThan(cool[2]);
    expect(starRadiusPx(-1.4)).toBeGreaterThan(starRadiusPx(2));
    expect(starRadiusPx(6.5)).toBeGreaterThan(0.5);
  });
});

describe('constellations', () => {
  it('flattens lines into vector segments', () => {
    const p = prepareConstellations({
      Ori: { name: 'Orion', at: [83, 5], lines: [[[88.79, 7.41], [85.19, 6.35], [83.0, -0.3]], [[78.63, -8.2], [81.28, -1.94]]] }
    });
    expect(p.ids).toEqual(['Ori']);
    expect(p.names).toEqual(['Orion']);
    expect(p.segments.length).toBe(3 * 6);
    expect(Math.hypot(p.centres[0], p.centres[1], p.centres[2])).toBeCloseTo(1, 5);
  });

  it('snaps vertices to the brightest catalogue star near them, so lines follow proper motion', () => {
    // Arcturus at epoch 2025, 61″ from its J2000 line vertex; a faint star sits nearer the vertex.
    const cat = parseStarCatalog(
      encodeStarCatalog([
        { raDeg: 213.9146, decDeg: 19.1685, mag: -0.05, ci: 1.23 },
        { raDeg: 213.92, decDeg: 19.183, mag: 6.3, ci: 0.5 },
        { raDeg: 10, decDeg: 10, mag: 1, ci: 0.5 }
      ])
    );
    const set = { Boo: { name: 'Boötes', at: [215, 30] as [number, number], lines: [[[213.92, 19.18], [11, 10]] as [number, number][]] } };
    const p = prepareConstellations(set, cat);
    expect([...p.segments.subarray(0, 3)]).toEqual([cat.x[0], cat.y[0], cat.z[0]]);
    expect([...p.segments.subarray(3, 6)]).toEqual([...new Float32Array(eqjVector(11, 10))]);
    expect(snapToStar(eqjVector(213.92, 19.18), cat)).toEqual([cat.x[0], cat.y[0], cat.z[0]]);
    expect(prepareConstellations(set).segments[0]).toBeCloseTo(eqjVector(213.92, 19.18)[0], 6);
  });
});
