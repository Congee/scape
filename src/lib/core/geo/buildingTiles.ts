/** Wedge tile enumeration and MVT building decoding (Overture `building`/`building_part`) for the viewfinder's 3D volumes. */

import { bearingDeg, destination, distanceM, normalizeBearing, type LngLat } from '@core/geo/geodesy';
import { lngLatToTilePixel, tileKey, tilePixelToLngLat, type TileCoord } from '@core/terrain/tiles';
import { RoofShape, type BuildingBatch } from '@workers/buildings.protocol';

/** Minimal shape of a decoded MVT feature, so tests can pass plain objects. */
export interface VectorFeatureLike {
  properties: Record<string, unknown>;
  loadGeometry(): { x: number; y: number }[][];
}

export interface VectorLayerLike {
  length: number;
  extent: number;
  feature(i: number): VectorFeatureLike;
}

const DEFAULT_HEIGHT_M = 5;
const FLOOR_HEIGHT_M = 3;
const BBOX_SAMPLE_STEP_DEG = 5;
/** Ring vertices sampled for ground, on top of the centroid. */
const GROUND_SAMPLES = 16;

/** Decoded tile rows; `group` ties a building to its parts, the ids tie a row to its feature across tiles, and none reach the renderer. */
export type DecodedBuildings = Omit<BuildingBatch, 'groundM'> & { group: Int32Array; featureId: (string | null)[]; buildingId: (string | null)[] };

function inSector(p: LngLat, pin: LngLat, azFromDeg: number, azSpanDeg: number, rangeM: number): boolean {
  if (distanceM(pin, p) > rangeM) return false;
  if (azSpanDeg >= 360) return true;
  return normalizeBearing(bearingDeg(pin, p) - azFromDeg) <= azSpanDeg;
}

/** z14 tiles intersecting the sector (pin, azFromDeg..azFromDeg+azSpanDeg, rangeM), nearest first. */
export function tilesForWedge(pin: LngLat, azFromDeg: number, azSpanDeg: number, rangeM: number, z = 14, max = 48): TileCoord[] {
  const span = Math.min(360, Math.max(0, azSpanDeg));
  const edge: LngLat[] = [pin];
  const steps = Math.max(1, Math.ceil(span / BBOX_SAMPLE_STEP_DEG));
  for (let i = 0; i <= steps; i++) edge.push(destination(pin, azFromDeg + (span * i) / steps, rangeM));

  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const p of edge) {
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
  }

  const nw = lngLatToTilePixel(minLng, maxLat, z);
  const se = lngLatToTilePixel(maxLng, minLat, z);
  const pinTile = lngLatToTilePixel(pin.lng, pin.lat, z);
  const pinKey = tileKey(z, pinTile.x, pinTile.y);

  const hits: { tile: TileCoord; d: number }[] = [];
  for (let x = nw.x; x <= se.x; x++) {
    for (let y = nw.y; y <= se.y; y++) {
      const centre = tilePixelToLngLat(z, x, y, 128, 128);
      const key = tileKey(z, x, y);
      const probes = [
        centre,
        tilePixelToLngLat(z, x, y, 0, 0),
        tilePixelToLngLat(z, x, y, 256, 0),
        tilePixelToLngLat(z, x, y, 0, 256),
        tilePixelToLngLat(z, x, y, 256, 256)
      ];
      if (key !== pinKey && !probes.some((p) => inSector(p, pin, azFromDeg, span, rangeM))) continue;
      hits.push({ tile: { z, x, y }, d: key === pinKey ? 0 : distanceM(pin, centre) });
    }
  }
  hits.sort((a, b) => a.d - b.d);
  return hits.slice(0, max).map((h) => h.tile);
}

/** Number from an OpenMapTiles property, which may arrive as a numeric string. */
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function pick(props: Record<string, unknown>, keys: string[], fallback: number): number {
  for (const k of keys) {
    const n = num(props[k]);
    if (n !== null) return n;
  }
  return fallback;
}

