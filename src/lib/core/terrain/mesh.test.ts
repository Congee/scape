import { describe, expect, it } from 'vitest';
import { bearingDeg, curvatureDropM, distanceM } from '@core/geo/geodesy';
import { buildPrisms } from '@core/geo/prismRaster';
import type { BuildingBatch } from '@workers/buildings.protocol';
import { RoofShape } from '@workers/buildings.protocol';
import { lngLatToTilePixel, metersPerPixel, tilesInBounds } from '@core/terrain/tiles';
import {
  BLOCKS_PER_SIDE,
  BLOCK_CELLS,
  blockSideM,
  blockUnitBounds,
  buildLevel,
  COARSE_TARGET_RAD,
  levelCellM,
  levelHalfExtentM,
  levelsForRange,
  MAX_LEVELS,
  MAX_MESH_TRIANGLES,
  MESH_MIN_CELL_M,
  MESH_PX_PER_CELL,
  samplePoint,
  selectBlocks,
  TRIANGLES_PER_BLOCK,
  type BlockId,
  type MeshView
} from './mesh';

const PIN = { lat: 46.0207, lng: 7.7491 };
const D2R = Math.PI / 180;
const FLAT = () => 1200;
const RANGE = 100_000;
/** Terrarium z15 at this latitude: about 3.3 m between posts. */
const DEM = metersPerPixel(PIN.lat, 15);
const ROOT = levelsForRange(RANGE) - 1;
const PX_H = 1013;

const view = (focalMm: number, frameWmm = 36, frameHmm = 24): MeshView => ({
  azimuthDeg: 37,
  hfovDeg: (2 * Math.atan(frameWmm / 2 / focalMm) * 180) / Math.PI,
  targetRad: (MESH_PX_PER_CELL * frameHmm) / (focalMm * PX_H)
});

const allBlocks = (s: { levels: { level: number; blocks: BlockId[] }[] }) => s.levels.flatMap((l) => l.blocks);
/** Distance from the eye to the nearest point of a block, metres. */
function nearest(b: BlockId): number {
  const s = blockSideM(b.level);
  const e0 = b.ix * s;
  const n0 = b.iy * s;
  return Math.hypot(Math.max(e0, -(e0 + s), 0), Math.max(n0, -(n0 + s), 0));
}
const centreBearingDeg = (b: BlockId): number => {
  const s = blockSideM(b.level);
  return (Math.atan2(b.ix * s + s / 2, b.iy * s + s / 2) * 180) / Math.PI;
};
const angleTo = (deg: number, to: number) => Math.abs(((deg - to + 540) % 360) - 180);

describe('quadtree layout', () => {
  it('doubles cell and extent per level and reaches 49 km', () => {
    expect(levelCellM(0)).toBe(2);
    expect(levelCellM(4)).toBe(32);
    expect(levelHalfExtentM(0)).toBe(192);
    expect(levelHalfExtentM(MAX_LEVELS - 1)).toBeGreaterThan(49_000);
  });

  it('picks the fewest levels that reach the range', () => {
    expect(levelsForRange(100)).toBe(1);
    expect(levelHalfExtentM(levelsForRange(20_000) - 1)).toBeGreaterThanOrEqual(20_000);
    expect(levelHalfExtentM(levelsForRange(20_000) - 2)).toBeLessThan(20_000);
    expect(levelsForRange(1e9)).toBe(MAX_LEVELS);
  });

  it('nests: a block is two of the level below it across, and the roots span the level extent', () => {
    expect(blockSideM(3)).toBe(2 * blockSideM(2));
    expect((BLOCKS_PER_SIDE / 2) * blockSideM(5)).toBe(levelHalfExtentM(5));
  });
});

