import { describe, expect, it } from 'vitest';
import { bearingDeg, curvatureDropM, distanceM } from '@core/geo/geodesy';
import { buildPrisms } from '@core/geo/prismRaster';
import { frameElevationSpanDeg } from '@core/optics/fov';
import type { BuildingBatch } from '@workers/buildings.protocol';
import { RoofShape } from '@workers/buildings.protocol';
import { lngLatToTilePixel, metersPerPixel, tilesInBounds } from '@core/terrain/tiles';
import {
  BASE_CELL_M,
  BLOCKS_PER_SIDE,
  BLOCK_CELLS,
  blockSideM,
  CASTER_CELL_M,
  blockUnitBounds,
  buildBlock,
  buildLevel,
  COARSE_TARGET_RAD,
  joinBlocks,
  levelCellM,
  levelHalfExtentM,
  levelsForRange,
  MAX_LEVEL_STEP,
  MAX_LEVELS,
  MAX_MESH_TRIANGLES,
  MESH_PX_PER_CELL,
  MESH_START_CELL_M,
  samplePoint,
  seamSkirtM,
  selectBlocks,
  skirtDepth,
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
const CASTER_LEVEL = Math.log2(CASTER_CELL_M / BASE_CELL_M);

const view = (focalMm: number, frameWmm = 36, frameHmm = 24, pitchDeg = 0): MeshView => {
  const span = frameElevationSpanDeg(pitchDeg, frameWmm, frameHmm, focalMm);
  return {
    azimuthDeg: 37,
    hfovDeg: (2 * Math.atan(frameWmm / 2 / focalMm) * 180) / Math.PI,
    vfovDeg: (2 * Math.atan(frameHmm / 2 / focalMm) * 180) / Math.PI,
    pitchDeg,
    elHalfDeg: Math.max(span.maxDeg - pitchDeg, pitchDeg - span.minDeg),
    targetRad: (MESH_PX_PER_CELL * frameHmm) / (focalMm * PX_H)
  };
};

/** A flat plain, so the whole mesh sits on one plane a known angle from the eye. */
const plain = (heightM: number) => () => ({ minM: heightM, maxM: heightM });

const band800to1200 = () => ({ minM: 800, maxM: 1200 });

/** No bound at all: every elevation is possible. */
const loose = () => ({ minM: -Infinity, maxM: Infinity });

const allBlocks = (s: { levels: { level: number; blocks: BlockId[] }[] }) => s.levels.flatMap((l) => l.blocks);
/** Distance from the eye to the nearest point of a block, metres. */
function nearest(b: BlockId): number {
  const s = blockSideM(b.level);
  const e0 = b.ix * s;
  const n0 = b.iy * s;
  return Math.hypot(Math.max(e0, -(e0 + s), 0), Math.max(n0, -(n0 + s), 0));
}
const key = (b: BlockId) => `${b.level}/${b.ix}/${b.iy}`;
const skirtOf = (s: ReturnType<typeof selectBlocks>) => new Map(s.levels.flatMap((l) => l.blocks.map((b, i) => [key(b), l.skirtM[i]] as const)));
/** Each leaf with the leaf across each of its edges, where that one is at least as coarse. */
function* edgePairs(s: ReturnType<typeof selectBlocks>, root: number): Generator<[BlockId, BlockId]> {
  const at = new Map(allBlocks(s).map((b) => [key(b), b]));
  for (const b of at.values())
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ]) {
      const h = (BLOCKS_PER_SIDE / 2) * 2 ** (root - b.level);
      const nx = b.ix + dx;
      const ny = b.iy + dy;
      if (nx < -h || nx >= h || ny < -h || ny >= h) continue;
      for (let m = b.level; m <= root; m++) {
        const t = 2 ** (m - b.level);
        const n = at.get(`${m}/${Math.floor(nx / t)}/${Math.floor(ny / t)}`);
        if (n) {
          yield [b, n];
          break;
        }
      }
    }
}
const centreBearingDeg = (b: BlockId): number => {
  const s = blockSideM(b.level);
  return (Math.atan2(b.ix * s + s / 2, b.iy * s + s / 2) * 180) / Math.PI;
};
const angleTo = (deg: number, to: number) => Math.abs(((deg - to + 540) % 360) - 180);

