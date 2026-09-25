import { describe, expect, it } from 'vitest';
import { at, batchOf, PIN, rect, square } from '@core/geo/batchFixture';
import { AltitudeRef, convexHull, groundUnknown, inLngLatRing, lngLatToLocal, localToLngLat, modelOutlines, type ModelAnchor, type ModelPart } from '@core/model';
import { RoofShape } from '@workers/buildings.protocol';
import { modelHeightAt } from './heightAt';
import { partsMesh } from './mesh';
import { modelApexM, newPart, rowsRings, seedModel, spirePart } from './seed';

const ANCHOR: ModelAnchor = { ...PIN, altRef: AltitudeRef.Ground, altM: 0, headingDeg: 0, scale: 1 };

const block = (over: Partial<ModelPart> = {}): ModelPart => ({ id: 'b', ring: rect(0, 0, 40, 20), baseM: 0, heightM: 30, roof: RoofShape.Flat, roofHeightM: 0, roofDirDeg: NaN, roofAcross: 0, ...over });

/** Signed volume by the divergence theorem; positive when every face winds outward. */
function volume(pos: Float32Array): number {
  let v = 0;
  for (let t = 0; t < pos.length; t += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = pos.subarray(t, t + 9);
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

/** Directed edges with no reverse twin; zero for a closed, consistently wound mesh. */
function openEdges(pos: Float32Array): number {
  const key = (i: number) => `${pos[i].toFixed(4)},${pos[i + 1].toFixed(4)},${pos[i + 2].toFixed(4)}`;
  const edges = new Map<string, number>();
  for (let t = 0; t < pos.length; t += 9) {
    for (const [a, b] of [[t, t + 3], [t + 3, t + 6], [t + 6, t]]) {
      const back = `${key(b)}|${key(a)}`;
      const n = edges.get(back) ?? 0;
      if (n > 0) edges.set(back, n - 1);
      else edges.set(`${key(a)}|${key(b)}`, (edges.get(`${key(a)}|${key(b)}`) ?? 0) + 1);
    }
  }
  return [...edges.values()].reduce((s, n) => s + n, 0);
}

/** Plan area of the faces pointing down. */
function downFacing(pos: Float32Array): number {
  let a = 0;
  for (let t = 0; t < pos.length; t += 9) {
    const z = (pos[t + 3] - pos[t]) * (pos[t + 7] - pos[t + 1]) - (pos[t + 4] - pos[t + 1]) * (pos[t + 6] - pos[t]);
    if (z < 0) a -= z / 2;
  }
  return a;
}

describe('partsMesh', () => {
  it('closes a block with outward faces, either ring winding', () => {
    expect(volume(partsMesh([block()]).pos)).toBeCloseTo(40 * 20 * 30, 1);
    expect(volume(partsMesh([block({ ring: rect(0, 0, 40, 20).toReversed() })]).pos)).toBeCloseTo(40 * 20 * 30, 1);
  });

  it('closes every part on the ground with a floor', () => {
    for (const roof of [RoofShape.Flat, RoofShape.Gabled, RoofShape.Hipped, RoofShape.Pyramidal]) {
      const m = partsMesh([block({ roof, roofHeightM: roof === RoofShape.Flat ? 0 : 8 })]);
      expect(openEdges(m.pos), `roof ${roof}`).toBe(0);
      expect(downFacing(m.pos)).toBeCloseTo(40 * 20, 1);
    }
  });

  it('puts a floor under a raised part', () => {
    expect(volume(partsMesh([block({ baseM: 10 })]).pos)).toBeCloseTo(40 * 20 * 20, 1);
  });

  it('keeps pitched roofs closed and under the apex', () => {
    for (const roof of [RoofShape.Gabled, RoofShape.Hipped, RoofShape.Pyramidal, RoofShape.Skillion, RoofShape.Dome]) {
      const m = partsMesh([block({ roof, roofHeightM: 8 })]);
      const v = volume(m.pos);
      expect(v).toBeGreaterThan(40 * 20 * 22);
      expect(v).toBeLessThan(40 * 20 * 30);
      expect(m.box[5]).toBeCloseTo(30, 4);
    }
  });

  it('skips a part with no rise', () => {
    expect(partsMesh([block({ heightM: 0 })]).idx.length).toBe(0);
  });
});

describe('model frame', () => {
  it('round-trips local metres through lng/lat with a heading and scale', () => {
    const a = { ...ANCHOR, headingDeg: 63, scale: 0.8 };
    const [e, n] = lngLatToLocal(a, localToLngLat(a, 120, -45));
    expect(e).toBeCloseTo(120, 6);
    expect(n).toBeCloseTo(-45, 6);
  });

  it('turns local north by the heading', () => {
    const [e, n] = lngLatToLocal(ANCHOR, localToLngLat({ ...ANCHOR, headingDeg: 90 }, 0, 100));
    expect(e).toBeCloseTo(100, 5);
    expect(n).toBeCloseTo(0, 5);
  });

  it('hulls counter-clockwise without interior points', () => {
    const h = convexHull([[0, 0], [2, 0], [1, 1], [2, 2], [0, 2]]);
    expect(h).toEqual([[0, 0], [2, 0], [2, 2], [0, 2]]);
  });
});

describe('groundUnknown', () => {
  it('flags a ground-standing model saved without a DEM, until its ground is known', () => {
    expect(groundUnknown({ anchor: ANCHOR, groundM: NaN })).toBe(true);
    expect(groundUnknown({ anchor: ANCHOR, groundM: 4 })).toBe(false);
    expect(groundUnknown({ anchor: { ...ANCHOR, altRef: AltitudeRef.Absolute }, groundM: NaN })).toBe(false);
  });
});

describe('rowsRings', () => {
  it('gives each row its own lng/lat ring', () => {
    const rows = batchOf([{ ring: rect(0, 0, 10, 10), heightM: 5 }, { ring: rect(50, 0, 20, 10), heightM: 8 }]);
    const rings = rowsRings(rows);
    expect(rings.map((r) => r.length)).toEqual([rows.ringStart[1], rows.ringStart[2] - rows.ringStart[1]]);
    expect(rings[1][0]).toEqual([rows.lng[rows.ringStart[1]], rows.lat[rows.ringStart[1]]]);
    expect(rowsRings(batchOf([]))).toEqual([]);
  });
});

describe('seedModel', () => {
  // Shaped like Overture's 30 Hudson Yards group: a podium, the tower, and a sloped crown.
  const rows = batchOf([
    { ring: rect(0, 0, 90, 70), heightM: 60, groundM: 4 },
    { ring: rect(10, 5, 50, 40), heightM: 330, groundM: 3 },
    { ring: rect(10, 5, 50, 40), heightM: 395, minHeightM: 330, roofShape: RoofShape.Skillion, roofHeightM: 40, roofDirDeg: 200, groundM: 3 }
  ]);
  const m = seedModel(rows, '30 Hudson Yards', 1000)!;

  it('makes one part per row with its heights and roof', () => {
    expect(m.parts).toHaveLength(3);
    const crown = m.parts!.find((p) => p.baseM === 330)!;
    expect(crown.heightM).toBe(395);
    expect(crown.roof).toBe(RoofShape.Skillion);
    expect(crown.roofHeightM).toBe(40);
    expect(crown.roofDirDeg).toBe(200);
    expect(modelApexM(m.parts!)).toBe(395);
  });

  it('stands on the lowest ground of its rows and suppresses Overture', () => {
    expect(m.groundM).toBe(3);
    expect(m.anchor.altRef).toBe(AltitudeRef.Ground);
    expect(m.suppressOverture).toBe(true);
    expect(m.createdAt).toBe(1000);
  });

  it('keeps the rings where the rows were', () => {
    const podium = m.parts!.find((p) => p.heightM === 60)!;
    const xs = podium.ring.map((v) => v[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(90, 3);
    const g = localToLngLat(m.anchor, podium.ring[0][0], podium.ring[0][1]);
    expect(g.lng).toBeCloseTo(rows.lng[0], 9);
    expect(g.lat).toBeCloseTo(rows.lat[0], 9);
  });

  it('outlines every row in its footprint', () => {
    for (let i = 0; i < rows.count; i++) expect(inLngLatRing(m.footprint, { lng: rows.cLng[i], lat: rows.cLat[i] })).toBe(true);
  });

  it('returns null for no usable rows', () => {
    expect(seedModel(batchOf([]), 'x')).toBeNull();
  });
});

describe('part edits', () => {
  it('stands a spire on the tallest part', () => {
    const s = spirePart([block({ ring: square(5, 5, 10), heightM: 80 }), block()]);
    expect(s.baseM).toBe(80);
    expect(s.heightM).toBeGreaterThan(80);
    expect(s.roof).toBe(RoofShape.Pyramidal);
    const cx = s.ring.reduce((a, v) => a + v[0], 0) / 4;
    expect(cx).toBeCloseTo(5, 6);
  });

  it('copies a part under a new id without sharing its ring', () => {
    const a = block();
    const b = newPart(a);
    expect(b.id).not.toBe(a.id);
    b.ring[0][0] = 999;
    expect(a.ring[0][0]).not.toBe(999);
  });
});

describe('modelHeightAt', () => {
  const m = seedModel(batchOf([{ ring: rect(0, 0, 40, 40), heightM: 395, groundM: 3 }]), 'Tower')!;

  it('reads the apex above ground inside a visible footprint', () => {
    expect(modelHeightAt([m], PIN)?.heightM).toBeCloseTo(395, 6);
    expect(modelHeightAt([m], PIN)?.model.name).toBe('Tower');
  });

  it('adds a raised anchor and a scale', () => {
    const lifted = { ...m, anchor: { ...m.anchor, altM: 5, scale: 1.1 } };
    expect(modelHeightAt([lifted], PIN)?.heightM).toBeCloseTo(5 + 395 * 1.1, 6);
    const abs = { ...m, anchor: { ...m.anchor, altRef: AltitudeRef.Absolute, altM: 10 } };
    expect(modelHeightAt([abs], PIN)?.heightM).toBeCloseTo(10 - 3 + 395, 6);
  });

  it('falls through in the hull between two parts', () => {
    const ell = seedModel(batchOf([{ ring: rect(0, 0, 100, 10), heightM: 50 }, { ring: rect(45, 50, 10, 90), heightM: 200 }]), 'L')!;
    expect(modelOutlines(ell)).toHaveLength(2);
    const gap = at(-20, 20);
    expect(inLngLatRing(ell.footprint, gap)).toBe(true);
    expect(modelHeightAt([ell], gap)).toBeNull();
    expect(modelHeightAt([ell], at(0, 0))?.heightM).toBe(200);
  });

  it('falls through outside the footprint or for a hidden model', () => {
    expect(modelHeightAt([m], localToLngLat(m.anchor, 100, 0))).toBeNull();
    expect(modelHeightAt([{ ...m, visible: false }], PIN)).toBeNull();
  });
});
