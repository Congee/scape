/**
 * Terrain as a quadtree of heightfield blocks in the same eye-relative ENU frame the prisms use:
 * east, north, and up with `curvatureDropM` already taken off, so a building base meets the ground
 * it stands on at any range. Blocks nest exactly — a block at level l is a quarter of one at level
 * l + 1 — and `selectBlocks` picks each leaf's level from the angle its cell subtends at the eye,
 * so the cell size tracks the focal length instead of the distance alone.
 */

import { curvatureDropM, destination, type LngLat } from '@core/geo/geodesy';
import { lngLatToTilePixel } from '@core/terrain/tiles';

const R2D = 180 / Math.PI;
const D2R = Math.PI / 180;

/** Cells across one level, on each axis. */
export const LEVEL_CELLS = 192;
/** Blocks across one level; a level's 4x4 grid is exactly the children of the centre 2x2 above it. */
export const BLOCKS_PER_SIDE = 4;
export const BLOCK_CELLS = LEVEL_CELLS / BLOCKS_PER_SIDE;
/** Cell of the finest level, metres. */
export const BASE_CELL_M = 2;
/** Level 8 reaches 49 km, past any range the viewfinder offers. */
export const MAX_LEVELS = 9;

export const levelCellM = (level: number): number => BASE_CELL_M * 2 ** level;
export const levelHalfExtentM = (level: number): number => (LEVEL_CELLS * levelCellM(level)) / 2;
/** Side of one block, metres; a block at level l is two blocks of level l - 1 across. */
export const blockSideM = (level: number): number => BLOCK_CELLS * levelCellM(level);

/** Triangles one block carries: its cell grid plus the skirt ring. */
export const TRIANGLES_PER_BLOCK = BLOCK_CELLS * BLOCK_CELLS * 2 + 4 * BLOCK_CELLS * 2;

/** How many levels it takes to reach `rangeM`. */
export function levelsForRange(rangeM: number): number {
  for (let l = 0; l < MAX_LEVELS; l++) if (levelHalfExtentM(l) >= rangeM) return l + 1;
  return MAX_LEVELS;
}

/**
 * One block of the quadtree: the square e in [ix, ix + 1) and n in [iy, iy + 1) block sides, so the
 * children of (l, ix, iy) are (l - 1, 2ix + {0,1}, 2iy + {0,1}) and the eye sits on a block corner.
 */
export interface BlockId {
  level: number;
  ix: number;
  iy: number;
}

/**
 * Largest angle a cell outside the frame may subtend. A ring block of the old fixed clipmap sat one
 * block side away from the eye, so its cell was 1 / BLOCK_CELLS rad: keeping that value reproduces
 * the old mesh exactly where the frame does not look, which is what still casts shadows and skyline.
 */
export const COARSE_TARGET_RAD = 1 / BLOCK_CELLS;
/** The frame's wedge is widened by this fraction of its own width on each side, so small pans need no rebuild. */
export const MESH_AZ_PAD = 0.3;
/** …but never by less than this, or a 2400 mm frame would rebuild on every nudge. */
export const MESH_AZ_MIN_PAD_DEG = 0.25;
/** Triangles one mesh may reach; about 600 blocks, 65 MB of vertex and index buffers. */
export const MAX_MESH_TRIANGLES = 3_000_000;
/** Pixels one cell may span inside the frame; 4 puts about 250 cells across a 1000 px frame. */
export const MESH_PX_PER_CELL = 4;
/** The budget is spent by pulling the screen-space target in towards the eye, down to this reach. */
export const MIN_MESH_REACH_M = 1000;
/**
 * Floor for `demCellM`, so a finer DEM cannot pull `minLevel` down on its own. The budget cannot
 * hold a 2 m floor and still reach a 10 km subject: the near field would eat it and the mountain
 * being photographed would coarsen. Lowering this needs frame-pitch culling first.
 */
export const MESH_MIN_CELL_M = 4;

/** How far the aim may wander before the frame leaves the wedge that was selected for it. */
export const meshAzPadDeg = (hfovDeg: number): number => Math.max(MESH_AZ_MIN_PAD_DEG, MESH_AZ_PAD * hfovDeg);

