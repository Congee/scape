import { describe, expect, it } from 'vitest';
import { at, batchOf, PIN, rect, square } from './batchFixture';
import { groupRowsAt, heightAtPoint, pickRows, suppressRing, suppressRows } from './buildingTiles';

const ll = (e: number, n: number): [number, number] => {
  const p = at(e, n);
  return [p.lng, p.lat];
};

// A tower over a podium, a crown part, and a neighbour across the street.
const rows = batchOf([
  { ring: rect(0, 0, 120, 80), heightM: 40, groundM: 5 },
  { ring: square(0, 0, 40), heightM: 300, groundM: 5 },
  { ring: square(0, 0, 40), heightM: 380, minHeightM: 300, groundM: 5 },
  { ring: square(200, 0, 30), heightM: 60, groundM: 7 }
]);
const tower = suppressRing([ll(-25, -25), ll(25, -25), ll(25, 25), ll(-25, 25)]);

describe('suppressRows', () => {
  it('drops the rows whose centroid is inside the footprint, podium centroid included', () => {
    const out = suppressRows(rows, [tower]);
    expect(out.count).toBe(1);
    expect(out.heightM[0]).toBe(60);
    expect(out.groundM[0]).toBe(7);
    expect(out.ringStart[1]).toBe(4);
    expect(out.lng[0]).toBe(rows.lng[12]);
  });

  it('keeps a podium whose centroid lies outside the model', () => {
    const offset = batchOf([{ ring: rect(70, 0, 100, 40), heightM: 40 }, { ring: square(0, 0, 40), heightM: 300 }]);
    const out = suppressRows(offset, [tower]);
    expect(out.count).toBe(1);
    expect(out.heightM[0]).toBe(40);
  });

  it('returns the batch itself when nothing is suppressed', () => {
    expect(suppressRows(rows, [])).toBe(rows);
    const far = suppressRing([ll(900, 900), ll(950, 900), ll(950, 950)]);
    expect(suppressRows(rows, [far])).toBe(rows);
  });
});

describe('groupRowsAt', () => {
  const grouped = { ...rows, group: Int32Array.from([0, 0, 0, 1]) };

  it('takes every row of the building under the point', () => {
    const hit = groupRowsAt(grouped, PIN)!;
    expect(hit.count).toBe(3);
    expect([...hit.heightM]).toEqual([40, 300, 380]);
    expect(hit.group).toEqual(Int32Array.from([0, 0, 0]));
    expect(heightAtPoint(hit, PIN)).toBe(380);
  });

  it('takes the whole group from a point on the podium only', () => {
    expect(groupRowsAt(grouped, at(50, 30))?.count).toBe(3);
  });

  it('is null off every footprint', () => {
    expect(groupRowsAt(grouped, at(100, 100))).toBeNull();
  });
});

describe('pickRows', () => {
  it('empties to a valid batch', () => {
    const none = pickRows(rows, () => false);
    expect(none.count).toBe(0);
    expect(none.ringStart).toEqual(Int32Array.from([0]));
    expect(none.lng.length).toBe(0);
  });
});
