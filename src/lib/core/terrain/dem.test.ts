import { describe, expect, it } from 'vitest';
import { decodeTerrarium, elevationAt, sampleTile, type DemSource, type DemTile } from './dem';

describe('decodeTerrarium', () => {
  it('decodes known triplets', () => {
    const rgba = new Uint8ClampedArray([128, 0, 0, 255, 128, 1, 0, 255, 127, 255, 128, 255, 162, 139, 0, 255]);
    const e = decodeTerrarium(rgba, 2);
    expect(e[0]).toBe(0);
    expect(e[1]).toBe(1);
    expect(e[2]).toBeCloseTo(-0.5, 6);
    expect(e[3]).toBe(8843);
  });
});

describe('sampleTile', () => {
  const tile: DemTile = { z: 0, x: 0, y: 0, size: 2, elev: new Float32Array([0, 10, 20, 30]) };

  it('interpolates bilinearly between pixel centres', () => {
    expect(sampleTile(tile, 1, 1)).toBeCloseTo(15);
    expect(sampleTile(tile, 0.5, 0.5)).toBeCloseTo(0);
    expect(sampleTile(tile, 1.5, 0.5)).toBeCloseTo(10);
    expect(sampleTile(tile, 1, 1.5)).toBeCloseTo(25);
  });

  it('clamps at the edges', () => {
    expect(sampleTile(tile, 0, 0)).toBe(0);
    expect(sampleTile(tile, 2, 2)).toBe(30);
  });

  it('reads through a DemSource and reports missing tiles as NaN', () => {
    const src: DemSource = { get: (z, x, y) => (z === 0 && x === 0 && y === 0 ? tile : undefined) };
    expect(elevationAt(src, 0, 0, 0)).toBeCloseTo(15);
    expect(elevationAt(src, 0, 0, 1)).toBeNaN();
  });
});
