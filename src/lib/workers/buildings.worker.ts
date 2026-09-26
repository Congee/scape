/// <reference lib="webworker" />
import { groundForRows, groupRowsAt, heightAtPoint, pickRows, ringLookup, suppressedIds, suppressRing, suppressRingTiles, suppressRows, tilesForWedge, type SuppressRing } from '@core/geo/buildingTiles';
import type { LngLat } from '@core/geo/geodesy';
import { meshOccluderParts } from '@core/geo/meshOcclude';
import { prismSlots } from '@core/geo/prismOcclude';
import { buildPrisms, prismFrameKey } from '@core/geo/prismRaster';
import { prismSurfaces, surfaceBuffers } from '@core/geo/surfaces';
import { dirtyRects, frameOf, frameToLngLat, longestShadowM, maskFrame, maskStrips, shadowMask, type FrameBox, type MaskFrame } from '@core/geo/shadowMask';
import { ecefToGeodetic } from '@core/lod2/ecef';
import { lod2CoverOf, type Lod2Cover } from '@core/lod2/cover';
import { lod2RegionsNear, type Lod2Region, type Lod2Source } from '@core/lod2/regions';
import { lod2BuildingAt, lod2HeightAboveM, placeLod2, type Lod2Tile } from '@core/lod2/tile';
import type { Sphere, WalkContent } from '@core/lod2/tileset';
import { edgeNeighbours, mergeTileRows, type TileRows } from '@core/geo/tileStitch';
import { blitGrid, stampFootprint, stampTriangles, sunCeiling, type HeightGrid } from '@core/geo/sunCeiling';
import { cubicStencilTiles, demRowAt, elevationAtCubic, lowestGroundAt, withDemTiles } from '@core/terrain/dem';
import { lngLatToTilePixel, tileKey, tilePixelToLngLat, tilesInBounds, zoomForResolution, type TileCoord } from '@core/terrain/tiles';
import { yieldTurn } from '@data/yieldTurn';
import { abandonBuildingFetches, fetchBuildingBatch, setBuildingTileCacheSize, type DecodedBuildings } from '@data/buildingTiles';
import { abandonLod2Fetches, fetchLod2Tile, setLod2Geoid, setLod2TileCacheSize, walkRegion } from '@data/lod2Tiles';
import { demCacheTiles, demZoom, DemCache, TERRAIN_TILE_SIZE } from '@data/terrainTiles';
import { BuildingsKind, MASK_WORKER_NAME, type BuildingBatch, type BuildingsRequest, type BuildingsResponse, type GeoidSync, type GroundAtRequest, type HeightAtRequest, type Lod2Placed, type Lod2Request, type MaskRequest, type ModelsSync, type PrismPlaced, type RowsAtRequest, type SuppressedIdsRequest, type TilesRequest, type WorkerModel } from './buildings.protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
/** The map's mask runs in a second instance of this module, so its caches are sized for the map rect. */
const isMask = scope.name === MASK_WORKER_NAME;
const dem = new DemCache(demCacheTiles(isMask ? 320 : 512));
if (isMask) setBuildingTileCacheSize(96);
setLod2TileCacheSize(isMask ? 24 : 12);
/** Zoom of the buildings archive; `tilesForWedge` enumerates the same level. */
const BUILDINGS_ZOOM = 14;
/** Ground under one building: short of the source's finest, which would quadruple the tiles for sub-metre posts a footprint cannot use. */
const BUILDING_GROUND_ZOOM = demZoom(16);
/** Coarsest and finest DEM zoom the map's shadow mask reads. */
const CEILING_MIN_ZOOM = demZoom(8);
const CEILING_MAX_ZOOM = demZoom(14);
/** The map rect covers far more ground than the wedge at its coarsest. */
const MASK_TILE_MAX = 256;
/** Triangle budgets for LoD2, nearest tiles first; past them Overture stands in. */
const LOD2_VIEW_TRIS = 1_000_000;
const LOD2_MASK_TRIS = 2_000_000;
/** A leaf-only tileset's parents carry no content, so this sets the range at which LoD2 appears. */
const LOD2_MAX_ERROR_PX = 16;
/** Tiles fetched ahead of the one being placed. */
const LOD2_AHEAD = 4;
let latest = 0;
let latestLod2 = 0;
/** Triangles per placed url, so a tile the caller holds is kept without decoding it again. */
const lod2Tris = new Map<string, number>();
/** Newest map-mask id; the map centre is not the camera pin, so it gets its own counter and cache. */
let latestMask = 0;
let models: WorkerModel[] = [];
let modelsRev = 0;
let suppress: SuppressRing[] = [];
/** Bumped only when the model outlines change, so other model edits rebuild no prisms. */
let suppressRev = 0;
let suppressKey = '';
/** Footprints of the LoD2 tiles placed here, least recently used first; the caller names the ones it holds. */
const lod2Covers = new Map<string, Lod2Cover>();
const LOD2_COVERS_MAX = 512;
/** Ground per decoded tile; a window change does not move it. */
const groundCache = new WeakMap<DecodedBuildings, Float32Array>();
let geoidKey = '';

function syncModels(req: ModelsSync): void {
  models = req.models;
  modelsRev = req.rev;
  suppress = models.flatMap((m) => m.suppress.map(suppressRing));
  const key = models.flatMap((m) => m.suppress).map((r) => r.flat().join(',')).join('|');
  if (key !== suppressKey) suppressRev++;
  suppressKey = key;
}