/** Where the frame points and how fine it wants the terrain inside it. */
export interface MeshView {
  azimuthDeg: number;
  /** Horizontal field of view of the frame itself; the pad is added on top. */
  hfovDeg: number;
  /** Largest angle one cell may subtend inside the frame, radians. */
  targetRad: number;
}

export interface SelectOptions {
  rangeM: number;
  /** Ground size of one DEM post at this latitude; the mesh never goes finer. */
  demCellM: number;
  view: MeshView | null;
  maxTriangles?: number;
}

export interface Selection {
  /** Leaves grouped by level, finest first. */
  levels: { level: number; blocks: BlockId[] }[];
  blocks: number;
  triangles: number;
  /** The in-frame target actually used; coarser than asked when the budget bit. */
  targetRad: number;
  /** How far out that target was afforded; past it the mesh falls back to the coarse one. */
  reachM: number;
}

const wrapPi = (a: number): number => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
const blockKey = (level: number, ix: number, iy: number): string => `${level}/${ix}/${iy}`;

/** Distance from the eye to the nearest point of a block, metres; 0 when the eye is inside it. */
function nearestDistM(e0: number, n0: number, e1: number, n1: number): number {
  return Math.hypot(Math.max(e0, -e1, 0), Math.max(n0, -n1, 0));
}

/**
 * Bearings a block subtends at the eye, as a mid bearing and half width in radians; null when the
 * eye is inside it and every bearing is covered. A convex box that excludes the eye spans less than
 * a half turn and its extremes are corners, so four corners settle it.
 */
function bearingSpan(e0: number, n0: number, e1: number, n1: number): { mid: number; half: number } | null {
  if (e0 <= 0 && e1 >= 0 && n0 <= 0 && n1 >= 0) return null;
  const ref = Math.atan2(e0, n0);
  let lo = 0;
  let hi = 0;
  for (const [e, n] of [
    [e1, n0],
    [e1, n1],
    [e0, n1]
  ]) {
    const d = wrapPi(Math.atan2(e, n) - ref);
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return { mid: ref + (lo + hi) / 2, half: (hi - lo) / 2 };
}

/** Blocks the quadtree starts from: the 4x4 grid of `rootLevel`, the extent the old clipmap reached. */
export function rootBlocks(rootLevel: number): BlockId[] {
  const out: BlockId[] = [];
  const h = BLOCKS_PER_SIDE / 2;
  for (let iy = -h; iy < h; iy++) for (let ix = -h; ix < h; ix++) out.push({ level: rootLevel, ix, iy });
  return out;
}

/** True while (level, ix, iy) is inside the square the roots cover. */
const inRoot = (rootLevel: number, level: number, ix: number, iy: number): boolean => {
  const h = (BLOCKS_PER_SIDE / 2) * 2 ** (rootLevel - level);
  return ix >= -h && ix < h && iy >= -h && iy < h;
};

/** One descent, with no budget check; exported for tests that want a fixed target. */
function descend(rootLevel: number, minLevel: number, view: MeshView | null, fineRad: number, reachM: number): Map<string, BlockId> {
  const viewMid = view ? view.azimuthDeg * D2R : 0;
  const viewHalf = view ? (view.hfovDeg / 2 + meshAzPadDeg(view.hfovDeg)) * D2R : 0;
  const leaves = new Map<string, BlockId>();
  const stack = rootBlocks(rootLevel);
  while (stack.length) {
    const b = stack.pop()!;
    const s = blockSideM(b.level);
    const e0 = b.ix * s;
    const n0 = b.iy * s;
    const d = nearestDistM(e0, n0, e0 + s, n0 + s);
    let target = COARSE_TARGET_RAD;
    if (view && d <= reachM) {
      const span = viewHalf >= Math.PI ? null : bearingSpan(e0, n0, e0 + s, n0 + s);
      // A null span is the eye inside the block, or a wedge that has grown to the whole circle.
      if (!span || Math.abs(wrapPi(span.mid - viewMid)) <= span.half + viewHalf) target = fineRad;
    }
    if (b.level > minLevel && levelCellM(b.level) > target * d) {
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) stack.push({ level: b.level - 1, ix: 2 * b.ix + dx, iy: 2 * b.iy + dy });
    } else {
      leaves.set(blockKey(b.level, b.ix, b.iy), b);
    }
  }
  return leaves;
}