/** Twice the signed area in tile space (y down), so a clockwise-on-screen outer ring is positive. */
function signedArea2(ring: { x: number; y: number }[]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += ring[j].x * ring[i].y - ring[i].x * ring[j].y;
  return sum;
}

function centroidOf(ring: { x: number; y: number }[]): { x: number; y: number } {
  let a2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j].x * ring[i].y - ring[i].x * ring[j].y;
    a2 += cross;
    cx += (ring[j].x + ring[i].x) * cross;
    cy += (ring[j].y + ring[i].y) * cross;
  }
  if (a2 === 0) {
    const n = ring.length;
    return { x: ring.reduce((s, p) => s + p.x, 0) / n, y: ring.reduce((s, p) => s + p.y, 0) / n };
  }
  return { x: cx / (3 * a2), y: cy / (3 * a2) };
}

/** Drops the closing duplicate vertex MVT rings carry. */
function openRing(ring: { x: number; y: number }[]): { x: number; y: number }[] {
  const n = ring.length;
  if (n > 1 && ring[0].x === ring[n - 1].x && ring[0].y === ring[n - 1].y) return ring.slice(0, n - 1);
  return ring;
}

/** Apex height, metres, when the feature carries no usable `height`. */
const CLASS_HEIGHT_M: Record<string, number> = {
  residential: 6,
  house: 6,
  detached: 6,
  semidetached_house: 6,
  terrace: 6,
  apartments: 6,
  bungalow: 6,
  dormitory: 6,
  outbuilding: 3,
  garage: 3,
  garages: 3,
  shed: 3,
  roof: 3,
  hut: 3,
  carport: 3
};

const ROOF_SHAPES: Record<string, RoofShape> = {
  flat: RoofShape.Flat,
  sawtooth: RoofShape.Flat,
  skillion: RoofShape.Skillion,
  pyramidal: RoofShape.Pyramidal,
  cone: RoofShape.Pyramidal,
  gabled: RoofShape.Gabled,
  gambrel: RoofShape.Gabled,
  saltbox: RoofShape.Gabled,
  round: RoofShape.Gabled,
  hipped: RoofShape.Hipped,
  half_hipped: RoofShape.Hipped,
  mansard: RoofShape.Hipped,
  dome: RoofShape.Dome,
  onion: RoofShape.Dome,
  spherical: RoofShape.Dome
};

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

/** Apex above ground: `height`, else floors × 3 m plus any roof, else a class default. */
function apexOf(props: Record<string, unknown>): number {
  const h = pick(props, ['height', 'render_height'], NaN);
  if (h > 0) return h;
  const floors = num(props.num_floors);
  if (floors !== null && floors > 0) return floors * FLOOR_HEIGHT_M + Math.max(0, num(props.roof_height) ?? 0);
  const cls = str(props.class) ?? str(props.subtype);
  return (cls !== null ? CLASS_HEIGHT_M[cls] : undefined) ?? DEFAULT_HEIGHT_M;
}

interface Row {
  group: number;
  featureId: string | null;
  buildingId: string | null;
  heightM: number;
  minHeightM: number;
  roofShape: RoofShape;
  roofHeightM: number;
  roofDirDeg: number;
  roofAcross: number;
}

function rowOf(props: Record<string, unknown>, group: number, buildingId: string | null): Row {
  const heightM = apexOf(props);
  const minRaw = pick(props, ['min_height', 'render_min_height'], 0);
  const minHeightM = minRaw >= heightM ? 0 : minRaw;
  const roof = num(props.roof_height) ?? 0;
  const shape = str(props.roof_shape);
  return {
    group,
    featureId: str(props.id),
    buildingId,
    heightM,
    minHeightM,
    roofShape: shape === null ? RoofShape.Flat : (ROOF_SHAPES[shape] ?? RoofShape.Other),
    roofHeightM: roof > 0 && roof < heightM - minHeightM ? roof : 0,
    roofDirDeg: num(props.roof_direction) ?? NaN,
    roofAcross: props.roof_orientation === 'across' ? 1 : 0
  };
}