function syncGeoid(req: GeoidSync): void {
  geoidKey = req.key;
  setLod2Geoid(req.key);
}

function tileAt(p: LngLat, z: number): TileCoord {
  const t = lngLatToTilePixel(p.lng, p.lat, z);
  return { z, x: t.x, y: t.y };
}

/** Copies the cached arrays so the transfer never detaches what the cache still holds. */
function withGround(batch: DecodedBuildings, groundM: Float32Array): { batch: BuildingBatch; transfer: ArrayBuffer[] } {
  const out: BuildingBatch = {
    tileKey: batch.tileKey,
    count: batch.count,
    ringStart: batch.ringStart.slice(),
    lng: batch.lng.slice(),
    lat: batch.lat.slice(),
    heightM: batch.heightM.slice(),
    minHeightM: batch.minHeightM.slice(),
    roofShape: batch.roofShape.slice(),
    roofHeightM: batch.roofHeightM.slice(),
    roofDirDeg: batch.roofDirDeg.slice(),
    roofAcross: batch.roofAcross.slice(),
    cLng: batch.cLng.slice(),
    cLat: batch.cLat.slice(),
    groundM
  };
  const arrays = [out.ringStart, out.lng, out.lat, out.heightM, out.minHeightM, out.roofShape, out.roofHeightM, out.roofDirDeg, out.roofAcross, out.cLng, out.cLat, out.groundM];
  return { batch: out, transfer: arrays.map((a) => a.buffer as ArrayBuffer) };
}

/** Ground per row on the surface the mesh draws, after loading the DEM tiles its samples need; `complete` is false when a DEM tile could not be read. */
// A fixed finest zoom, not the mesh's per-level one: that depends on view direction, so bases would shift on pan.
async function groundOf(decoded: DecodedBuildings): Promise<{ groundM: Float32Array; complete: boolean }> {
  const cached = groundCache.get(decoded);
  if (cached) return { groundM: cached, complete: true };
  if (decoded.count === 0) return { groundM: new Float32Array(0), complete: true };
  const need = new Map<string, TileCoord>();
  const want = (lng: number, lat: number) => {
    for (const t of cubicStencilTiles(lng, lat, BUILDING_GROUND_ZOOM, TERRAIN_TILE_SIZE)) need.set(tileKey(t.z, t.x, t.y), t);
  };
  for (let i = 0; i < decoded.count; i++) want(decoded.cLng[i], decoded.cLat[i]);
  for (let i = 0; i < decoded.lng.length; i++) want(decoded.lng[i], decoded.lat[i]);
  const coords = [...need.values()];
  const out = await withDemTiles(dem, coords, () => ({
    groundM: groundForRows(decoded, (lng, lat) => elevationAtCubic(dem, lng, lat, BUILDING_GROUND_ZOOM)),
    // A transient fetch error leaves the tile unset, so a later request grounds it again.
    complete: coords.every((c) => dem.get(c.z, c.x, c.y) !== undefined)
  }));
  if (out.complete) groundCache.set(decoded, out.groundM);
  return out;
}

/** Moves a cover to the recent end, dropping the oldest past the cap. */
function touchCover(c: Lod2Cover): void {
  lod2Covers.delete(c.url);
  lod2Covers.set(c.url, c);
  while (lod2Covers.size > LOD2_COVERS_MAX) lod2Covers.delete(lod2Covers.keys().next().value!);
}

/** Places the wedge's tiles and any held tile whose models, LoD2 cover or frame changed; a tile still matching is skipped. */
async function run(req: TilesRequest): Promise<void> {
  const frame = prismFrameKey(req.pin, req.eyeM);
  const wedge = tilesForWedge(req.pin, req.azFromDeg, req.azSpanDeg, req.rangeM);
  const have = new Map(req.have);
  const inWedge = new Set(wedge.map((t) => tileKey(t.z, t.x, t.y)));
  for (const k of have.keys()) {
    if (inWedge.has(k)) continue;
    const [z, x, y] = k.split('/').map(Number);
    wedge.push({ z, x, y });
  }
  const covers: Lod2Cover[] = [];
  for (const url of req.lod2Urls) {
    const c = lod2Covers.get(url);
    if (!c) continue;
    touchCover(c);
    covers.push(c);
  }
  const tiles: { t: TileCoord; cover: { sig: string; rings: SuppressRing[] }; sig: string }[] = [];
  for (const t of wedge) {
    const cover = lod2CoverOf(tileKey(t.z, t.x, t.y), covers);
    const sig = `${frame}|${suppressRev}|${cover.sig}`;
    if (have.get(tileKey(t.z, t.x, t.y)) !== sig) tiles.push({ t, cover, sig });
  }
  let missing = 0;
  let sent = 0;
  // All fetches start now so the data layer's concurrency limiter runs; they are consumed nearest first.
  const wanted = () => latest === req.id;
  const pending = tiles.map(({ t }) => fetchBuildingBatch(t, wanted));
  for (let n = 0; n < tiles.length; n++) {
    // oxlint-disable-next-line no-await-in-loop -- tiles stream nearest first, one at a time
    await yieldTurn();
    if (latest !== req.id) return;
    // oxlint-disable-next-line no-await-in-loop -- tiles stream nearest first, one at a time
    const decoded = await pending[n];
    if (latest !== req.id) return;
    if (!decoded) {
      missing++;
      continue;
    }
    const { cover, sig } = tiles[n];
    // oxlint-disable-next-line no-await-in-loop -- one DEM wait per streamed tile
    const { groundM, complete } = await groundOf(decoded);
    if (latest !== req.id) return;
    const kept = suppressRows({ ...decoded, groundM }, cover.rings.length > 0 ? [...suppress, ...cover.rings] : suppress);
    const prism = buildPrisms(kept, req.pin, req.eyeM);
    const slots = prismSlots(prism, req.rangeM);
    const mesh = prismSurfaces(prism);
    const tile: PrismPlaced = { tileKey: decoded.tileKey, frame, sig: complete ? sig : `${sig}|partial`, prism, slots, mesh, hidden: decoded.count - kept.count };
    const arrays = [...Object.values(prism), slots.start, slots.i, slots.uMin, slots.uMax].filter((a) => ArrayBuffer.isView(a));
    const buffers = [...arrays.map((a) => a.buffer as ArrayBuffer), ...surfaceBuffers(mesh)];
    scope.postMessage({ kind: BuildingsKind.Tiles, id: req.id, tile } satisfies BuildingsResponse, [...new Set(buffers)]);
    sent++;
  }
  if (latest !== req.id) return;
  scope.postMessage({ kind: BuildingsKind.Done, id: req.id, tiles: sent, missing } satisfies BuildingsResponse);
}

