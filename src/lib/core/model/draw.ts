/** Drawing a footprint from scratch, editing its edges, and nudging a placed model. */

import { bearingDeg, destination, distanceM, elevationAngleDeg, type LngLat } from '@core/geo/geodesy';
import { AltitudeRef, localToLngLat, lngLatToLocal, ModelSource, partsFootprint, type ModelAnchor, type ModelPart, type SavedModel } from '@core/model';
import { RoofShape } from '@workers/buildings.protocol';

type EN = [e: number, n: number];

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const wrap360 = (d: number) => ((d % 360) + 360) % 360;
const round = (v: number, step: number) => Math.round(v / step) * step;

/** `parts` with part `id` patched. */
export function withPart(parts: readonly ModelPart[], id: string, patch: Partial<ModelPart>): ModelPart[] {
  return parts.map((q) => (q.id === id ? { ...q, ...patch } : q));
}

/** Moves `p` so the corner at the last vertex is square, or straight when that is nearer. */
export function snapRightAngle(ring: readonly EN[], p: EN): EN {
  if (ring.length < 2) return p;
  const [ax, ay] = ring[ring.length - 2];
  const [bx, by] = ring[ring.length - 1];
  const len = Math.hypot(bx - ax, by - ay);
  if (len === 0) return p;
  const ux = (bx - ax) / len;
  const uy = (by - ay) / len;
  const dx = p[0] - bx;
  const dy = p[1] - by;
  const along = dx * ux + dy * uy;
  const across = -dx * uy + dy * ux;
  return Math.abs(across) >= Math.abs(along) ? [bx - across * uy, by + across * ux] : [bx + along * ux, by + along * uy];
}