const EMPTY_LAYER: VectorLayerLike = { length: 0, extent: 4096, feature: () => ({ properties: {}, loadGeometry: () => [] }) };

/**
 * Extruded outer rings of one tile; holes and `hide_3d` features are dropped, and a `building`
 * with `has_parts` is skipped in favour of its `building_part` rows, which share its group.
 */
export function decodeBuildings(buildingLayer: VectorLayerLike | undefined, partLayer: VectorLayerLike | undefined, tile: TileCoord): DecodedBuildings {
  const ringStart: number[] = [0];
  const lng: number[] = [];
  const lat: number[] = [];
  const cLng: number[] = [];
  const cLat: number[] = [];
  const rows: Row[] = [];

  const groups = new Map<string, number>();
  let nextGroup = 0;
  /** Parts join their parent's group; an id-less feature gets its own. */
  const groupFor = (key: string | null): number => {
    if (key === null) return nextGroup++;
    const hit = groups.get(key);
    if (hit !== undefined) return hit;
    groups.set(key, nextGroup);
    return nextGroup++;
  };

  const emit = (layer: VectorLayerLike, isPart: boolean) => {
    const extent = layer.extent || 4096;
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      const props = f.properties;
      if (props.hide_3d === true) continue;
      if (!isPart && props.has_parts === true) continue; // its parts carry the geometry
      const buildingId = str(isPart ? props.building_id : props.id);
      const row = rowOf(props, groupFor(buildingId), buildingId);

      for (const raw of f.loadGeometry()) {
        const ring = openRing(raw);
        if (ring.length < 3) continue;
        if (signedArea2(ring) <= 0) continue; // hole
        for (const p of ring) {
          const g = tilePixelToLngLat(tile.z, tile.x, tile.y, p.x, p.y, extent);
          lng.push(g.lng);
          lat.push(g.lat);
        }
        const c = centroidOf(ring);
        const cg = tilePixelToLngLat(tile.z, tile.x, tile.y, c.x, c.y, extent);
        cLng.push(cg.lng);
        cLat.push(cg.lat);
        rows.push(row);
        ringStart.push(lng.length);
      }
    }
  };

  emit(buildingLayer ?? EMPTY_LAYER, false);
  emit(partLayer ?? EMPTY_LAYER, true);

  return {
    tileKey: tileKey(tile.z, tile.x, tile.y),
    count: rows.length,
    ringStart: Int32Array.from(ringStart),
    lng: Float64Array.from(lng),
    lat: Float64Array.from(lat),
    heightM: Float32Array.from(rows, (r) => r.heightM),
    minHeightM: Float32Array.from(rows, (r) => r.minHeightM),
    roofShape: Uint8Array.from(rows, (r) => r.roofShape),
    roofHeightM: Float32Array.from(rows, (r) => r.roofHeightM),
    roofDirDeg: Float32Array.from(rows, (r) => r.roofDirDeg),
    roofAcross: Uint8Array.from(rows, (r) => r.roofAcross),
    cLng: Float64Array.from(cLng),
    cLat: Float64Array.from(cLat),
    group: Int32Array.from(rows, (r) => r.group),
    featureId: rows.map((r) => r.featureId),
    buildingId: rows.map((r) => r.buildingId)
  };
}

/** The rows `heightAtPoint` needs: outer rings plus each row's apex and group. */
export interface HeightRows {
  count: number;
  ringStart: Int32Array;
  lng: Float64Array;
  lat: Float64Array;
  heightM: Float32Array;
  group: Int32Array;
}