/** Normalized Mercator extent of a grid laid out in `frame`'s local Mercator metres. */
function frameBounds(f: MaskFrame, g: HeightGrid): { x0: number; x1: number; y0: number; y1: number } {
  const x0 = f.x + (g.originE - g.cellM / 2) / f.mPerUnit;
  const y1 = f.y - (g.originN - g.cellM / 2) / f.mPerUnit;
  return { x0, x1: x0 + (g.nx * g.cellM) / f.mPerUnit, y0: y1 - (g.ny * g.cellM) / f.mPerUnit, y1 };
}

/** One LoD2 leaf a mask stamped. */
interface Lod2Pick {
  c: WalkContent;
  region: Lod2Region;
  tris: number;
  /** lng0, lat0, lng1, lat1 over its vertices. */
  bbox: readonly [number, number, number, number];
  rings: SuppressRing[];
}

/** What a mask grid holds over its terrain, so a grown rect can stamp just its new strips. */
interface MaskStamps {
  /** By url. */
  picks: Map<string, Lod2Pick>;
  /** Keys of the Overture tiles stamped. */
  tiles: Set<string>;
}

interface MaskBuild {
  key: string;
  /** The key less the rect: builds sharing it share a lattice. */
  base: string;
  frame: MaskFrame;
  grid: HeightGrid;
  stamps: MaskStamps;
  lod2: Lod2Source[];
}

/** Height grid for the map's shadow rect; only the sun march is redone while the map stays put. */
let cachedMask: MaskBuild | null = null;

const meets = (a: FrameBox, b: FrameBox) => a.e0 <= b.e1 && b.e0 <= a.e1 && a.n0 <= b.n1 && b.n0 <= a.n1;

/** The ground a grid's cells cover, a cell wider all round for vertices that round into its edge cells. */
function gridBox(g: HeightGrid): FrameBox {
  return { e0: g.originE - 1.5 * g.cellM, n0: g.originN - 1.5 * g.cellM, e1: g.originE + (g.nx + 0.5) * g.cellM, n1: g.originN + (g.ny + 0.5) * g.cellM };
}

/** Frame east follows longitude alone and north latitude alone, so two corners bound a lng/lat box. */
function lngLatBox(f: MaskFrame, b: readonly [number, number, number, number]): FrameBox {
  const lo = frameOf(f, { lng: b[0], lat: b[1] });
  const hi = frameOf(f, { lng: b[2], lat: b[3] });
  return { e0: lo.e, n0: lo.n, e1: hi.e, n1: hi.n };
}

function sphereBox(f: MaskFrame, s: Sphere): FrameBox {
  const p = frameOf(f, ecefToGeodetic(s.x, s.y, s.z));
  // Mercator metres drift from ground metres by far less than this across a map rect.
  const r = s.r * 1.02;
  return { e0: p.e - r, n0: p.n - r, e1: p.e + r, n1: p.n + r };
}

const batchBoxes = new WeakMap<DecodedBuildings, [number, number, number, number]>();

function batchBox(b: DecodedBuildings): [number, number, number, number] {
  let box = batchBoxes.get(b);
  if (box) return box;
  box = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < b.lng.length; i++) {
    box[0] = Math.min(box[0], b.lng[i]);
    box[1] = Math.min(box[1], b.lat[i]);
    box[2] = Math.max(box[2], b.lng[i]);
    box[3] = Math.max(box[3], b.lat[i]);
  }
  batchBoxes.set(b, box);
  return box;
}

/** Footprint extents of the rows whose centroid `hit` takes. */
function rowBoxes(f: MaskFrame, b: DecodedBuildings, hit: (lng: number, lat: number) => boolean): FrameBox[] {
  const out: FrameBox[] = [];
  for (let i = 0; i < b.count; i++) {
    if (!hit(b.cLng[i], b.cLat[i])) continue;
    const r: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let j = b.ringStart[i]; j < b.ringStart[i + 1]; j++) {
      r[0] = Math.min(r[0], b.lng[j]);
      r[1] = Math.min(r[1], b.lat[j]);
      r[2] = Math.max(r[2], b.lng[j]);
      r[3] = Math.max(r[3], b.lat[j]);
    }
    out.push(lngLatBox(f, r));
  }
  return out;
}