describe('selectBlocks', () => {
  it('reproduces the old fixed clipmap when nothing looks at it', () => {
    const sel = selectBlocks({ rangeM: RANGE, demCellM: 0, view: null });
    expect(sel.levels.map((l) => l.level)).toEqual([...Array(MAX_LEVELS).keys()]);
    // A full 4x4 grid at the finest level, then a ring of 12 around each coarser one.
    expect(sel.levels[0].blocks).toHaveLength(BLOCKS_PER_SIDE ** 2);
    for (const l of sel.levels.slice(1)) expect(l.blocks).toHaveLength(BLOCKS_PER_SIDE ** 2 - 4);
    for (const b of sel.levels[0].blocks) {
      expect(b.ix).toBeGreaterThanOrEqual(-BLOCKS_PER_SIDE / 2);
      expect(b.ix).toBeLessThan(BLOCKS_PER_SIDE / 2);
    }
  });

  it('never goes finer than the DEM posts; interpolating below them adds no information', () => {
    const sel = selectBlocks({ rangeM: RANGE, demCellM: DEM, view: null });
    expect(levelCellM(sel.levels[0].level)).toBeGreaterThanOrEqual(DEM);
    expect(sel.levels[0].blocks).toHaveLength(BLOCKS_PER_SIDE ** 2);
  });

  it('keeps its resolution ladder when the DEM posts get finer', () => {
    // Mapterhorn's 512 px z17 posts are sub-metre; unfloored they halve the cell and the budget
    // pays for it out of reach, which is where a long-focal subject lives.
    const finer = Math.max(MESH_MIN_CELL_M, metersPerPixel(PIN.lat, 17, 512));
    for (const rangeM of [20_000, RANGE])
      for (const focalMm of [70, 600, 2400]) {
        const before = selectBlocks({ rangeM, demCellM: DEM, view: view(focalMm) });
        const after = selectBlocks({ rangeM, demCellM: finer, view: view(focalMm) });
        expect(levelCellM(after.levels[0].level)).toBe(levelCellM(before.levels[0].level));
        expect(after.reachM).toBeCloseTo(before.reachM, 3);
        expect(after.targetRad).toBe(before.targetRad);
      }
    // The pre-change values a 600 mm frame at Zermatt gets today.
    const sel = selectBlocks({ rangeM: 20_000, demCellM: finer, view: view(600) });
    expect(levelCellM(sel.levels[0].level)).toBe(4);
    expect(sel.reachM).toBeCloseTo(10_000, 0);
  });

  it('takes the cap from the DEM, not from the level floor, when the posts are coarse', () => {
    // A 30 m DEM: the cap has room to bite before BASE_CELL_M does.
    const sel = selectBlocks({ rangeM: RANGE, demCellM: 30, view: null });
    expect(levelCellM(sel.levels[0].level)).toBe(32);
  });

  it('the leaves tile the root square exactly', () => {
    for (const v of [null, view(24), view(600)]) {
      const sel = selectBlocks({ rangeM: RANGE, demCellM: DEM, view: v });
      const area = allBlocks(sel).reduce((a, b) => a + blockSideM(b.level) ** 2, 0);
      expect(area).toBeCloseTo((BLOCKS_PER_SIDE * blockSideM(ROOT)) ** 2, -3);
    }
  });

  it('no two leaves that share an edge differ by more than one level', () => {
    const sel = selectBlocks({ rangeM: RANGE, demCellM: DEM, view: view(600) });
    const at = new Map(allBlocks(sel).map((b) => [`${b.level}/${b.ix}/${b.iy}`, b]));
    for (const b of at.values())
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ]) {
        const nx = b.ix + dx;
        const ny = b.iy + dy;
        const h = (BLOCKS_PER_SIDE / 2) * 2 ** (ROOT - b.level);
        if (nx < -h || nx >= h || ny < -h || ny >= h) continue;
        let found = -1;
        for (let m = b.level; m <= ROOT && found < 0; m++) {
          const s = 2 ** (m - b.level);
          if (at.has(`${m}/${Math.floor(nx / s)}/${Math.floor(ny / s)}`)) found = m;
        }
        expect(found - b.level).toBeLessThanOrEqual(1);
      }
  });

  it('holds the screen-space cell size inside the frame, at every focal length', () => {
    for (const focalMm of [24, 135, 600, 1200, 2400]) {
      const v = view(focalMm);
      const sel = selectBlocks({ rangeM: RANGE, demCellM: DEM, view: v });
      expect(sel.targetRad).toBeCloseTo(v.targetRad, 12);
      for (const b of allBlocks(sel)) {
        const d = nearest(b);
        if (d === 0 || d > sel.reachM || angleTo(centreBearingDeg(b), v.azimuthDeg) > v.hfovDeg / 2) continue;
        // Either the cell is inside the target angle, or it is already as fine as the DEM gets.
        expect(levelCellM(b.level)).toBeLessThanOrEqual(Math.max(v.targetRad * d, 2 * DEM) + 1e-9);
      }
    }
  });

  it('leaves the ground the frame does not look at as coarse as it was', () => {
    const v = view(600);
    const sel = selectBlocks({ rangeM: RANGE, demCellM: DEM, view: v });
    const behind = allBlocks(sel).filter((b) => angleTo(centreBearingDeg(b), v.azimuthDeg + 180) < 30);
    expect(behind.length).toBeGreaterThan(0);
    for (const b of behind) expect(levelCellM(b.level)).toBeGreaterThan((COARSE_TARGET_RAD * nearest(b)) / 2);
  });

  it('is the fix: a 600 mm frame used to carry a cell a quarter of its own height', () => {
    const v = view(600);
    const vfovRad = 2 * Math.atan(12 / 600);
    // The largest cell any sightline in the frame crosses, in frame heights, over the 4-9 km
    // band the defect was photographed in.
    const worst = (s: ReturnType<typeof selectBlocks>) => {
      const at = new Map(allBlocks(s).map((b) => [`${b.level}/${b.ix}/${b.iy}`, b.level]));
      let max = 0;
      for (let t = -1; t <= 1; t += 0.25)
        for (let d = 4000; d <= 9000; d += 250) {
          const az = (v.azimuthDeg + (t * v.hfovDeg) / 2) * D2R;
          const e = d * Math.sin(az);
          const n = d * Math.cos(az);
          for (let l = 0; l < MAX_LEVELS; l++) {
            const side = blockSideM(l);
            if (!at.has(`${l}/${Math.floor(e / side)}/${Math.floor(n / side)}`)) continue;
            max = Math.max(max, levelCellM(l) / d / vfovRad);
            break;
          }
        }
      return max;
    };
    expect(worst(selectBlocks({ rangeM: RANGE, demCellM: DEM, view: null }))).toBeGreaterThan(0.2);
    // What is left is the DEM floor at 4 km, not the target: 4 m posts over a 0.04 rad frame.
    expect(worst(selectBlocks({ rangeM: RANGE, demCellM: DEM, view: v }))).toBeLessThan(0.03);
  });

  it('spends a tight budget by pulling the reach in, not by giving up the target', () => {
    const v = view(600);
    const wide = selectBlocks({ rangeM: RANGE, demCellM: DEM, view: v });
    const tight = selectBlocks({ rangeM: RANGE, demCellM: DEM, view: v, maxTriangles: 1_600_000 });
    expect(tight.triangles).toBeLessThanOrEqual(1_600_000);
    expect(tight.reachM).toBeLessThan(wide.reachM);
    expect(tight.targetRad).toBe(v.targetRad);
    expect(wide.triangles).toBe(wide.blocks * TRIANGLES_PER_BLOCK);
  });

  it('coarsens the target only once the reach has bottomed out', () => {
    const sel = selectBlocks({ rangeM: RANGE, demCellM: DEM, view: view(24), maxTriangles: 400_000 });
    expect(sel.targetRad).toBeGreaterThan(view(24).targetRad);
    expect(sel.targetRad).toBeLessThanOrEqual(COARSE_TARGET_RAD);
  });
});

