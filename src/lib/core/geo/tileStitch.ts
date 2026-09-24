/** Rejoins the per-tile pieces of Overture features that a z14 tile boundary cut apart. */

import { lngLatToTilePixel, tileKey, tilePixelToLngLat, type TileCoord } from '@core/terrain/tiles';
import type { DecodedBuildings } from './buildingTiles';

/** A point in tile units at one zoom: tile (x, y) spans [x, x + 1] × [y, y + 1]. */
export type TilePoint = [number, number];

export interface TilePiece {
  tx: number;
  ty: number;
  ring: TilePoint[];
}

/** Two MVT pixels at extent 4096, about a metre at z14: the seam's quantisation slack. */
const SEAM_TOL = 2 / 4096;
const ON_LINE = 1e-9;

function clipAxis(ring: TilePoint[], axis: 0 | 1, bound: number, keepAbove: boolean): TilePoint[] {
  const out: TilePoint[] = [];
  const inside = (p: TilePoint) => (keepAbove ? p[axis] >= bound : p[axis] <= bound);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const ia = inside(a);
    const ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const t = (bound - a[axis]) / (b[axis] - a[axis]);
      const p: TilePoint = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      p[axis] = bound;
      out.push(p);
    }
  }
  return out;
}

/** The ring clipped to its tile's exact square, dropping the MVT buffer. */
export function clipToTile(ring: TilePoint[], tx: number, ty: number): TilePoint[] {
  let r = ring;
  r = clipAxis(r, 0, tx, true);
  r = clipAxis(r, 0, tx + 1, false);
  r = clipAxis(r, 1, ty, true);
  r = clipAxis(r, 1, ty + 1, false);
  return dedupe(r, ON_LINE);
}

function dedupe(ring: TilePoint[], tol: number): TilePoint[] {
  const out: TilePoint[] = [];
  for (const p of ring) {
    const q = out[out.length - 1];
    if (q && Math.abs(q[0] - p[0]) <= tol && Math.abs(q[1] - p[1]) <= tol) continue;
    out.push(p);
  }
  while (out.length > 1 && Math.abs(out[0][0] - out[out.length - 1][0]) <= tol && Math.abs(out[0][1] - out[out.length - 1][1]) <= tol) out.pop();
  return out;
}

interface Chain {
  pts: TilePoint[];
  startLine: string;
  endLine: string;
  /** Axis the end's seam line runs along, and which way the dropped seam edge went. */
  endAxis: 0 | 1;
  endDir: number;
  used: boolean;
}

/** The seam line an edge lies on, when a gathered neighbour sits across it. */
function seamOf(a: TilePoint, b: TilePoint, tx: number, ty: number, has: (x: number, y: number) => boolean): { line: string; axis: 0 | 1; dir: number } | null {
  const on = (v: number, w: number) => Math.abs(v - w) <= ON_LINE;
  if (on(a[0], tx) && on(b[0], tx) && has(tx - 1, ty)) return { line: `x${tx}`, axis: 1, dir: Math.sign(b[1] - a[1]) };
  if (on(a[0], tx + 1) && on(b[0], tx + 1) && has(tx + 1, ty)) return { line: `x${tx + 1}`, axis: 1, dir: Math.sign(b[1] - a[1]) };
  if (on(a[1], ty) && on(b[1], ty) && has(tx, ty - 1)) return { line: `y${ty}`, axis: 0, dir: Math.sign(b[0] - a[0]) };
  if (on(a[1], ty + 1) && on(b[1], ty + 1) && has(tx, ty + 1)) return { line: `y${ty + 1}`, axis: 0, dir: Math.sign(b[0] - a[0]) };
  return null;
}