/** Terrain over a grid laid out in local Mercator metres; latitude varies by row only. */
function fillFrameTerrain(g: HeightGrid, f: MaskFrame, zoom: number): boolean {
  let complete = true;
  for (let iy = 0; iy < g.ny; iy++) {
    const lat = tilePixelToLngLat(0, 0, 0, f.x, f.y - (g.originN + iy * g.cellM) / f.mPerUnit, 1).lat;
    const sample = demRowAt(dem, lat, zoom);
    const row = iy * g.nx;
    for (let ix = 0; ix < g.nx; ix++) {
      const lng = (f.x + (g.originE + ix * g.cellM) / f.mPerUnit) * 360 - 180;
      const h = sample(lng);
      g.h[row + ix] = h;
      if (Number.isNaN(h)) complete = false;
    }
  }
  return complete;
}

/** Stamps the grounded rows of `b`, suppressed ones gone, into each of `gs`. */
function stampRows(gs: readonly HeightGrid[], f: MaskFrame, b: DecodedBuildings, ground: Float32Array, hide: readonly SuppressRing[]): void {
  const kept = suppressRows({ ...b, groundM: ground }, hide);
  const ringE: number[] = [];
  const ringN: number[] = [];
  for (let i = 0; i < kept.count; i++) {
    const gm = kept.groundM[i];
    if (Number.isNaN(gm)) continue;
    ringE.length = 0;
    ringN.length = 0;
    for (let j = kept.ringStart[i]; j < kept.ringStart[i + 1]; j++) {
      const p = frameOf(f, { lng: kept.lng[j], lat: kept.lat[j] });
      ringE.push(p.e);
      ringN.push(p.n);
    }
    for (const g of gs) stampFootprint(g, ringE, ringN, gm + kept.heightM[i]);
  }
}

/** Stamps lng, lat, altitude triangles into each of `gs`. */
function stampWorld(gs: readonly HeightGrid[], f: MaskFrame, tris: ArrayLike<number>): void {
  const nv = tris.length / 3;
  const e = new Float64Array(nv);
  const n = new Float64Array(nv);
  const u = new Float64Array(nv);
  for (let v = 0; v < nv; v++) {
    const p = frameOf(f, { lng: tris[v * 3], lat: tris[v * 3 + 1] });
    e[v] = p.e;
    n[v] = p.n;
    u[v] = tris[v * 3 + 2];
  }
  for (const g of gs) stampTriangles(g, e, n, u);
}

/** Stamps an LoD2 tile into each of `gs`, projecting only the vertices of triangles near one. */
function stampLod2(gs: readonly HeightGrid[], f: MaskFrame, t: Lod2Tile): void {
  const { idx, world } = t;
  const e = new Float64Array(world.length / 3);
  const n = new Float64Array(world.length / 3);
  const seen = new Uint8Array(world.length / 3);
  for (const g of gs) {
    const box = gridBox(g);
    // Culled in lng/lat, where frame east and north run monotone; a cell of slack covers the inverse's rounding.
    const lo = frameToLngLat(f, box.e0 - g.cellM, box.n0 - g.cellM);
    const hi = frameToLngLat(f, box.e1 + g.cellM, box.n1 + g.cellM);
    const te = new Float64Array(idx.length);
    const tn = new Float64Array(idx.length);
    const tu = new Float64Array(idx.length);
    let k = 0;
    for (let i = 0; i + 2 < idx.length; i += 3) {
      const [a, b, c] = [idx[i] * 3, idx[i + 1] * 3, idx[i + 2] * 3];
      if (Math.max(world[a], world[b], world[c]) < lo.lng || Math.min(world[a], world[b], world[c]) > hi.lng) continue;
      if (Math.max(world[a + 1], world[b + 1], world[c + 1]) < lo.lat || Math.min(world[a + 1], world[b + 1], world[c + 1]) > hi.lat) continue;
      for (let j = i; j < i + 3; j++) {
        const v = idx[j];
        if (!seen[v]) {
          const p = frameOf(f, { lng: world[v * 3], lat: world[v * 3 + 1] });
          e[v] = p.e;
          n[v] = p.n;
          seen[v] = 1;
        }
        te[k] = e[v];
        tn[k] = n[v];
        tu[k++] = world[v * 3 + 2];
      }
    }
    stampTriangles(g, te.subarray(0, k), tn.subarray(0, k), tu.subarray(0, k));
  }
}

const hideFor = (picks: Map<string, Lod2Pick>): SuppressRing[] => [...suppress, ...[...picks.values()].flatMap((p) => p.rings)];