function inRing(rows: HeightRows, i: number, p: LngLat): boolean {
  const from = rows.ringStart[i];
  const to = rows.ringStart[i + 1];
  let inside = false;
  for (let a = from, b = to - 1; a < to; b = a++) {
    const ya = rows.lat[a];
    const yb = rows.lat[b];
    if (ya > p.lat === yb > p.lat) continue;
    const x = rows.lng[a] + ((p.lat - ya) / (yb - ya)) * (rows.lng[b] - rows.lng[a]);
    if (p.lng < x) inside = !inside;
  }
  return inside;
}

/** Apex of the building under `p`: the tallest row of any group hit. Null when the point is on no footprint. */
export function heightAtPoint(rows: HeightRows, p: LngLat): number | null {
  const hit = new Set<number>();
  for (let i = 0; i < rows.count; i++) if (inRing(rows, i, p)) hit.add(rows.group[i]);
  if (hit.size === 0) return null;
  let best = 0;
  for (let i = 0; i < rows.count; i++) if (hit.has(rows.group[i]) && rows.heightM[i] > best) best = rows.heightM[i];
  return best;
}

/** The rows `groundForRows` needs. */
export interface GroundRows {
  count: number;
  ringStart: Int32Array;
  lng: Float64Array;
  lat: Float64Array;
  cLng: Float64Array;
  cLat: Float64Array;
  group: Int32Array;
}

/**
 * Ground per row, metres: the lowest sample under the row's whole building, so a building and its
 * parts stand on one base. NaN when no sample of that group had elevation data.
 */
export function groundForRows(rows: GroundRows, elevationAt: (lng: number, lat: number) => number): Float32Array<ArrayBuffer> {
  const low = new Map<number, number>();
  const sample = (g: number, lng: number, lat: number) => {
    const e = elevationAt(lng, lat);
    if (!Number.isFinite(e)) return;
    const prev = low.get(g);
    if (prev === undefined || e < prev) low.set(g, e);
  };
  for (let i = 0; i < rows.count; i++) {
    const g = rows.group[i];
    sample(g, rows.cLng[i], rows.cLat[i]);
    const from = rows.ringStart[i];
    const n = rows.ringStart[i + 1] - from;
    const step = Math.max(1, Math.ceil(n / GROUND_SAMPLES));
    for (let k = 0; k < n; k += step) sample(g, rows.lng[from + k], rows.lat[from + k]);
  }
  const out = new Float32Array(rows.count);
  for (let i = 0; i < rows.count; i++) out[i] = low.get(rows.group[i]) ?? NaN;
  return out;
}

/** Per-row arrays every batch shape carries, plus the optional ones it may. */
type RowBatch = Omit<BuildingBatch, 'groundM'> & { groundM?: Float32Array; group?: Int32Array; featureId?: (string | null)[]; buildingId?: (string | null)[] };

/** A copy holding only the rows `keep` accepts; `batch` itself when it accepts all. */
export function pickRows<T extends RowBatch>(batch: T, keep: (i: number) => boolean): T {
  const rows: number[] = [];
  for (let i = 0; i < batch.count; i++) if (keep(i)) rows.push(i);
  if (rows.length === batch.count) return batch;
  let nv = 0;
  for (const i of rows) nv += batch.ringStart[i + 1] - batch.ringStart[i];
  const ringStart = new Int32Array(rows.length + 1);
  const lng = new Float64Array(nv);
  const lat = new Float64Array(nv);
  let v = 0;
  for (const [r, i] of rows.entries()) {
    ringStart[r] = v;
    const a = batch.ringStart[i];
    const b = batch.ringStart[i + 1];
    lng.set(batch.lng.subarray(a, b), v);
    lat.set(batch.lat.subarray(a, b), v);
    v += b - a;
  }
  ringStart[rows.length] = v;
  const per = <A extends Float32Array | Float64Array | Uint8Array | Int32Array>(src: A): A => {
    const out = new (src.constructor as new (n: number) => A)(rows.length);
    for (const [r, i] of rows.entries()) out[r] = src[i];
    return out;
  };
  const out: T = {
    ...batch,
    count: rows.length,
    ringStart,
    lng,
    lat,
    heightM: per(batch.heightM),
    minHeightM: per(batch.minHeightM),
    roofShape: per(batch.roofShape),
    roofHeightM: per(batch.roofHeightM),
    roofDirDeg: per(batch.roofDirDeg),
    roofAcross: per(batch.roofAcross),
    cLng: per(batch.cLng),
    cLat: per(batch.cLat)
  };
  if (batch.groundM) out.groundM = per(batch.groundM);
  if (batch.group) out.group = per(batch.group);
  if (batch.featureId) out.featureId = rows.map((i) => batch.featureId![i]);
  if (batch.buildingId) out.buildingId = rows.map((i) => batch.buildingId![i]);
  return out;
}