describe('buildLevel', () => {
  const blocks: BlockId[] = [
    { level: 2, ix: -2, iy: -2 },
    { level: 2, ix: 5, iy: 3 }
  ];
  const lv = buildLevel(PIN, 1250, 2, blocks, FLAT);

  it('emits one closed buffer per level with every index in range', () => {
    const verts = lv.pos.length / 3;
    expect(lv.nrm.length).toBe(lv.pos.length);
    expect(lv.blocks).toBe(blocks.length);
    expect(lv.blockStart).toHaveLength(lv.blocks + 1);
    expect(lv.blockStart[lv.blocks]).toBe(lv.idx.length);
    expect(lv.idx.length).toBe(blocks.length * TRIANGLES_PER_BLOCK * 3);
    for (let b = 0; b < lv.blocks; b++) expect(lv.blockStart[b + 1]).toBeGreaterThan(lv.blockStart[b]);
    let max = 0;
    for (const i of lv.idx) max = Math.max(max, i);
    expect(max).toBe(verts - 1);
    expect(lv.idx.length % 3).toBe(0);
  });

  it('puts each block where its index says, one block side apart', () => {
    const s = blockSideM(2);
    for (const [b, id] of blocks.entries()) {
      const [e0, n0, , e1, n1] = lv.blockBox.slice(b * 6, b * 6 + 6);
      expect(e0).toBeCloseTo(id.ix * s, 6);
      expect(n0).toBeCloseTo(id.iy * s, 6);
      expect(e1 - e0).toBeCloseTo(s, 6);
      expect(n1 - n0).toBeCloseTo(s, 6);
    }
  });

  it('takes the eye and the curvature drop off every vertex', () => {
    for (let v = 0; v < lv.pos.length / 3; v += 37) {
      const e = lv.pos[v * 3];
      const n = lv.pos[v * 3 + 1];
      const u = lv.pos[v * 3 + 2];
      const want = 1200 - 1250 - curvatureDropM(Math.hypot(e, n));
      // Skirt vertices hang below their rim; everything else sits on the surface.
      expect(u).toBeLessThan(want + 0.01);
      expect(u).toBeGreaterThan(want - 6 * levelCellM(2) - 9);
    }
  });

  it('tilts a flat field only by the earth curving away under it', () => {
    for (let v = 0; v < lv.nrm.length / 3; v += 53) {
      const d = Math.hypot(lv.pos[v * 3], lv.pos[v * 3 + 1]);
      // The normal leans back by exactly the slope of the drop the vertex was given.
      const slope = (curvatureDropM(d + 1) - curvatureDropM(d - 1)) / 2;
      expect(Math.hypot(lv.nrm[v * 3], lv.nrm[v * 3 + 1])).toBeCloseTo(slope, 4);
      expect(lv.nrm[v * 3 + 2]).toBeGreaterThan(0.999);
    }
  });

  it('boxes each block around its own vertices', () => {
    for (let b = 0; b < lv.blocks; b++) {
      const [e0, n0, u0, e1, n1, u1] = lv.blockBox.slice(b * 6, b * 6 + 6);
      expect(e1).toBeGreaterThan(e0);
      expect(n1).toBeGreaterThan(n0);
      expect(u1).toBeGreaterThanOrEqual(u0);
    }
  });

  it('counts the samples it could not read', () => {
    const holed = buildLevel(PIN, 0, 0, [{ level: 0, ix: 0, iy: 0 }], () => Number.NaN);
    expect(holed.missing).toBeGreaterThan(0);
    for (let v = 0; v < 30; v++) expect(Number.isFinite(holed.pos[v * 3 + 2])).toBe(true);
  });
});