/** Raises the grid to every roof standing over it. Stops early, partly stamped, once `live` turns false. */
async function stampFrameBuildings(g: HeightGrid, f: MaskFrame, live: () => boolean): Promise<MaskStamps> {
  const picks = await pickLod2(g, f, live, new Map(), (t) => stampLod2([g], f, t));
  const tiles = new Set<string>();
  if (!live()) return { picks, tiles };
  const hide = hideFor(picks);
  const coords = tilesInBounds(frameBounds(f, g), BUILDINGS_ZOOM).slice(0, MASK_TILE_MAX);
  const decoded = await Promise.all(coords.map((t) => fetchBuildingBatch(t)));
  if (!live()) return { picks, tiles };
  const grounds = await Promise.all(decoded.map(async (b) => (b ? (await groundOf(b)).groundM : null)));
  for (const [i, raw] of decoded.entries()) {
    const ground = grounds[i];
    if (!raw || !ground) continue;
    stampRows([g], f, raw, ground, hide);
    tiles.add(tileKey(coords[i].z, coords[i].x, coords[i].y));
  }
  for (const m of models) stampWorld([g], f, m.tris);
  return { picks, tiles };
}

/** Every leaf in `rangeM` of `p` all around, nearest first, with its region. */
async function lod2Around(p: LngLat, rangeM: number): Promise<{ c: WalkContent; region: Lod2Region }[]> {
  const out: { c: WalkContent; region: Lod2Region }[] = [];
  for (const region of lod2RegionsNear(p, rangeM)) {
    // oxlint-disable-next-line no-await-in-loop -- regions rarely overlap
    const contents = await walkRegion(region, { pin: p, eyeH: region.geoidM, pxPerRad: 1e9, maxErrorPx: 1, rangeM, azFromDeg: 0, azSpanDeg: 360 });
    for (const c of contents) out.push({ c, region });
  }
  return out.toSorted((a, b) => a.c.distM - b.c.distM);
}

/**
 * The LoD2 leaves over the grid, nearest the view first until the budget runs out. Those in `prev` are taken
 * as they are, or left out where a nearer new one takes their budget; the rest are fetched and passed to `stamp`.
 */
async function pickLod2(g: HeightGrid, f: MaskFrame, live: () => boolean, prev: Map<string, Lod2Pick>, stamp: (t: Lod2Tile) => void): Promise<Map<string, Lod2Pick>> {
  const box = gridBox(g);
  // Nearest the frame centre rather than the rect's, so a grown rect keeps the order and the budget cut.
  const rangeM = Math.hypot(Math.max(-box.e0, box.e1), Math.max(-box.n0, box.n1));
  const around = (await lod2Around(frameToLngLat(f, 0, 0), rangeM)).filter(({ c }) => meets(sphereBox(f, c.sphere), box));
  const picks = new Map<string, Lod2Pick>();
  let tris = 0;
  for (const { c, region } of around) {
    if (!live()) break;
    const had = prev.get(c.url);
    if (had) {
      if (tris + had.tris > LOD2_MASK_TRIS) break;
      tris += had.tris;
      picks.set(c.url, had);
      continue;
    }
    // fetchLod2Tile warns once per bad tile and skips it after.
    // oxlint-disable-next-line no-await-in-loop -- nearest first until the budget runs out
    const t = await fetchLod2Tile(c, region).catch(() => null);
    if (!t) continue;
    const n = t.idx.length / 3;
    if (tris + n > LOD2_MASK_TRIS) break;
    tris += n;
    stamp(t);
    picks.set(c.url, { c, region, tris: n, bbox: t.bbox, rings: t.buildings.map((b) => suppressRing(b.hull)) });
  }
  return picks;
}

/** Terrain and, with `buildings`, roofs over all of `g`; null once superseded. */
async function wholeMask(g: HeightGrid, f: MaskFrame, zoom: number, buildings: boolean, live: () => boolean): Promise<{ stamps: MaskStamps; complete: boolean } | null> {
  const complete = await withDemTiles(dem, tilesInBounds(frameBounds(f, g), zoom), () => live() && fillFrameTerrain(g, f, zoom));
  if (!live()) return null;
  // An absent building tile is far more often an empty one than a failure, and letting it veto
  // the cache would refetch every tile on each sun change.
  const stamps = buildings ? await stampFrameBuildings(g, f, live) : { picks: new Map<string, Lod2Pick>(), tiles: new Set<string>() };
  return live() ? { stamps, complete } : null;
}

/**
 * `g` laid over `last`'s cells with only the strips it adds built anew, and the cells a changed LoD2 pick
 * reaches rebuilt, which matches a whole stamp; null where it might not, or once superseded.
 */