/**
 * Splits leaves until no two that share an edge differ by more than one level. The skirt depth is
 * `6 * cellM`, which only covers the step to a neighbour of the next level up; a raw selection can
 * put a 4 m leaf beside a 512 m one where the frame's wedge ends.
 */
function balance(leaves: Map<string, BlockId>, rootLevel: number): void {
  const queue = [...leaves.values()];
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ];
  for (let qi = 0; qi < queue.length; qi++) {
    const n = queue[qi];
    if (!leaves.has(blockKey(n.level, n.ix, n.iy))) continue;
    for (const [dx, dy] of dirs) {
      const nx = n.ix + dx;
      const ny = n.iy + dy;
      if (!inRoot(rootLevel, n.level, nx, ny)) continue;
      // Walk up until the leaf covering the neighbour cell turns up, splitting it while it is too coarse.
      for (;;) {
        let hit: BlockId | undefined;
        for (let m = n.level + 1; m <= rootLevel && !hit; m++) {
          const s = 2 ** (m - n.level);
          hit = leaves.get(blockKey(m, Math.floor(nx / s), Math.floor(ny / s)));
        }
        if (!hit || hit.level < n.level + 2) break;
        leaves.delete(blockKey(hit.level, hit.ix, hit.iy));
        for (let cy = 0; cy < 2; cy++)
          for (let cx = 0; cx < 2; cx++) {
            const child = { level: hit.level - 1, ix: 2 * hit.ix + cx, iy: 2 * hit.iy + cy };
            leaves.set(blockKey(child.level, child.ix, child.iy), child);
            queue.push(child);
          }
      }
    }
  }
}

/**
 * Leaves of the quadtree, finest first. A cell is split while it subtends more than the target angle
 * at the eye, so the ground the frame looks at holds a fixed pixel size whatever the focal length,
 * while everything outside the frame's wedge keeps the old clipmap's resolution for shadows and
 * skyline. Holding that target over the whole range costs tens of millions of triangles at a long
 * focal, so the budget is spent nearest first: the reach shrinks until the mesh fits, and only once
 * the reach has bottomed out does the target itself coarsen.
 */
export function selectBlocks(opts: SelectOptions): Selection {
  const rootLevel = levelsForRange(opts.rangeM) - 1;
  let minLevel = 0;
  while (minLevel < rootLevel && levelCellM(minLevel) < opts.demCellM) minLevel++;
  const budget = opts.maxTriangles ?? MAX_MESH_TRIANGLES;
  const walk = (reach: number, target: number) => {
    const l = descend(rootLevel, minLevel, opts.view, target, reach);
    balance(l, rootLevel);
    return l;
  };
  const fits = (l: Map<string, BlockId>) => l.size * TRIANGLES_PER_BLOCK <= budget;
  let targetRad = opts.view ? Math.min(opts.view.targetRad, COARSE_TARGET_RAD) : COARSE_TARGET_RAD;
  let reachM = opts.rangeM;
  let leaves = walk(reachM, targetRad);
  // Halve the reach until the mesh fits, then bisect back up for what the budget really affords.
  while (!fits(leaves) && reachM > MIN_MESH_REACH_M) {
    reachM = Math.max(MIN_MESH_REACH_M, reachM / 2);
    leaves = walk(reachM, targetRad);
  }
  for (let i = 0, hi = Math.min(opts.rangeM, reachM * 2); i < 3 && fits(leaves) && reachM < opts.rangeM; i++) {
    const mid = (reachM + hi) / 2;
    const wider = walk(mid, targetRad);
    if (fits(wider)) {
      reachM = mid;
      leaves = wider;
    } else hi = mid;
  }
  // Only once the reach has bottomed out does the target itself give way.
  while (!fits(leaves) && targetRad < COARSE_TARGET_RAD) {
    targetRad = Math.min(COARSE_TARGET_RAD, targetRad * 2);
    leaves = walk(reachM, targetRad);
  }
  const byLevel = new Map<number, BlockId[]>();
  for (const b of leaves.values()) {
    const list = byLevel.get(b.level);
    if (list) list.push(b);
    else byLevel.set(b.level, [b]);
  }
  const levels = [...byLevel.entries()]
    .toSorted((a, b) => a[0] - b[0])
    .map(([level, blocks]) => ({ level, blocks: blocks.toSorted((a, b) => a.iy - b.iy || a.ix - b.ix) }));
  return { levels, blocks: leaves.size, triangles: leaves.size * TRIANGLES_PER_BLOCK, targetRad, reachM };
}