/** Drops a join vertex that only sits on a straight run, within the seam slack. */
function dropJoins(ring: TilePoint[], joins: Set<TilePoint>): TilePoint[] {
  const r = [...ring];
  for (let i = 0; i < r.length && r.length > 3; ) {
    const p = r[i];
    const a = r[(i + r.length - 1) % r.length];
    const b = r[(i + 1) % r.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (joins.has(p) && len > 0 && Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len <= SEAM_TOL) r.splice(i, 1);
    else i++;
  }
  return r;
}

/** Outer rings of one feature's pieces, each already clipped to its own tile, joined across shared tile edges. */
export function stitchPieces(pieces: readonly TilePiece[]): TilePoint[][] {
  const tiles = new Set(pieces.map((p) => `${p.tx}/${p.ty}`));
  const has = (x: number, y: number) => tiles.has(`${x}/${y}`);
  const rings: TilePoint[][] = [];
  const chains: Chain[] = [];
  for (const piece of pieces) {
    const v = piece.ring;
    const n = v.length;
    if (n < 3) continue;
    const seams = v.map((a, i) => seamOf(a, v[(i + 1) % n], piece.tx, piece.ty, has));
    const cut = seams.flatMap((s, i) => (s ? [i] : []));
    if (cut.length === 0) {
      rings.push(v);
      continue;
    }
    for (const [c, k] of cut.entries()) {
      const j = cut[(c + 1) % cut.length];
      const pts: TilePoint[] = [];
      for (let i = (k + 1) % n; ; i = (i + 1) % n) {
        pts.push(v[i]);
        if (i === j) break;
      }
      const end = seams[j]!;
      chains.push({ pts, startLine: seams[k]!.line, endLine: end.line, endAxis: end.axis, endDir: end.dir, used: false });
    }
  }

  const next = new Map<Chain, Chain>();
  for (const c of chains) {
    const e = c.pts[c.pts.length - 1];
    let best: Chain | null = null;
    let bestT = Infinity;
    let near: Chain | null = null;
    let nearT = Infinity;
    for (const s of chains) {
      if (s.used || s.startLine !== c.endLine) continue;
      const t = (s.pts[0][c.endAxis] - e[c.endAxis]) * c.endDir;
      if (t >= -SEAM_TOL && t < bestT) {
        best = s;
        bestT = t;
      }
      if (Math.abs(t) < nearT) {
        near = s;
        nearT = Math.abs(t);
      }
    }
    const to = best ?? near;
    if (!to) continue;
    to.used = true;
    next.set(c, to);
  }

  const done = new Set<Chain>();
  for (const c0 of chains) {
    if (done.has(c0)) continue;
    const ring: TilePoint[] = [];
    const joins = new Set<TilePoint>();
    let c: Chain | undefined = c0;
    while (c && !done.has(c)) {
      done.add(c);
      joins.add(c.pts[0]);
      joins.add(c.pts[c.pts.length - 1]);
      ring.push(...c.pts);
      c = next.get(c);
    }
    if (c !== c0) continue; // an open chain means a seam matched nothing; drop it rather than guess
    const clean = dropJoins(dedupe(ring, SEAM_TOL), joins);
    if (clean.length >= 3) rings.push(clean);
  }
  return rings;
}

function toTile(z: number, lng: number, lat: number): TilePoint {
  const t = lngLatToTilePixel(lng, lat, z, 1);
  return [t.x + t.px, t.y + t.py];
}

function centroidOf(ring: readonly TilePoint[]): TilePoint {
  let a2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const c = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a2 += c;
    cx += (ring[j][0] + ring[i][0]) * c;
    cy += (ring[j][1] + ring[i][1]) * c;
  }
  if (a2 === 0) return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
  return [cx / (3 * a2), cy / (3 * a2)];
}

export interface TileRows {
  tile: TileCoord;
  rows: DecodedBuildings;
}

/** Tiles across whichever edges of `tile` the rows' rings reach, corners included. */
export function edgeNeighbours(rows: DecodedBuildings, tile: TileCoord): TileCoord[] {
  const out = new Map<string, TileCoord>();
  for (let j = 0; j < rows.ringStart[rows.count]; j++) {
    const [x, y] = toTile(tile.z, rows.lng[j], rows.lat[j]);
    const dx = x <= tile.x + SEAM_TOL ? -1 : x >= tile.x + 1 - SEAM_TOL ? 1 : 0;
    const dy = y <= tile.y + SEAM_TOL ? -1 : y >= tile.y + 1 - SEAM_TOL ? 1 : 0;
    for (const [ox, oy] of [
      [dx, 0],
      [0, dy],
      [dx, dy]
    ]) {
      if (ox === 0 && oy === 0) continue;
      const t = { z: tile.z, x: tile.x + ox, y: tile.y + oy };
      out.set(tileKey(t.z, t.x, t.y), t);
    }
  }
  return [...out.values()];
}