async function grownMask(last: MaskBuild, g: HeightGrid, f: MaskFrame, zoom: number, buildings: boolean, live: () => boolean): Promise<{ stamps: MaskStamps; complete: boolean } | null> {
  const rects = maskStrips(last.grid, g);
  if (!rects) return null;
  const strips: HeightGrid[] = rects.map((r) => Object.assign(r, { h: new Float32Array(r.nx * r.ny) }));
  let complete = await fillParts(strips, f, zoom, live);
  if (!live()) return null;
  blitGrid(last.grid, g);
  for (const p of strips) blitGrid(p, g);
  if (!buildings) return { stamps: last.stamps, complete };
  const coords = tilesInBounds(frameBounds(f, g), BUILDINGS_ZOOM);
  const keys = coords.map((t) => tileKey(t.z, t.x, t.y));
  // A sliced list or a dropped tile would take away rows `last` stamped.
  if (coords.length > MASK_TILE_MAX || [...last.stamps.tiles].some((k) => !keys.includes(k))) return null;
  // New leaves go into `g` once the rebuilt cells are laid over it.
  const late: Lod2Tile[] = [];
  const picks = await pickLod2(g, f, live, last.stamps.picks, (t) => late.push(t));
  if (!live()) return null;
  const dropped = [...last.stamps.picks.values()].filter((p) => !picks.has(p.c.url));
  const fresh = [...picks.values()].filter((p) => !last.stamps.picks.has(p.c.url));
  const decoded = await Promise.all(coords.map((t) => fetchBuildingBatch(t)));
  if (!live()) return null;
  const lastBox = gridBox(last.grid);
  // A dropped leaf's triangles, and a row whose hiding hull came or went, stand in `last`'s cells.
  const hulls = [...dropped, ...fresh].flatMap((p) => p.rings);
  const hit = hulls.length > 0 ? ringLookup(hulls) : null;
  const stale = dropped.map((p) => lngLatBox(f, p.bbox));
  for (const [i, raw] of decoded.entries()) if (raw && hit && last.stamps.tiles.has(keys[i]) && meets(lngLatBox(f, batchBox(raw)), lastBox)) stale.push(...rowBoxes(f, raw, hit));
  const dirty: HeightGrid[] = dirtyRects(last.grid, g, stale).map((r) => Object.assign(r, { h: new Float32Array(r.nx * r.ny) }));
  complete = (await fillParts(dirty, f, zoom, live)) && complete;
  if (!live()) return null;
  const parts = [...strips, ...dirty];
  const boxes = parts.map(gridBox);
  const into = (b: FrameBox, from: readonly HeightGrid[]) => from.filter((_, i) => meets(b, boxes[i]));
  for (const p of picks.values()) {
    const to = last.stamps.picks.has(p.c.url) ? into(lngLatBox(f, p.bbox), parts) : [];
    if (to.length === 0) continue;
    // oxlint-disable-next-line no-await-in-loop -- one tile in memory at a time
    const t = await fetchLod2Tile(p.c, p.region).catch(() => null);
    if (!t || !live()) return null;
    stampLod2(to, f, t);
  }
  const todo: { raw: DecodedBuildings; into: HeightGrid[]; late: boolean }[] = [];
  const tiles = new Set<string>();
  for (const [i, raw] of decoded.entries()) {
    if (!raw) continue;
    tiles.add(keys[i]);
    const box = lngLatBox(f, batchBox(raw));
    if (!last.stamps.tiles.has(keys[i])) todo.push({ raw, into: [], late: true });
    else if (into(box, parts).length > 0) todo.push({ raw, into: into(box, parts), late: false });
  }
  const grounds = await Promise.all(todo.map(async ({ raw }) => (await groundOf(raw)).groundM));
  if (!live()) return null;
  const hide = hideFor(picks);
  for (const [i, t] of todo.entries()) stampRows(t.into, f, t.raw, grounds[i], hide);
  for (const m of models) stampWorld(parts, f, m.tris);
  for (const p of parts) blitGrid(p, g);
  for (const t of late) stampLod2([g], f, t);
  for (const [i, t] of todo.entries()) if (t.late) stampRows([g], f, t.raw, grounds[i], hide);
  return { stamps: { picks, tiles }, complete };
}

/** Terrain over each of `parts`; false where a DEM tile was missing. */
async function fillParts(parts: readonly HeightGrid[], f: MaskFrame, zoom: number, live: () => boolean): Promise<boolean> {
  if (parts.length === 0) return true;
  const dems = new Map<string, TileCoord>();
  for (const p of parts) for (const t of tilesInBounds(frameBounds(f, p), zoom)) dems.set(tileKey(t.z, t.x, t.y), t);
  return withDemTiles(dem, [...dems.values()], () => live() && parts.map((p) => fillFrameTerrain(p, f, zoom)).every(Boolean));
}

/** Null when a newer mask request has superseded this one. */
async function maskFor(req: MaskRequest): Promise<{ mask: Uint8Array; lod2: Lod2Source[] } | null> {
  const base = `${req.centre.lat.toFixed(6)},${req.centre.lng.toFixed(6)}|${req.cellM}|${req.buildings}|${req.buildings ? `${modelsRev}|${geoidKey}` : 0}`;
  const key = `${base}|${req.originE}|${req.originN}|${req.nx}|${req.ny}`;
  const live = () => latestMask === req.id;
  let built = cachedMask?.key === key ? cachedMask : null;
  if (!built) {
    const frame = maskFrame(req.centre);
    const grid: HeightGrid = { cellM: req.cellM, nx: req.nx, ny: req.ny, originE: req.originE, originN: req.originN, h: new Float32Array(req.nx * req.ny) };
    const zoom = zoomForResolution(req.centre.lat, req.cellM, CEILING_MIN_ZOOM, CEILING_MAX_ZOOM, TERRAIN_TILE_SIZE);
    const last = cachedMask?.base === base ? cachedMask : null;
    const done = (last && (await grownMask(last, grid, frame, zoom, req.buildings, live))) || (live() ? await wholeMask(grid, frame, zoom, req.buildings, live) : null);
    if (!done || !live()) return null;
    built = { key, base, frame, grid, stamps: done.stamps, lod2: [...new Set([...done.stamps.picks.values()].map((p) => p.region.id))] };
    cachedMask = done.complete ? built : null;
  }
  return { mask: shadowMask(built.grid.h, sunCeiling(built.grid, req.sunAzDeg, req.sunAltDeg), req.softM), lod2: built.lod2 };
}