/** A lng/lat outline and its bounding box, for testing many centroids against it. */
export interface SuppressRing {
  ring: readonly (readonly [number, number])[];
  lng0: number;
  lat0: number;
  lng1: number;
  lat1: number;
}

export function suppressRing(ring: readonly (readonly [number, number])[]): SuppressRing {
  let lng0 = Infinity;
  let lat0 = Infinity;
  let lng1 = -Infinity;
  let lat1 = -Infinity;
  for (const [x, y] of ring) {
    lng0 = Math.min(lng0, x);
    lng1 = Math.max(lng1, x);
    lat0 = Math.min(lat0, y);
    lat1 = Math.max(lat1, y);
  }
  return { ring, lng0, lat0, lng1, lat1 };
}

function inSuppressRing(s: SuppressRing, lng: number, lat: number): boolean {
  if (lng < s.lng0 || lng > s.lng1 || lat < s.lat0 || lat > s.lat1) return false;
  let inside = false;
  for (let a = 0, b = s.ring.length - 1; a < s.ring.length; b = a++) {
    const [xa, ya] = s.ring[a];
    const [xb, yb] = s.ring[b];
    if (ya > lat === yb > lat) continue;
    if (lng < xa + ((lat - ya) / (yb - ya)) * (xb - xa)) inside = !inside;
  }
  return inside;
}

/** Drops each row whose centroid sits inside a model's footprint; a podium part outside it survives. */
export function suppressRows<T extends RowBatch>(batch: T, rings: readonly SuppressRing[]): T {
  if (rings.length === 0) return batch;
  return pickRows(batch, (i) => !rings.some((s) => inSuppressRing(s, batch.cLng[i], batch.cLat[i])));
}

/** Every row of the buildings hit at `p`, parts included; null when `p` is on no footprint. */
export function groupRowsAt<T extends RowBatch & { group: Int32Array }>(batch: T, p: LngLat): T | null {
  const hit = new Set<number>();
  for (let i = 0; i < batch.count; i++) if (inRing(batch, i, p)) hit.add(batch.group[i]);
  if (hit.size === 0) return null;
  return pickRows(batch, (i) => hit.has(batch.group[i]));
}

/** Feature ids of the rows `suppressRows` would drop. */
export function suppressedIds(batch: RowBatch & { featureId: (string | null)[] }, rings: readonly SuppressRing[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < batch.count; i++) {
    const id = batch.featureId[i];
    if (id !== null && rings.some((s) => inSuppressRing(s, batch.cLng[i], batch.cLat[i]))) out.push(id);
  }
  return out;
}

/** The z tiles a ring's bounding box touches. */
export function suppressRingTiles(s: SuppressRing, z: number): TileCoord[] {
  const nw = lngLatToTilePixel(s.lng0, s.lat1, z);
  const se = lngLatToTilePixel(s.lng1, s.lat0, z);
  const out: TileCoord[] = [];
  for (let x = nw.x; x <= se.x; x++) for (let y = nw.y; y <= se.y; y++) out.push({ z, x, y });
  return out;
}
