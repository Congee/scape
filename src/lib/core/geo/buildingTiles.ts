/** Wedge tile enumeration and MVT `building` layer decoding for the viewfinder's 3D volumes. */

import { bearingDeg, destination, distanceM, normalizeBearing, type LngLat } from '@core/geo/geodesy';
import { lngLatToTilePixel, tileKey, tilePixelToLngLat, type TileCoord } from '@core/terrain/tiles';
import type { BuildingBatch } from '@workers/buildings.protocol';

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
const BBOX_SAMPLE_STEP_DEG = 5;

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

/** Extruded outer rings of one `building` layer; holes and `hide_3d` features are dropped. */
export function decodeBuildings(layer: VectorLayerLike, tile: TileCoord): Omit<BuildingBatch, 'groundM'> {
  const extent = layer.extent || 4096;
  const ringStart: number[] = [0];
  const lng: number[] = [];
  const lat: number[] = [];
  const heightM: number[] = [];
  const minHeightM: number[] = [];
  const cLng: number[] = [];
  const cLat: number[] = [];

  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    const props = f.properties;
    if (props.hide_3d === true) continue;
    const h = pick(props, ['render_height', 'height'], DEFAULT_HEIGHT_M);
    const minH = pick(props, ['render_min_height', 'min_height'], 0);

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
      heightM.push(h);
      minHeightM.push(minH);
      ringStart.push(lng.length);
    }
  }

  return {
    tileKey: tileKey(tile.z, tile.x, tile.y),
    count: heightM.length,
    ringStart: Int32Array.from(ringStart),
    lng: Float64Array.from(lng),
    lat: Float64Array.from(lat),
    heightM: Float32Array.from(heightM),
    minHeightM: Float32Array.from(minHeightM),
    cLng: Float64Array.from(cLng),
    cLat: Float64Array.from(cLat)
  };
}