async function shade(req: MaskRequest): Promise<void> {
  const t0 = performance.now();
  const built = await maskFor(req);
  if (!built || latestMask !== req.id) return;
  const { mask, lod2 } = built;
  const { id, centre, originE, originN, nx, ny, cellM } = req;
  // Measured under the sun it was built for, so a later sun can tell how far those shadows move.
  const tallM = Math.max(0, longestShadowM(mask, nx, ny, cellM, req.sunAzDeg) * Math.tan(req.sunAltDeg * (Math.PI / 180)));
  scope.postMessage({ kind: BuildingsKind.Shade, id, centre, originE, originN, nx, ny, cellM, mask, lod2, tallM, ms: performance.now() - t0 } satisfies BuildingsResponse, [mask.buffer]);
}

/** Apex of the LoD2 building under `p` above the ground there; null where none stands. */
async function lod2HeightAt(p: LngLat): Promise<number | null> {
  for (const { c, region } of await lod2Around(p, 1)) {
    // oxlint-disable-next-line no-await-in-loop -- the first tile holding the point answers
    const t = await fetchLod2Tile(c, region).catch(() => null);
    const b = t ? lod2BuildingAt(t, p) : -1;
    if (t && b >= 0) return groundedHeight(t, b, p);
  }
  return null;
}

async function groundedHeight(t: Lod2Tile, b: number, p: LngLat): Promise<number> {
  return lod2HeightAboveM(t.buildings[b], await lowestGroundAt(dem, [p], BUILDING_GROUND_ZOOM, TERRAIN_TILE_SIZE));
}

/** One-shot lookup; it shares the tile cache with the wedge, so a nearby target is usually free. */
async function heightAt(req: HeightAtRequest): Promise<void> {
  const fromLod2 = await lod2HeightAt(req.point);
  const decoded = fromLod2 == null ? await fetchBuildingBatch(tileAt(req.point, BUILDINGS_ZOOM)) : null;
  const heightM = fromLod2 ?? (decoded ? heightAtPoint(suppressRows(decoded, suppress), req.point) : null);
  scope.postMessage({ kind: BuildingsKind.Height, id: req.id, heightM } satisfies BuildingsResponse);
}

/** A building reaching past a 3×3 block of z14 tiles is too big to seed whole. */
const SEED_MAX_TILES = 9;

/** The hit building's rows from every tile it crosses, its pieces rejoined. */
async function rowsAt(req: RowsAtRequest): Promise<void> {
  const first = tileAt(req.point, BUILDINGS_ZOOM);
  const decoded = await fetchBuildingBatch(first);
  const hit = decoded ? groupRowsAt(decoded, req.point) : null;
  if (!hit) {
    scope.postMessage({ kind: BuildingsKind.Rows, id: req.id, batch: null } satisfies BuildingsResponse);
    return;
  }
  const ids = new Set(hit.buildingId.filter((id) => id !== null));
  const got = new Map<string, TileRows>([[tileKey(first.z, first.x, first.y), { tile: first, rows: hit }]]);
  const queue = ids.size > 0 ? edgeNeighbours(hit, first) : [];
  while (queue.length > 0 && got.size < SEED_MAX_TILES) {
    const t = queue.shift()!;
    const key = tileKey(t.z, t.x, t.y);
    if (got.has(key)) continue;
    // oxlint-disable-next-line no-await-in-loop -- each tile names the next ones to fetch
    const more = await fetchBuildingBatch(t);
    const rows = more ? pickRows(more, (i) => ids.has(more.buildingId[i] ?? '')) : null;
    if (!rows || rows.count === 0) continue;
    got.set(key, { tile: t, rows });
    queue.push(...edgeNeighbours(rows, t));
  }
  const merged = got.size > 1 ? mergeTileRows([...got.values()]) : hit;
  const { batch, transfer } = withGround(merged, (await groundOf(merged)).groundM.slice());
  scope.postMessage({ kind: BuildingsKind.Rows, id: req.id, batch } satisfies BuildingsResponse, transfer);
}

async function hiddenIds(req: SuppressedIdsRequest): Promise<void> {
  const tiles = new Map<string, TileCoord>();
  for (const s of suppress) for (const t of suppressRingTiles(s, BUILDINGS_ZOOM)) tiles.set(tileKey(t.z, t.x, t.y), t);
  const batches = await Promise.all([...tiles.values()].map((t) => fetchBuildingBatch(t)));
  const ids = [...new Set(batches.flatMap((b) => (b ? suppressedIds(b, suppress) : [])))];
  scope.postMessage({ kind: BuildingsKind.Ids, id: req.id, ids } satisfies BuildingsResponse);
}

function placed(t: Lod2Tile, c: WalkContent, region: Lod2Region, req: Lod2Request, t0: number): { tile: Lod2Placed; transfer: ArrayBuffer[] } {
  const mesh = placeLod2(t, req.pin, req.eyeM);
  const tris = mesh.plane.length / 4;
  const occ = meshOccluderParts([mesh]);
  const tile: Lod2Placed = { url: c.url, region: region.id, mesh, hulls: t.buildings.map((b) => b.hull), bbox: t.bbox, tris, geoid: t.geoidGrid, occ, ms: performance.now() - t0 };
  const transfer = [mesh.pos, mesh.surfId, mesh.bldgId, mesh.idx, mesh.plane, mesh.surf, mesh.sphere, mesh.size, mesh.box, occ.tris, occ.boxes, occ.nodes].map((a) => a.buffer as ArrayBuffer);
  return { tile, transfer };
}