/** One batch of the given tiles' rows, each feature's pieces joined into whole rings. */
export function mergeTileRows(sets: readonly TileRows[]): DecodedBuildings {
  const z = sets[0].tile.z;
  type Src = { rows: DecodedBuildings; i: number; tile: TileCoord };
  const byFeature = new Map<string, Src[]>();
  const loose: Src[] = [];
  for (const s of sets) {
    for (let i = 0; i < s.rows.count; i++) {
      const src = { rows: s.rows, i, tile: s.tile };
      const id = s.rows.featureId[i];
      if (id === null) loose.push(src);
      else byFeature.set(id, [...(byFeature.get(id) ?? []), src]);
    }
  }

  const ringOf = (s: Src): TilePoint[] => {
    const out: TilePoint[] = [];
    for (let j = s.rows.ringStart[s.i]; j < s.rows.ringStart[s.i + 1]; j++) out.push(toTile(z, s.rows.lng[j], s.rows.lat[j]));
    return out;
  };
  const outRows: { src: Src; ring: TilePoint[] }[] = [];
  for (const s of loose) outRows.push({ src: s, ring: ringOf(s) });
  for (const srcs of byFeature.values()) {
    if (new Set(srcs.map((s) => tileKey(s.tile.z, s.tile.x, s.tile.y))).size === 1) {
      for (const s of srcs) outRows.push({ src: s, ring: ringOf(s) });
      continue;
    }
    const pieces = srcs.map((s) => ({ tx: s.tile.x, ty: s.tile.y, ring: clipToTile(ringOf(s), s.tile.x, s.tile.y) }));
    for (const ring of stitchPieces(pieces)) outRows.push({ src: srcs[0], ring });
  }

  const groups = new Map<string, number>();
  const groupOf = (id: string) => {
    if (!groups.has(id)) groups.set(id, groups.size);
    return groups.get(id)!;
  };
  const ringStart = new Int32Array(outRows.length + 1);
  let nv = 0;
  for (const [r, o] of outRows.entries()) {
    ringStart[r] = nv;
    nv += o.ring.length;
  }
  ringStart[outRows.length] = nv;
  const lng = new Float64Array(nv);
  const lat = new Float64Array(nv);
  const cLng = new Float64Array(outRows.length);
  const cLat = new Float64Array(outRows.length);
  const toLngLat = (p: TilePoint) => tilePixelToLngLat(z, 0, 0, p[0], p[1], 1);
  for (const [r, o] of outRows.entries()) {
    for (const [k, p] of o.ring.entries()) {
      const g = toLngLat(p);
      lng[ringStart[r] + k] = g.lng;
      lat[ringStart[r] + k] = g.lat;
    }
    const c = toLngLat(centroidOf(o.ring));
    cLng[r] = c.lng;
    cLat[r] = c.lat;
  }
  const per = <A extends Float32Array | Uint8Array>(f: (b: DecodedBuildings) => A, make: new (n: number) => A): A => {
    const out = new make(outRows.length);
    for (const [r, o] of outRows.entries()) out[r] = f(o.src.rows)[o.src.i];
    return out;
  };
  const t0 = sets[0].tile;
  return {
    tileKey: tileKey(t0.z, t0.x, t0.y),
    count: outRows.length,
    ringStart,
    lng,
    lat,
    heightM: per((b) => b.heightM, Float32Array),
    minHeightM: per((b) => b.minHeightM, Float32Array),
    roofShape: per((b) => b.roofShape, Uint8Array),
    roofHeightM: per((b) => b.roofHeightM, Float32Array),
    roofDirDeg: per((b) => b.roofDirDeg, Float32Array),
    roofAcross: per((b) => b.roofAcross, Uint8Array),
    cLng,
    cLat,
    group: Int32Array.from(outRows, (o, r) => {
      const id = o.src.rows.buildingId[o.src.i];
      return id === null ? -1 - r : groupOf(id);
    }),
    featureId: outRows.map((o) => o.src.rows.featureId[o.src.i]),
    buildingId: outRows.map((o) => o.src.rows.buildingId[o.src.i])
  };
}