/** Index of the nearest screen point within `radiusPx` of `p`, or -1. */
export function nearestWithin(pts: readonly { x: number; y: number }[], p: { x: number; y: number }, radiusPx: number): number {
  let best = -1;
  let bestD = radiusPx;
  for (const [i, q] of pts.entries()) {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d <= bestD) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

export interface Edge {
  lengthM: number;
  /** Clockwise from true north. */
  bearingDeg: number;
}

/** Edge `i` runs from vertex `i` to the next, in the model's scaled, turned frame. */
export function ringEdges(ring: readonly EN[], anchor: Pick<ModelAnchor, 'headingDeg' | 'scale'>): Edge[] {
  return ring.map(([ae, an], i) => {
    const [be, bn] = ring[(i + 1) % ring.length];
    return { lengthM: Math.hypot(be - ae, bn - an) * anchor.scale, bearingDeg: wrap360(Math.atan2(be - ae, bn - an) * R2D + anchor.headingDeg) };
  });
}

/** Moves the far end of edge `i` along it so the edge is `lengthM` long. */
export function withEdgeLength(ring: readonly EN[], i: number, lengthM: number, anchor: Pick<ModelAnchor, 'headingDeg' | 'scale'>): EN[] {
  const e = ringEdges(ring, anchor)[i];
  return withEdge(ring, i, Math.max(0.01, lengthM), e.bearingDeg, anchor);
}

/** Turns edge `i` about its start to point along `bearingDeg`. */
export function withEdgeBearing(ring: readonly EN[], i: number, bearingDegTrue: number, anchor: Pick<ModelAnchor, 'headingDeg' | 'scale'>): EN[] {
  return withEdge(ring, i, ringEdges(ring, anchor)[i].lengthM, bearingDegTrue, anchor);
}

function withEdge(ring: readonly EN[], i: number, lengthM: number, bearingDegTrue: number, anchor: Pick<ModelAnchor, 'headingDeg' | 'scale'>): EN[] {
  const j = (i + 1) % ring.length;
  const a = (bearingDegTrue - anchor.headingDeg) * D2R;
  const l = lengthM / anchor.scale;
  const out = ring.map(([e, n]) => [e, n] as EN);
  out[j] = [ring[i][0] + l * Math.sin(a), ring[i][1] + l * Math.cos(a)];
  return out;
}

/** A Drawn model of one flat part on a ring tapped on the map, anchored at its bounding-box centre. */
export function drawnModel(pts: readonly LngLat[], name: string, heightM: number, now = Date.now()): SavedModel | null {
  if (pts.length < 3) return null;
  const lngs = pts.map((p) => p.lng);
  const lats = pts.map((p) => p.lat);
  const anchor: ModelAnchor = {
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    altRef: AltitudeRef.Ground,
    altM: 0,
    headingDeg: 0,
    scale: 1
  };
  const part: ModelPart = { id: crypto.randomUUID(), ring: pts.map((p) => lngLatToLocal(anchor, p)), baseM: 0, heightM, roof: RoofShape.Flat, roofHeightM: 0, roofDirDeg: NaN, roofAcross: 0 };
  return {
    id: crypto.randomUUID(),
    name,
    source: ModelSource.Drawn,
    anchor,
    parts: [part],
    footprint: partsFootprint(anchor, [part]),
    groundM: NaN,
    suppressOverture: true,
    visible: true,
    attribution: 'Drawn in Scape',
    notes: '',
    createdAt: now,
    updatedAt: now
  };
}

export const NudgeKind = { East: 'East', North: 'North', Heading: 'Heading', Lift: 'Lift', Height: 'Height' } as const;
export type NudgeKind = (typeof NudgeKind)[keyof typeof NudgeKind];

export interface Nudge {
  kind: NudgeKind;
  /** Metres, or degrees for Heading. */
  by: number;
}

/** Fine and coarse steps per nudge, as the pad and the keys offer them. */
export const NUDGE_STEPS: Record<NudgeKind, readonly [fine: number, coarse: number]> = {
  East: [0.1, 1],
  North: [0.1, 1],
  Heading: [0.05, 1],
  Lift: [0.1, 1],
  Height: [0.1, 1]
};

/** Arrows move the model, Alt turns (left/right) or lifts (up/down) it; Shift takes the coarse step. */
export function nudgeForKey(key: string, shift: boolean, alt: boolean): Nudge | null {
  const sign = key === 'ArrowRight' || key === 'ArrowUp' ? 1 : key === 'ArrowLeft' || key === 'ArrowDown' ? -1 : 0;
  if (!sign) return null;
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
  const kind = alt ? (horizontal ? NudgeKind.Heading : NudgeKind.Lift) : horizontal ? NudgeKind.East : NudgeKind.North;
  return { kind, by: sign * NUDGE_STEPS[kind][shift ? 1 : 0] };
}

/** The patch a nudge makes; Height moves the part `partId`, or the tallest part. */
export function applyNudge(m: SavedModel, n: Nudge, partId: string | null): Partial<SavedModel> {
  const a = m.anchor;
  switch (n.kind) {
    case NudgeKind.East:
    case NudgeKind.North: {
      const to = destination(a, n.kind === NudgeKind.East ? (n.by >= 0 ? 90 : 270) : n.by >= 0 ? 0 : 180, Math.abs(n.by));
      return { anchor: { ...a, lat: to.lat, lng: to.lng } };
    }
    case NudgeKind.Heading:
      return { anchor: { ...a, headingDeg: round(wrap360(a.headingDeg + n.by), 1e-6) } };
    case NudgeKind.Lift:
      return { anchor: { ...a, altM: round(a.altM + n.by, 1e-6) } };
    case NudgeKind.Height: {
      const parts = m.parts ?? [];
      const target = parts.find((p) => p.id === partId) ?? parts.reduce<ModelPart | null>((b, p) => (!b || p.heightM > b.heightM ? p : b), null);
      if (!target) return {};
      const heightM = Math.max(target.baseM + 0.1, round(target.heightM + n.by, 1e-6));
      return { parts: withPart(parts, target.id, { heightM }) };
    }
  }
}

/** Where a model's highest vertex stands, and how far above the model's ground. */
export function apexOf(m: Pick<SavedModel, 'anchor'>, pos: Float32Array): { at: LngLat; aboveGroundM: number } | null {
  let top = -Infinity;
  for (let v = 2; v < pos.length; v += 3) top = Math.max(top, pos[v]);
  if (!Number.isFinite(top)) return null;
  let e = 0;
  let n = 0;
  let k = 0;
  for (let v = 0; v + 2 < pos.length; v += 3) {
    if (pos[v + 2] < top - 1e-3) continue;
    e += pos[v];
    n += pos[v + 1];
    k++;
  }
  return { at: localToLngLat(m.anchor, e / k, n / k), aboveGroundM: m.anchor.altM + top * m.anchor.scale };
}

/** Line segments e, n, u × 2 where the mesh turns from facing the eye (at the origin) to facing away. */
export function silhouetteEdges(pos: Float32Array, idx: Uint32Array): Float32Array {
  const key = (v: number) => `${pos[v * 3].toFixed(3)},${pos[v * 3 + 1].toFixed(3)},${pos[v * 3 + 2].toFixed(3)}`;
  const edges = new Map<string, { a: number; b: number; front: number; back: number }>();
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const [i, j, k] = [idx[t], idx[t + 1], idx[t + 2]];
    const ux = pos[j * 3] - pos[i * 3];
    const uy = pos[j * 3 + 1] - pos[i * 3 + 1];
    const uz = pos[j * 3 + 2] - pos[i * 3 + 2];
    const vx = pos[k * 3] - pos[i * 3];
    const vy = pos[k * 3 + 1] - pos[i * 3 + 1];
    const vz = pos[k * 3 + 2] - pos[i * 3 + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const front = nx * pos[i * 3] + ny * pos[i * 3 + 1] + nz * pos[i * 3 + 2] < 0;
    for (const [a, b] of [
      [i, j],
      [j, k],
      [k, i]
    ]) {
      const ka = key(a);
      const kb = key(b);
      const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const e = edges.get(id) ?? { a, b, front: 0, back: 0 };
      if (front) e.front++;
      else e.back++;
      edges.set(id, e);
    }
  }
  const out: number[] = [];
  for (const e of edges.values()) {
    // An edge of the front on the outline: a back face or no face on its other side.
    if (e.front === 0 || (e.back === 0 && e.front >= 2)) continue;
    out.push(pos[e.a * 3], pos[e.a * 3 + 1], pos[e.a * 3 + 2], pos[e.b * 3], pos[e.b * 3 + 1], pos[e.b * 3 + 2]);
  }
  return Float32Array.from(out);
}

/**
 * The runs of each e, n, u × 2 segment whose pieces are not `hidden`, tested at each piece's midpoint so
 * a vertex the model shares with its own faces is never the sample; segment `i` splits into `pieces(i)`.
 */
export function visibleRuns(seg: Float32Array, pieces: (i: number) => number, hidden: (e: number, n: number, u: number) => boolean): Float32Array {
  const out: number[] = [];
  for (let i = 0; i + 5 < seg.length; i += 6) {
    const [ae, an, au] = [seg[i], seg[i + 1], seg[i + 2]];
    const [de, dn, du] = [seg[i + 3] - ae, seg[i + 4] - an, seg[i + 5] - au];
    const k = Math.max(1, Math.round(pieces(i / 6)));
    let from = -1;
    for (let j = 0; j <= k; j++) {
      const seen = j < k && !hidden(ae + de * ((j + 0.5) / k), an + dn * ((j + 0.5) / k), au + du * ((j + 0.5) / k));
      if (seen && from < 0) from = j;
      if (seen || from < 0) continue;
      const [t0, t1] = [from / k, j / k];
      out.push(ae + de * t0, an + dn * t0, au + du * t0, ae + de * t1, an + dn * t1, au + du * t1);
      from = -1;
    }
  }
  return Float32Array.from(out);
}

/** Azimuth and elevation, degrees, from an eye to a point `riseM` above or below it. */
export function azElTo(eye: LngLat, p: LngLat, riseM: number): { azDeg: number; elDeg: number; distM: number } {
  const d = distanceM(eye, p);
  return { azDeg: bearingDeg(eye, p), elDeg: elevationAngleDeg(d, riseM), distM: d };
}