describe('quadtree layout', () => {
  it('doubles cell and extent per level and reaches 49 km', () => {
    expect(levelCellM(0)).toBe(BASE_CELL_M);
    expect(levelCellM(4)).toBe(16 * BASE_CELL_M);
    expect(levelHalfExtentM(0)).toBe(96 * BASE_CELL_M);
    expect(levelHalfExtentM(MAX_LEVELS - 1)).toBeGreaterThan(49_000);
  });

  it('picks the fewest levels that reach the range', () => {
    expect(levelHalfExtentM(levelsForRange(100) - 1)).toBeGreaterThanOrEqual(100);
    expect(levelHalfExtentM(levelsForRange(100) - 2)).toBeLessThan(100);
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
  it('reproduces the old fixed clipmap, at the caster cell, when nothing looks at it', () => {
    const sel = selectBlocks({ rangeM: RANGE, demCellM: 0, view: null });
    expect(sel.levels.map((l) => l.level)).toEqual([...Array(MAX_LEVELS).keys()].slice(CASTER_LEVEL));
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

  it('spends only what the reach ladder left over when the DEM posts get finer', () => {
    // Mapterhorn's 512 px z17 posts are sub-metre; a finer DEM may buy a finer cell, never at the
    // cost of reach or of in-frame resolution.
    const finer = metersPerPixel(PIN.lat, 17, 512);
    for (const rangeM of [20_000, RANGE])
      for (const focalMm of [70, 600, 2400]) {
        const before = selectBlocks({ rangeM, demCellM: DEM, view: view(focalMm) });
        const after = selectBlocks({ rangeM, demCellM: finer, view: view(focalMm) });
        const at = `${rangeM} m, ${focalMm} mm`;
        expect(after.reachM, at).toBeGreaterThanOrEqual(before.reachM);
        expect(after.targetRad, at).toBeLessThanOrEqual(before.targetRad);
        expect(levelCellM(after.levels[0].level), at).toBeLessThanOrEqual(levelCellM(before.levels[0].level));
      }
  });

  it('leaves the start cell alone when the budget has nothing to spare', () => {
    const finer = metersPerPixel(PIN.lat, 17, 512);
    const start = selectBlocks({ rangeM: RANGE, demCellM: MESH_START_CELL_M, view: view(2400) });
    const sel = selectBlocks({ rangeM: RANGE, demCellM: finer, view: view(2400), maxTriangles: start.triangles });
    expect(sel.minCellM).toBe(MESH_START_CELL_M);
  });

  it('stops at the caster cell when nothing pays for a finer frame, however generous the budget', () => {
    const finer = metersPerPixel(PIN.lat, 17, 512);
    for (const focalMm of [24, 600, 2400]) {
      const sel = selectBlocks({ rangeM: RANGE, demCellM: finer, view: view(focalMm), maxTriangles: 1e9 });
      expect(sel.minCellM, `${focalMm} mm`).toBe(CASTER_CELL_M);
    }
  });

  it('descends to the DEM posts where a tight bound pays for it, and never past what it saved', () => {
    const finer = metersPerPixel(PIN.lat, 17, 512);
    const v = view(600, 36, 24, -20);
    const sel = selectBlocks({ rangeM: RANGE, demCellM: finer, view: v, heightBoundM: loose, detailBoundM: plain(1000), eyeM: 1600 });
    expect(sel.minCellM).toBe(BASE_CELL_M);
    expect(sel.minCellM).toBeGreaterThanOrEqual(finer);
    expect(sel.blocks).toBeLessThanOrEqual(sel.fineCap);
    // The cap is what the loose bound alone costs at the caster cell.
    const plainSel = selectBlocks({ rangeM: RANGE, demCellM: CASTER_CELL_M, view: v, heightBoundM: loose, eyeM: 1600 });
    expect(sel.fineCap).toBeGreaterThanOrEqual(plainSel.blocks);
  });

  it('asks for the detail tiles only where some bound inside the coarse one could pay for them', () => {
    const finer = metersPerPixel(PIN.lat, 17, 512);
    let asked = 0;
    for (const focalMm of [24, 70, 200, 600, 1200, 2400])
      for (const pitchDeg of [-20, -5, 0]) {
        const opts = { rangeM: RANGE, demCellM: finer, view: view(focalMm, 36, 24, pitchDeg), heightBoundM: band800to1200, eyeM: 1600 };
        const base = selectBlocks(opts);
        if (base.detailMayPay) asked++;
        else
          for (const h of [800, 1000, 1200])
            expect(selectBlocks({ ...opts, detailBoundM: plain(h) }).minCellM, `${focalMm} mm, ${pitchDeg}°, ${h} m`).toBe(base.minCellM);
      }
    expect(asked).toBeGreaterThan(0);
    const v = view(600, 36, 24, -20);
    expect(selectBlocks({ rangeM: RANGE, demCellM: finer, view: v, heightBoundM: loose, eyeM: 1600 }).detailMayPay).toBe(true);
    expect(selectBlocks({ rangeM: RANGE, demCellM: finer, view: v, heightBoundM: loose, detailBoundM: plain(1000), eyeM: 1600 }).detailMayPay).toBe(false);
  });

  it('a detail bound that is null everywhere changes nothing', () => {
    const finer = metersPerPixel(PIN.lat, 17, 512);
    for (const focalMm of [24, 600, 2400]) {
      const opts = { rangeM: RANGE, demCellM: finer, view: view(focalMm, 36, 24, -5), heightBoundM: plain(1000), eyeM: 1600 };
      const a = selectBlocks(opts);
      const b = selectBlocks({ ...opts, detailBoundM: () => null });
      expect(allBlocks(b)).toEqual(allBlocks(a));
    }
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

  it('balances the frame: no two leaves inside it that share an edge differ by more than the step', () => {
    for (const focalMm of [24, 600, 2400]) {
      const v = view(focalMm);
      const sel = selectBlocks({ rangeM: RANGE, demCellM: DEM, view: v });
      const inFrame = (b: BlockId) => angleTo(centreBearingDeg(b), v.azimuthDeg) <= v.hfovDeg / 2;
      let seen = 0;
      for (const [b, n] of edgePairs(sel, ROOT))
        if (inFrame(b) && inFrame(n)) {
          seen++;
          expect(Math.abs(n.level - b.level), `${focalMm} mm`).toBeLessThanOrEqual(MAX_LEVEL_STEP);
        }
      expect(seen).toBeGreaterThan(0);
    }
  });

  it('kills the gradation ring outside the frame, and hangs a skirt deep enough over every seam instead', () => {
    const v = view(600);
    const sel = selectBlocks({ rangeM: RANGE, demCellM: DEM, view: v });
    const skirt = skirtOf(sel);
    let wide = 0;
    for (const [b, n] of edgePairs(sel, ROOT)) {
      if (n.level - b.level > MAX_LEVEL_STEP) wide++;
      if (n.level > b.level) expect(skirt.get(key(b))).toBeGreaterThanOrEqual(seamSkirtM(b.level, n.level));
    }
    // Without the ring some seams outside the frame skip more levels than the balance allows.
    expect(wide).toBeGreaterThan(0);
  });

  it('the leaves stay one partition of the root square, over a sweep of options', () => {
    // What the packed block key and the balance shortcut both lean on: one leaf covers each point,
    // so a same-level neighbour in the map rules out a coarser one, and no two blocks share a key.
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 60; i++) {
      const focalMm = [0, 14, 24, 50, 135, 400, 1200, 2400][Math.floor(rnd() * 8)];
      const rangeM = 500 + rnd() * 120_000;
      const sel = selectBlocks({
        rangeM,
        demCellM: [0, 0.4148, 3.3, 12, 30][Math.floor(rnd() * 5)],
        view: focalMm ? view(focalMm, 36, 24, (rnd() - 0.5) * 90) : null,
        maxTriangles: rnd() < 0.3 ? 100_000 + rnd() * 4_000_000 : undefined,
        ...(rnd() < 0.5 ? { heightBoundM: plain(1000 + rnd() * 1000), detailBoundM: rnd() < 0.5 ? plain(1500) : () => null, eyeM: 1600 } : {})
      });
      const root = levelsForRange(rangeM) - 1;
      const at = new Map(allBlocks(sel).map((b) => [`${b.level}/${b.ix}/${b.iy}`, b.level]));
      const skirt = skirtOf(sel);
      const where = `${Math.round(rangeM)} m, ${focalMm} mm`;
      expect(sel.blocks, where).toBeLessThanOrEqual(sel.fineCap);
      expect(at.size, where).toBe(sel.blocks);
      const area = allBlocks(sel).reduce((a, b) => a + blockSideM(b.level) ** 2, 0);
      expect(area / (BLOCKS_PER_SIDE * blockSideM(root)) ** 2, where).toBeCloseTo(1, 9);
      for (const b of allBlocks(sel))
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1]
        ]) {
          const nx = b.ix + dx;
          const ny = b.iy + dy;
          const h = (BLOCKS_PER_SIDE / 2) * 2 ** (root - b.level);
          if (nx < -h || nx >= h || ny < -h || ny >= h) continue;
          // Exactly one level carries the leaf over that cell, and it is within the step of this one.
          const covers = [];
          for (let m = b.level; m <= root; m++) {
            const t = 2 ** (m - b.level);
            if (at.has(`${m}/${Math.floor(nx / t)}/${Math.floor(ny / t)}`)) covers.push(m);
          }
          expect(covers.length, `${where} at ${b.level}/${b.ix}/${b.iy}`).toBeLessThanOrEqual(1);
          // A seam the balance let through is closed by the finer side's skirt.
          if (covers.length === 1) expect(skirt.get(key(b)), where).toBeGreaterThanOrEqual(seamSkirtM(b.level, covers[0]));
        }
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

/**
 * The exact worst case the skirt depth is derived for: a tooth of slope 6 peaking at the midpoint
 * of the coarsest neighbour's cell, which is where the fine rim departs furthest from the chord
 * the coarse block draws across the same span.
 */
/** Height of one block's grid vertex. */
const rimU = (lv: ReturnType<typeof buildLevel>, i: number, j: number) => lv.pos[(j * (BLOCK_CELLS + 1) + i) * 3 + 2];

const tooth = (sign: number, cellM: number) => (lng: number, lat: number) => {
  const b = bearingDeg(PIN, { lng, lat }) * D2R;
  const n = distanceM(PIN, { lng, lat }) * Math.cos(b);
  const q = ((n % cellM) + cellM) % cellM;
  return 1200 + sign * 6 * (cellM / 2 - Math.abs(q - cellM / 2));
};

describe('a seam to the coarsest neighbour the balance allows', () => {
  // Edge-adjacent across MAX_LEVEL_STEP levels: the fine block's east edge is the coarse one's west.
  // The first level whose skirt is set by the slope rather than by its floor.
  const fineLevel = CASTER_LEVEL;
  const coarseLevel = fineLevel + MAX_LEVEL_STEP;
  const ratio = 2 ** MAX_LEVEL_STEP;
  const fine: BlockId = { level: fineLevel, ix: ratio - 1, iy: 0 };
  const coarse: BlockId = { level: coarseLevel, ix: 1, iy: 0 };
  const cellC = levelCellM(coarseLevel);
  const cellF = levelCellM(fineLevel);

  for (const sign of [1, -1]) {
    it(`is closed by the skirts when the relief ${sign > 0 ? 'rises' : 'falls'} between the coarse posts`, () => {
      const sample = tooth(sign, cellC);
      const lf = buildLevel(PIN, 1200, fineLevel, [fine], sample);
      const lc = buildLevel(PIN, 1200, coarseLevel, [coarse], sample);
      let aboveM = 0;
      let belowM = 0;
      for (let t = 0; t <= BLOCK_CELLS; t++) {
        const q = (t * cellF) / cellC;
        const i0 = Math.floor(q);
        const chord = rimU(lc, 0, i0) + (rimU(lc, 0, i0 + 1) - rimU(lc, 0, i0)) * (q - i0);
        const gap = rimU(lf, BLOCK_CELLS, t) - chord;
        aboveM = Math.max(aboveM, gap);
        belowM = Math.max(belowM, -gap);
      }
      // The tooth is built to reach the derived bound, so a shallower fine skirt would crack here.
      expect(Math.max(aboveM, belowM)).toBeGreaterThan(skirtDepth(cellF) - 0.2);
      // A rim above its neighbour's chord is hidden by its own skirt, so each side pays for its own case.
      expect(aboveM).toBeLessThanOrEqual(skirtDepth(cellF) + 0.2);
      expect(belowM).toBeLessThanOrEqual(skirtDepth(cellC) + 0.2);
    });
  }
});

describe('a seam the ring no longer balances', () => {
  const fineLevel = CASTER_LEVEL;
  const coarseLevel = fineLevel + 2 * MAX_LEVEL_STEP;
  const ratio = 2 ** (coarseLevel - fineLevel);
  const fine: BlockId = { level: fineLevel, ix: ratio - 1, iy: 0 };
  const coarse: BlockId = { level: coarseLevel, ix: 1, iy: 0 };
  const cellC = levelCellM(coarseLevel);
  const cellF = levelCellM(fineLevel);

  for (const sign of [1, -1]) {
    it(`is closed by the deeper skirt when the relief ${sign > 0 ? 'rises' : 'falls'} between the coarse posts`, () => {
      const sample = tooth(sign, cellC);
      const drop = seamSkirtM(fineLevel, coarseLevel);
      const lf = buildLevel(PIN, 1200, fineLevel, [fine], sample, [drop]);
      const lc = buildLevel(PIN, 1200, coarseLevel, [coarse], sample);
      let gapM = 0;
      for (let t = 0; t <= BLOCK_CELLS; t++) {
        const q = (t * cellF) / cellC;
        const i0 = Math.floor(q);
        const chord = rimU(lc, 0, i0) + (rimU(lc, 0, i0 + 1) - rimU(lc, 0, i0)) * (q - i0);
        gapM = Math.max(gapM, Math.abs(rimU(lf, BLOCK_CELLS, t) - chord));
      }
      // The plain skirt would crack; the seam skirt covers the worst the coarse chord can sag.
      expect(gapM).toBeGreaterThan(skirtDepth(cellF) + 1);
      expect(gapM).toBeLessThanOrEqual(drop + 0.2);
      // And the skirt really hangs that far below the grid.
      const grid = (BLOCK_CELLS + 1) ** 2;
      let rimLow = Infinity;
      let low = Infinity;
      for (let v = 0; v < lf.pos.length / 3; v++) {
        low = Math.min(low, lf.pos[v * 3 + 2]);
        if (v < grid) rimLow = Math.min(rimLow, lf.pos[v * 3 + 2]);
      }
      expect(low).toBeCloseTo(rimLow - drop, 3);
    });
  }
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
      expect(u).toBeGreaterThan(want - skirtDepth(levelCellM(2)) - 1);
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

const ridge = (lng: number, lat: number) => 900 + 400 * Math.sin(lng * 300) * Math.cos(lat * 200);

describe('joinBlocks', () => {
  const blocks: BlockId[] = [
    { level: 3, ix: -1, iy: 0 },
    { level: 3, ix: 0, iy: 0 },
    { level: 3, ix: 2, iy: -3 }
  ];
  const skirt = [40, undefined, 12] as unknown as number[];

  it('matches a level built in one go, byte for byte, from blocks built apart', () => {
    const whole = buildLevel(PIN, 1250, 3, blocks, ridge, skirt);
    // Out of order, as the worker's cache hands them back.
    const parts = [2, 0, 1].map((i) => ({ i, part: buildBlock(PIN, 1250, 3, blocks[i], ridge, skirt[i]) })).toSorted((a, b) => a.i - b.i);
    const joined = joinBlocks(3, parts.map((p) => p.part));
    for (const k of ['pos', 'nrm', 'idx', 'blockStart', 'blockBox'] as const) expect(joined[k]).toEqual(whole[k]);
    expect(joined.missing).toBe(whole.missing);
    expect(joined.cellM).toBe(whole.cellM);
  });

  it('leaves the parts it copies untouched', () => {
    const part = buildBlock(PIN, 1250, 3, blocks[0], ridge);
    const before = part.pos.slice();
    joinBlocks(3, [part, part]).pos.fill(0);
    expect(part.pos).toEqual(before);
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
    const levels = levelsForRange(RANGE) - CASTER_LEVEL;
    const old = (BLOCKS_PER_SIDE ** 2 + (levels - 1) * (BLOCKS_PER_SIDE ** 2 - 4)) * TRIANGLES_PER_BLOCK;
    expect(old).toBe(selectBlocks({ rangeM: RANGE, demCellM: 0, view: null }).triangles);
    for (const focalMm of [24, 135, 600, 2400]) {
      const sel = selectBlocks({ rangeM: RANGE, demCellM: DEM, view: view(focalMm) });
      expect(sel.triangles).toBeGreaterThan(old);
      expect(sel.triangles).toBeLessThanOrEqual(MAX_MESH_TRIANGLES);
    }
  });
});

/** The azimuth-only selection at a 2 m base cell with every seam balanced, as it stood before the fine region. */
describe('azimuth-only selection against the balanced 2 m mesh', () => {
  const EXPECTED: [number, number, number, string, number, number, number, number][] = [
    [20000, 4, 0, '1:16 2:12 3:12 4:12 5:12 6:12 7:12', 88, 439296, 0.020833333333333332, 20000],
    [20000, 4, 24, '1:184 2:138 3:138 4:74 5:22 6:19 7:8', 583, 2910336, 0.003948667324777887, 12500],
    [20000, 4, 70, '1:468 2:43 3:32 4:18 5:15 6:10 7:12', 598, 2985216, 0.0013538287970667044, 5625],
    [20000, 4, 200, '1:428 2:49 3:37 4:21 5:18 6:9 7:12', 574, 2865408, 0.0004738400789733465, 8125],
    [20000, 4, 600, '1:400 2:52 3:50 4:22 5:21 6:12 7:11', 568, 2835456, 0.0001579466929911155, 12500],
    [20000, 4, 1200, '1:380 2:65 3:56 4:32 5:18 6:20 7:9', 580, 2895360, 0.00007897334649555775, 15000],
    [20000, 4, 2400, '1:368 2:72 3:67 4:29 5:22 6:19 7:9', 586, 2925312, 0.00003948667324777888, 17500],
    [20000, 30, 0, '4:16 5:12 6:12 7:12', 52, 259584, 0.020833333333333332, 20000],
    [20000, 30, 24, '4:184 5:50 6:12 7:7', 253, 1262976, 0.003948667324777887, 20000],
    [20000, 30, 70, '4:132 5:23 6:18 7:8', 181, 903552, 0.0013538287970667044, 20000],
    [20000, 30, 200, '4:88 5:22 6:17 7:9', 136, 678912, 0.0004738400789733465, 20000],
    [20000, 30, 600, '4:60 5:17 6:20 7:9', 106, 529152, 0.0001579466929911155, 20000],
    [20000, 30, 1200, '4:56 5:18 6:20 7:9', 103, 514176, 0.00007897334649555775, 20000],
    [20000, 30, 2400, '4:56 5:18 6:20 7:9', 103, 514176, 0.00003948667324777888, 20000],
    [100000, 4, 0, '1:16 2:12 3:12 4:12 5:12 6:12 7:12 8:12', 100, 499200, 0.020833333333333332, 100000],
    [100000, 4, 24, '1:184 2:138 3:138 4:74 5:22 6:19 7:8 8:12', 595, 2970240, 0.003948667324777887, 12500],
    [100000, 4, 70, '1:448 2:36 3:35 4:18 5:15 6:10 7:12 8:12', 586, 2925312, 0.0013538287970667044, 5468.75],
    [100000, 4, 200, '1:404 2:51 3:38 4:21 5:18 6:9 7:12 8:12', 565, 2820480, 0.0004738400789733465, 7812.5],
    [100000, 4, 600, '1:400 2:52 3:50 4:22 5:21 6:12 7:11 8:12', 580, 2895360, 0.0001579466929911155, 12500],
    [100000, 4, 1200, '1:352 2:60 3:51 4:30 5:19 6:16 7:10 8:12', 550, 2745600, 0.00007897334649555775, 14062.5],
    [100000, 4, 2400, '1:364 2:73 3:63 4:30 5:22 6:19 7:9 8:12', 592, 2955264, 0.00003948667324777888, 17187.5],
    [100000, 30, 0, '4:16 5:12 6:12 7:12 8:12', 64, 319488, 0.020833333333333332, 100000],
    [100000, 30, 24, '4:184 5:138 6:62 7:9 8:7', 400, 1996800, 0.003948667324777887, 100000],
    [100000, 30, 70, '4:500 5:39 6:31 7:14 8:8', 592, 2955264, 0.0013538287970667044, 46875],
    [100000, 30, 200, '4:380 5:41 6:26 7:13 8:9', 469, 2341248, 0.0004738400789733465, 100000],
    [100000, 30, 600, '4:192 5:32 6:28 7:16 8:9', 277, 1382784, 0.0001579466929911155, 100000],
    [100000, 30, 1200, '4:156 5:33 6:30 7:16 8:9', 244, 1218048, 0.00007897334649555775, 100000],
    [100000, 30, 2400, '4:140 5:37 6:30 7:16 8:9', 232, 1158144, 0.00003948667324777888, 100000]
  ];

  it('never regresses: no less reach, no coarser target or floor, no more blocks, at any focal length', () => {
    for (const [rangeM, demCellM, focalMm, levels, blocks, , targetRad, reachM] of EXPECTED) {
      const sel = selectBlocks({ rangeM, demCellM, view: focalMm ? view(focalMm) : null });
      const at = `${rangeM} m, ${demCellM} m posts, ${focalMm} mm`;
      // The table was taken at a 2 m base cell.
      const oldFloorM = 2 * 2 ** Number(levels.split(':')[0]);
      expect(sel.reachM, at).toBeGreaterThanOrEqual(reachM);
      expect(sel.targetRad, at).toBeLessThanOrEqual(targetRad);
      expect(sel.minCellM, at).toBeLessThanOrEqual(oldFloorM);
      // The ring's savings go to reach first; only a view that gained none must cost no more.
      if (sel.reachM === reachM) expect(sel.blocks, at).toBeLessThanOrEqual(blocks);
    }
  });
});


describe('the frame elevation band', () => {
  it('coarsens ground below the frame instead of dropping it, so the tiling still closes', () => {
    const v = view(600, 36, 24, 20);
    const opts = { rangeM: RANGE, demCellM: DEM, view: v, heightBoundM: plain(1000), eyeM: 1600 };
    const cut = selectBlocks(opts);
    const flat = selectBlocks({ rangeM: RANGE, demCellM: DEM, view: v });
    // Every block that was fine now sits under the frame, so the wedge collapses to the coarse mesh.
    expect(cut.blocks).toBeLessThan(flat.blocks / 2);
    const area = allBlocks(cut).reduce((a, b) => a + blockSideM(b.level) ** 2, 0);
    expect(area).toBeCloseTo((BLOCKS_PER_SIDE * blockSideM(ROOT)) ** 2, -3);
  });

  it('keeps the ground the frame does hold: a level frame over a plain at eye height is unchanged', () => {
    const v = view(600);
    const bound = selectBlocks({ rangeM: RANGE, demCellM: DEM, view: v, heightBoundM: plain(1600), eyeM: 1600 });
    const flat = selectBlocks({ rangeM: RANGE, demCellM: DEM, view: v });
    expect(bound.blocks).toBe(flat.blocks);
    expect(bound.reachM).toBe(flat.reachM);
  });

  it('never coarsens a block whose DEM coverage is missing', () => {
    const v = view(600, 36, 24, 20);
    const gone = selectBlocks({ rangeM: RANGE, demCellM: DEM, view: v, heightBoundM: () => ({ minM: -Infinity, maxM: Infinity }), eyeM: 1600 });
    const flat = selectBlocks({ rangeM: RANGE, demCellM: DEM, view: v });
    expect(gone.blocks).toBe(flat.blocks);
    expect(gone.reachM).toBe(flat.reachM);
  });

  /** Cell of the leaf the frame's centre ray lands on, where the ground is `dropM` below the eye. */
  const cellUnderAimM = (sel: ReturnType<typeof selectBlocks>, v: MeshView, dropM: number): number => {
    const d = dropM / Math.tan(-v.pitchDeg * D2R);
    const at = new Map(allBlocks(sel).map((b) => [`${b.level}/${b.ix}/${b.iy}`, b.level]));
    const e = d * Math.sin(v.azimuthDeg * D2R);
    const n = d * Math.cos(v.azimuthDeg * D2R);
    for (let l = 0; l < MAX_LEVELS; l++) {
      const side = blockSideM(l);
      if (at.has(`${l}/${Math.floor(e / side)}/${Math.floor(n / side)}`)) return levelCellM(l);
    }
    throw new Error('no leaf covers the aim point');
  };

  it('holds the near ground when the frame is pitched down into it', () => {
    // 600 m below the eye at 20° down is 1.6 km out; that ground is in the picture and stays fine.
    const v = view(600, 36, 24, -20);
    const sel = selectBlocks({ rangeM: RANGE, demCellM: DEM, view: v, heightBoundM: plain(1000), eyeM: 1600 });
    // The DEM floor, which is as fine as the mesh goes at all.
    expect(cellUnderAimM(sel, v, 600)).toBe(levelCellM(sel.levels[0].level));
  });

  it('a near-horizontal frame still reaches past the ground the horizon curves under', () => {
    const v = view(600, 36, 24, -0.5);
    const sel = selectBlocks({ rangeM: RANGE, demCellM: DEM, view: v, heightBoundM: plain(1600), eyeM: 1600 });
    // The aim meets a plain at eye height only through the curvature drop, 65 km out.
    expect(sel.reachM).toBeGreaterThan(4000);
    const far = allBlocks(sel).filter((b) => nearest(b) > 3000 && nearest(b) < sel.reachM && angleTo(centreBearingDeg(b), v.azimuthDeg) < v.hfovDeg / 4);
    expect(far.length).toBeGreaterThan(0);
    for (const b of far) expect(levelCellM(b.level)).toBeLessThanOrEqual(Math.max(v.targetRad * nearest(b), 2 * DEM) + 1e-9);
  });
  it('pitching down into a plain costs no reach: the splayed bearings are all near ground', () => {
    const opts = { rangeM: RANGE, demCellM: DEM, heightBoundM: plain(1000), eyeM: 1600 };
    const level = selectBlocks({ ...opts, view: view(24, 24, 36) });
    // Charging every block the rim's full width instead crushed this to a third of the reach.
    for (const pitchDeg of [-20, -40, -60]) {
      const down = selectBlocks({ ...opts, view: view(24, 24, 36, pitchDeg) });
      expect(down.reachM, `${pitchDeg}\u00b0`).toBeGreaterThanOrEqual(level.reachM);
    }
  });

  it('the near ground a pitched frame looks down at still gets the splay its rim reaches', () => {
    const opts = { rangeM: RANGE, demCellM: DEM, heightBoundM: plain(1000), eyeM: 1600 };
    const v = view(24, 24, 36, -40);
    // The band where the coarse target no longer refines on distance alone, so the wedge decides.
    const edge = (sel: ReturnType<typeof selectBlocks>) =>
      Math.max(...allBlocks(sel).filter((b) => levelCellM(b.level) === sel.minCellM && nearest(b) >= 300 && nearest(b) < 1000).map((b) => angleTo(centreBearingDeg(b), v.azimuthDeg)));
    const down = edge(selectBlocks({ ...opts, view: v }));
    expect(down).toBeGreaterThan(edge(selectBlocks({ ...opts, view: view(24, 24, 36) })) + 5);
    expect(down).toBeGreaterThan(v.hfovDeg);
  });
});
