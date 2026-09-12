/// <reference lib="webworker" />
import { bearingDeg, distanceM, intermediatePoint, type LngLat } from '@core/geo/geodesy';
import { elevationAt } from '@core/terrain/dem';
import { planSweep, requiredTiles, sweepHorizon } from '@core/terrain/horizon';
import { analyzeSightline } from '@core/terrain/los';
import { lngLatToTilePixel, metersPerPixel, tileKey, zoomForResolution, type TileCoord } from '@core/terrain/tiles';
import { DemCache, POINT_ZOOM } from '@data/terrainTiles';
import { TerrainKind, type ElevationRequest, type HorizonRequest, type ProfileRequest, type TerrainRequest, type TerrainResponse } from './terrain.protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const cache = new DemCache(220);
/** Newest request id per kind; older ones stop before the expensive step. */
const latest: Record<TerrainKind, number> = { Elevation: 0, Profile: 0, Horizon: 0 };

function tileAt(p: LngLat, z: number): TileCoord {
  const t = lngLatToTilePixel(p.lng, p.lat, z);
  return { z, x: t.x, y: t.y };
}

async function groundAt(p: LngLat): Promise<number> {
  await cache.load(tileAt(p, POINT_ZOOM));
  return elevationAt(cache, p.lng, p.lat, POINT_ZOOM);
}

async function elevation(req: ElevationRequest): Promise<TerrainResponse> {
  const elevations = await Promise.all(req.points.map(groundAt));
  return { kind: TerrainKind.Elevation, id: req.id, elevations };
}

async function profile(req: ProfileRequest): Promise<TerrainResponse | null> {
  const { a, b, samples: n } = req;
  const totalM = distanceM(a, b);
  const zoom = zoomForResolution((a.lat + b.lat) / 2, Math.max(1, totalM / n), 6, 14);
  const lng = new Float32Array(n);
  const lat = new Float32Array(n);
  const distM = new Float32Array(n);
  const tiles = new Map<string, TileCoord>();
  for (let i = 0; i < n; i++) {
    const p = intermediatePoint(a, b, i / (n - 1));
    lng[i] = p.lng;
    lat[i] = p.lat;
    distM[i] = (totalM * i) / (n - 1);
    const t = tileAt(p, zoom);
    tiles.set(tileKey(t.z, t.x, t.y), t);
  }
  await cache.loadAll([...tiles.values()]);
  if (latest.Profile !== req.id) return null;

  const groundM = new Float32Array(n);
  let missing = 0;
  for (let i = 0; i < n; i++) {
    groundM[i] = elevationAt(cache, lng[i], lat[i], zoom);
    if (Number.isNaN(groundM[i])) missing++;
  }
  // Endpoints come from the same zoom as the path so their own cells cannot "block" them.
  const groundA = Number.isNaN(groundM[0]) ? 0 : groundM[0];
  const groundB = Number.isNaN(groundM[n - 1]) ? 0 : groundM[n - 1];
  // Water reads as bathymetry in Terrarium; sightlines skim the surface instead.
  const eyeM = Math.max(groundA, 0) + req.eyeAboveGroundM;
  const targetM = Math.max(groundB, 0) + req.targetAboveGroundM;
  const cellM = metersPerPixel((a.lat + b.lat) / 2, zoom);
  const los = analyzeSightline(distM, groundM.map((g) => (Number.isNaN(g) ? g : Math.max(g, 0))), eyeM, targetM, cellM);
  return {
    kind: TerrainKind.Profile,
    id: req.id,
    result: { a, b, totalM, bearingDeg: bearingDeg(a, b), backBearingDeg: bearingDeg(b, a), zoom, distM, groundM, lng, lat, groundA, groundB, eyeM, targetM, los, missing }
  };
}

async function horizon(req: HorizonRequest): Promise<TerrainResponse | null> {
  const g = await groundAt(req.pin);
  const groundM = Number.isNaN(g) ? 0 : g;
  const plan = planSweep(req.pin, req.rangeM, { azStepDeg: req.azStepDeg });
  const tiles = requiredTiles(plan);
  await cache.loadAll(tiles);
  if (latest.Horizon !== req.id) return null;
  const eyeM = Math.max(groundM, 0) + req.eyeAboveGroundM;
  const skyline = sweepHorizon(cache, plan, eyeM, req.eyeAboveGroundM, req.rangeM);
  const missing = tiles.filter((t) => !cache.get(t.z, t.x, t.y)).length;
  return { kind: TerrainKind.Horizon, id: req.id, result: { profile: skyline, groundM, eyeM, tiles: tiles.length, missing } };
}

scope.addEventListener('message', (e: MessageEvent<TerrainRequest>) => {
  const req = e.data;
  latest[req.kind] = req.id;
  const run = req.kind === TerrainKind.Elevation ? elevation(req) : req.kind === TerrainKind.Profile ? profile(req) : horizon(req);
  run.then(
    (res) => {
      if (res) scope.postMessage(res);
    },
    (err: unknown) => {
      const error = err instanceof Error ? err.message : String(err);
      scope.postMessage({ kind: 'Error', id: req.id, of: req.kind, error } satisfies TerrainResponse);
    }
  );
});