/**
 * Unit Web-Mercator bounds of one block's halo, as `tilesInBounds` expects them. Only the selected
 * blocks may be enumerated: a level-0 leaf 8 km out would otherwise drag in its whole level square
 * at z15, which is thousands of tiles. `haloM` is the block's own cell unless the sampler reaches
 * further than that, as a cubic one does.
 */
export function blockUnitBounds(pin: LngLat, b: BlockId, haloM = levelCellM(b.level)): { x0: number; x1: number; y0: number; y1: number } {
  const s = blockSideM(b.level);
  const e0 = b.ix * s - haloM;
  const n0 = b.iy * s - haloM;
  const e1 = e0 + s + 2 * haloM;
  const n1 = n0 + s + 2 * haloM;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  // The block is a square in ENU, so its Mercator image bows: walk the rim, do not trust the corners.
  const steps = 8;
  for (let i = 0; i < steps; i++) {
    const f = i / steps;
    for (const [e, n] of [
      [e0 + f * (e1 - e0), n0],
      [e1, n0 + f * (n1 - n0)],
      [e1 - f * (e1 - e0), n1],
      [e0, n1 - f * (n1 - n0)]
    ]) {
      const p = samplePoint(pin, e, n);
      const t = lngLatToTilePixel(p.lng, p.lat, 0, 1);
      x0 = Math.min(x0, t.px);
      x1 = Math.max(x1, t.px);
      y0 = Math.min(y0, t.py);
      y1 = Math.max(y1, t.py);
    }
  }
  return { x0, x1, y0, y1 };
}

/** Ground height above the datum at a point, metres; NaN where no tile was available. */
export type HeightSampler = (lng: number, lat: number) => number;

/** One level's leaves: every block's triangles in one pair of buffers, with a range table for culling. */
export interface MeshLevel {
  level: number;
  cellM: number;
  /** Eye-relative metres, three per vertex. */
  pos: Float32Array;
  /** Unit surface normal, three per vertex. */
  nrm: Float32Array;
  idx: Uint32Array;
  /** Indices of block b are [blockStart[b], blockStart[b + 1]). */
  blockStart: Int32Array;
  /** Six per block: minE, minN, minU, maxE, maxN, maxU. */
  blockBox: Float32Array;
  blocks: number;
  /** Vertices whose DEM tile was missing and which fell back to sea level. */
  missing: number;
}

/** Eye-relative position of a mesh sample; the exact inverse of the map `buildPrisms` applies. */
export function samplePoint(pin: LngLat, e: number, n: number): LngLat {
  const d = Math.hypot(e, n);
  return d < 1e-9 ? pin : destination(pin, Math.atan2(e, n) * R2D, d);
}

/** Skirts hang this far below the rim, enough to cover the step to a neighbour one level coarser. */
const skirtDepth = (cellM: number) => Math.max(8, 6 * cellM);

/**
 * One level's blocks. Heights come from `sample` over a one-cell halo so every vertex normal is a
 * central difference, and every block is rimmed with a downward skirt so a level seam cannot crack.
 */