/** Streams the wedge's LoD2 tiles nearest first until the triangle budget is spent. */
async function lod2Run(req: Lod2Request): Promise<void> {
  const have = new Set(req.have);
  const urls: string[] = [];
  let tris = 0;
  let missing = 0;
  let error: string | null = null;
  const list: { c: WalkContent; region: Lod2Region }[] = [];
  for (const region of lod2RegionsNear(req.pin, req.rangeM)) {
    const view = { pin: req.pin, eyeH: req.eyeM + region.geoidM, pxPerRad: req.pxPerRad, maxErrorPx: LOD2_MAX_ERROR_PX, rangeM: req.rangeM, azFromDeg: req.azFromDeg, azSpanDeg: req.azSpanDeg };
    // oxlint-disable-next-line no-await-in-loop -- regions rarely overlap
    for (const c of await walkRegion(region, view)) list.push({ c, region });
    if (latestLod2 !== req.id) return;
  }
  list.sort((a, b) => a.c.distM - b.c.distM);
  const started = new Map<number, Promise<Lod2Tile | null>>();
  const wanted = () => latestLod2 === req.id;
  const start = (i: number) => {
    if (i >= list.length || started.has(i) || (have.has(list[i].c.url) && lod2Tris.has(list[i].c.url))) return;
    const p = fetchLod2Tile(list[i].c, list[i].region, wanted);
    // A prefetch left behind by a newer request or the budget is never awaited.
    p.catch(() => undefined);
    started.set(i, p);
  };
  for (let i = 0; i < list.length; i++) {
    if (latestLod2 !== req.id) return;
    const { c, region } = list[i];
    const known = have.has(c.url) ? lod2Tris.get(c.url) : undefined;
    if (known !== undefined) {
      if (tris + known > LOD2_VIEW_TRIS) break;
      const cover = lod2Covers.get(c.url);
      if (cover) touchCover(cover);
      tris += known;
      urls.push(c.url);
      continue;
    }
    for (let k = i; k <= i + LOD2_AHEAD; k++) start(k);
    const t0 = performance.now();
    let t: Lod2Tile | null = null;
    try {
      // oxlint-disable-next-line no-await-in-loop -- tiles stream nearest first, one at a time
      t = await started.get(i)!;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    if (latestLod2 !== req.id) return;
    if (!t) {
      missing++;
      continue;
    }
    if (tris + t.idx.length / 3 > LOD2_VIEW_TRIS) break;
    const { tile, transfer } = placed(t, c, region, req, t0);
    lod2Tris.set(c.url, tile.tris);
    touchCover({ url: c.url, bbox: t.bbox, rings: t.buildings.map((b) => suppressRing(b.hull)) });
    tris += tile.tris;
    urls.push(c.url);
    scope.postMessage({ kind: BuildingsKind.Lod2Tile, id: req.id, tile } satisfies BuildingsResponse, transfer);
  }
  if (latestLod2 !== req.id) return;
  scope.postMessage({ kind: BuildingsKind.Lod2Done, id: req.id, urls, tris, missing, error } satisfies BuildingsResponse);
}

async function groundAt(req: GroundAtRequest): Promise<void> {
  const groundM = await lowestGroundAt(dem, req.points, BUILDING_GROUND_ZOOM, TERRAIN_TILE_SIZE);
  scope.postMessage({ kind: BuildingsKind.Ground, id: req.id, groundM } satisfies BuildingsResponse);
}

scope.addEventListener('message', (e: MessageEvent<BuildingsRequest>) => {
  const req = e.data;
  const fail = (err: unknown) => {
    const error = err instanceof Error ? err.message : String(err);
    scope.postMessage({ kind: BuildingsKind.Error, id: req.id, error } satisfies BuildingsResponse);
  };
  // Neither a height lookup nor a shadow field supersedes the wedge, so they leave `latest` alone.
  if (req.kind === BuildingsKind.Models) {
    syncModels(req);
    return;
  }
  if (req.kind === BuildingsKind.Geoid) {
    syncGeoid(req);
    return;
  }
  if (req.kind === BuildingsKind.Stop) {
    latest = latestLod2 = req.id;
    abandonBuildingFetches();
    abandonLod2Fetches();
    return;
  }
  if (req.kind === BuildingsKind.HeightAt) {
    heightAt(req).catch(fail);
    return;
  }
  if (req.kind === BuildingsKind.RowsAt) {
    rowsAt(req).catch(fail);
    return;
  }
  if (req.kind === BuildingsKind.GroundAt) {
    groundAt(req).catch(fail);
    return;
  }
  if (req.kind === BuildingsKind.SuppressedIds) {
    hiddenIds(req).catch(fail);
    return;
  }
  if (req.kind === BuildingsKind.Lod2) {
    latestLod2 = req.id;
    lod2Run(req).catch((err: unknown) => {
      if (latestLod2 !== req.id) return;
      fail(err);
    });
    return;
  }
  if (req.kind === BuildingsKind.Mask) {
    latestMask = req.id;
    shade(req).catch((err: unknown) => {
      if (latestMask !== req.id) return;
      fail(err);
    });
    return;
  }
  latest = req.id;
  run(req).catch((err: unknown) => {
    if (latest !== req.id) return;
    fail(err);
  });
});