/** One square footprint centred on a point, as the buildings worker would emit it. */
function squareBatch(centre: { lng: number; lat: number }, groundM: number, heightM: number): BuildingBatch {
  const d = 1e-4;
  const lng = new Float64Array([centre.lng - d, centre.lng + d, centre.lng + d, centre.lng - d]);
  const lat = new Float64Array([centre.lat - d, centre.lat - d, centre.lat + d, centre.lat + d]);
  return {
    tileKey: '14/0/0',
    count: 1,
    ringStart: new Int32Array([0, 4]),
    lng,
    lat,
    heightM: new Float32Array([heightM]),
    minHeightM: new Float32Array([0]),
    roofShape: new Uint8Array([RoofShape.Flat]),
    roofHeightM: new Float32Array([0]),
    roofDirDeg: new Float32Array([Number.NaN]),
    roofAcross: new Uint8Array([0]),
    cLng: new Float64Array([centre.lng]),
    cLat: new Float64Array([centre.lat]),
    groundM: new Float32Array([groundM])
  };
}

describe('registration against the prisms', () => {
  it('samplePoint inverts the map buildPrisms applies', () => {
    for (const d of [1000, 10_000, 40_000]) {
      for (const b of [0, 37, 143, 271]) {
        const e = d * Math.sin(b * D2R);
        const n = d * Math.cos(b * D2R);
        const p = samplePoint(PIN, e, n);
        const back = distanceM(PIN, p);
        const az = bearingDeg(PIN, p) * D2R;
        expect(back * Math.sin(az)).toBeCloseTo(e, 3);
        expect(back * Math.cos(az)).toBeCloseTo(n, 3);
      }
    }
  });

  it('a building base sits on the terrain height at 1, 10 and 40 km', () => {
    const eyeM = 1600;
    const ground = 900;
    for (const d of [1000, 10_000, 40_000]) {
      const centre = samplePoint(PIN, d * Math.SQRT1_2, d * Math.SQRT1_2);
      const tile = buildPrisms(squareBatch(centre, ground, 20), PIN, eyeM);
      // Terrain at the same point, by the rule buildLevel applies per vertex.
      const e = tile.e[0];
      const n = tile.n[0];
      const terrainU = Math.max(ground, 0) - eyeM - curvatureDropM(Math.hypot(e, n));
      expect(tile.uBase[0]).toBeCloseTo(terrainU, 2);
    }
  });
});