export function buildLevel(pin: LngLat, eyeM: number, level: number, blocks: readonly BlockId[], sample: HeightSampler): MeshLevel {
  const cellM = levelCellM(level);
  const side = BLOCK_CELLS + 1;
  const halo = BLOCK_CELLS + 3;
  const vPerBlock = side * side + 4 * BLOCK_CELLS;
  const pos = new Float32Array(blocks.length * vPerBlock * 3);
  const nrm = new Float32Array(blocks.length * vPerBlock * 3);
  const idx = new Uint32Array(blocks.length * TRIANGLES_PER_BLOCK * 3);
  const blockStart = new Int32Array(blocks.length + 1);
  const blockBox = new Float32Array(blocks.length * 6);
  const u = new Float64Array(halo * halo);
  const drop = skirtDepth(cellM);
  let vBase = 0;
  let ii = 0;
  let missing = 0;

  for (const [b, { ix, iy }] of blocks.entries()) {
    blockStart[b] = ii;
    const i0 = ix * BLOCK_CELLS;
    const j0 = iy * BLOCK_CELLS;
    for (let j = 0; j < halo; j++) {
      const n = (j0 + j - 1) * cellM;
      for (let i = 0; i < halo; i++) {
        const e = (i0 + i - 1) * cellM;
        const p = samplePoint(pin, e, n);
        const g = sample(p.lng, p.lat);
        if (Number.isNaN(g)) missing++;
        // Terrarium reads water as bathymetry, and the datum is sea level.
        u[j * halo + i] = (Number.isNaN(g) ? 0 : Math.max(g, 0)) - eyeM - curvatureDropM(Math.hypot(e, n));
      }
    }
    let e0 = Infinity;
    let e1 = -Infinity;
    let n0 = Infinity;
    let n1 = -Infinity;
    let u0 = Infinity;
    let u1 = -Infinity;
    for (let j = 0; j < side; j++) {
      const nn = (j0 + j) * cellM;
      for (let i = 0; i < side; i++) {
        const ee = (i0 + i) * cellM;
        const h = u[(j + 1) * halo + i + 1];
        const de = (u[(j + 1) * halo + i + 2] - u[(j + 1) * halo + i]) / (2 * cellM);
        const dn = (u[(j + 2) * halo + i + 1] - u[j * halo + i + 1]) / (2 * cellM);
        const inv = 1 / Math.hypot(de, dn, 1);
        const o = (vBase + j * side + i) * 3;
        pos[o] = ee;
        pos[o + 1] = nn;
        pos[o + 2] = h;
        nrm[o] = -de * inv;
        nrm[o + 1] = -dn * inv;
        nrm[o + 2] = inv;
        if (ee < e0) e0 = ee;
        if (ee > e1) e1 = ee;
        if (nn < n0) n0 = nn;
        if (nn > n1) n1 = nn;
        if (h < u0) u0 = h;
        if (h > u1) u1 = h;
      }
    }
    for (let j = 0; j < BLOCK_CELLS; j++) {
      for (let i = 0; i < BLOCK_CELLS; i++) {
        const a = vBase + j * side + i;
        idx[ii++] = a;
        idx[ii++] = a + 1;
        idx[ii++] = a + side + 1;
        idx[ii++] = a;
        idx[ii++] = a + side + 1;
        idx[ii++] = a + side;
      }
    }
    // Rim skirt: the rim walked as a closed ring, each vertex paired with one hanging below it.
    const rim: number[] = [];
    for (let i = 0; i < BLOCK_CELLS; i++) rim.push(vBase + i);
    for (let j = 0; j < BLOCK_CELLS; j++) rim.push(vBase + j * side + BLOCK_CELLS);
    for (let i = BLOCK_CELLS; i > 0; i--) rim.push(vBase + BLOCK_CELLS * side + i);
    for (let j = BLOCK_CELLS; j > 0; j--) rim.push(vBase + j * side);
    const first = vBase + side * side;
    for (const [s, a] of rim.entries()) {
      const o = (first + s) * 3;
      pos[o] = pos[a * 3];
      pos[o + 1] = pos[a * 3 + 1];
      pos[o + 2] = pos[a * 3 + 2] - drop;
      nrm[o] = nrm[a * 3];
      nrm[o + 1] = nrm[a * 3 + 1];
      nrm[o + 2] = nrm[a * 3 + 2];
    }
    for (let s = 0; s < rim.length; s++) {
      const t = (s + 1) % rim.length;
      idx[ii++] = rim[s];
      idx[ii++] = rim[t];
      idx[ii++] = first + t;
      idx[ii++] = rim[s];
      idx[ii++] = first + t;
      idx[ii++] = first + s;
    }
    u0 -= drop;
    blockBox.set([e0, n0, u0, e1, n1, u1], b * 6);
    vBase += vPerBlock;
  }
  blockStart[blocks.length] = ii;
  return { level, cellM, pos, nrm, idx, blockStart, blockBox, blocks: blocks.length, missing };
}