describe('blockUnitBounds', () => {
  it('is unit Web-Mercator, not tile units, so tilesInBounds can scale it', () => {
    const b = blockUnitBounds(PIN, { level: 8, ix: 1, iy: -2 });
    expect(b.x0).toBeGreaterThan(0);
    expect(b.x1).toBeLessThan(1);
    expect(b.y0).toBeGreaterThan(0);
    expect(b.y1).toBeLessThan(1);
    expect(b.x1).toBeGreaterThan(b.x0);
    expect(b.y1).toBeGreaterThan(b.y0);
  });

  it('brackets the block it was asked for, halo and all', () => {
    for (const id of [
      { level: 1, ix: 40, iy: -17 },
      { level: 5, ix: 0, iy: 0 },
      { level: 8, ix: -2, iy: 1 }
    ]) {
      const b = blockUnitBounds(PIN, id);
      const s = blockSideM(id.level);
      for (const [e, n] of [
        [id.ix * s, id.iy * s],
        [(id.ix + 1) * s, id.iy * s],
        [id.ix * s, (id.iy + 1) * s],
        [(id.ix + 1) * s, (id.iy + 1) * s],
        [(id.ix + 0.5) * s, (id.iy + 0.5) * s]
      ]) {
        const p = samplePoint(PIN, e, n);
        const t = lngLatToTilePixel(p.lng, p.lat, 0, 1);
        expect(t.px).toBeGreaterThanOrEqual(b.x0);
        expect(t.px).toBeLessThanOrEqual(b.x1);
        expect(t.py).toBeGreaterThanOrEqual(b.y0);
        expect(t.py).toBeLessThanOrEqual(b.y1);
      }
    }
  });

  it('widens by the halo it is given, so a cubic stencil never reads past the tiles fetched', () => {
    const id = { level: 1, ix: 3, iy: -2 };
    const haloM = levelCellM(id.level) + 2 * DEM;
    const b = blockUnitBounds(PIN, id, haloM);
    const s = blockSideM(id.level);
    for (const [e, n] of [
      [id.ix * s - haloM, id.iy * s - haloM],
      [(id.ix + 1) * s + haloM, (id.iy + 1) * s + haloM]
    ]) {
      const p = samplePoint(PIN, e, n);
      const t = lngLatToTilePixel(p.lng, p.lat, 0, 1);
      expect(t.px).toBeGreaterThanOrEqual(b.x0);
      expect(t.px).toBeLessThanOrEqual(b.x1);
      expect(t.py).toBeGreaterThanOrEqual(b.y0);
      expect(t.py).toBeLessThanOrEqual(b.y1);
    }
    // One cell of halo, the default, would stop two DEM posts short of the stencil.
    const tight = blockUnitBounds(PIN, id);
    expect(tight.x1 - tight.x0).toBeLessThan(b.x1 - b.x0);
  });

  it('keeps one block to a handful of tiles at the zoom its cell asks for', () => {
    for (let l = 0; l < MAX_LEVELS; l++) {
      const z = Math.max(8, Math.min(15, 15 - l));
      expect(tilesInBounds(blockUnitBounds(PIN, { level: l, ix: 7, iy: -13 }), z).length).toBeLessThanOrEqual(9);
    }
  });

  it('a whole level is bounded by its blocks, never by its square', () => {
    // The trap this replaces: level 1 leaves 10 km out, enumerated as a level square at z15.
    const sel = selectBlocks({ rangeM: RANGE, demCellM: DEM, view: view(600) });
    const fine = sel.levels[0];
    const tiles = new Set<string>();
    for (const b of fine.blocks) for (const t of tilesInBounds(blockUnitBounds(PIN, b), 15)) tiles.add(`${t.x}/${t.y}`);
    expect(tiles.size).toBeLessThan(80);
  });
});

describe('block count against the old clipmap', () => {
  it('costs more triangles than the fixed clipmap but stays inside the budget', () => {
    const old = (BLOCKS_PER_SIDE ** 2 + (MAX_LEVELS - 1) * (BLOCKS_PER_SIDE ** 2 - 4)) * TRIANGLES_PER_BLOCK;
    expect(old).toBe(112 * (BLOCK_CELLS * BLOCK_CELLS * 2 + 8 * BLOCK_CELLS));
    for (const focalMm of [24, 135, 600, 2400]) {
      const sel = selectBlocks({ rangeM: RANGE, demCellM: DEM, view: view(focalMm) });
      expect(sel.triangles).toBeGreaterThan(old);
      expect(sel.triangles).toBeLessThanOrEqual(MAX_MESH_TRIANGLES);
    }
  });
});
