/**
 * Offline precision audit of the horizon sweep against a full-resolution ray march:
 *   bun scripts/horizon-audit.ts <tile cache dir> [scene ...]
 * Fetches Mapterhorn tiles (decoded with ImageMagick's `magick`) into the cache dir, never the repo.
 */
/* oxlint-disable no-await-in-loop -- scenes and timing runs go one at a time on purpose */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Observer } from 'astronomy-engine';
import { elevationAngleDeg, type LngLat } from '../src/lib/core/geo/geodesy';
import { pinFrame } from '../src/lib/core/geo/pinFrame';
import { dayCurve } from '../src/lib/core/astro/dayCurve';
import { terrainRiseSet } from '../src/lib/core/astro/terrainEvents';
import { SkyBody } from '../src/lib/core/astro/bodies';
import { decodeTerrarium, elevationAtCubic, groundSurface, overzoomTile, BelowSea, type DemSource, type DemTile } from '../src/lib/core/terrain/dem';
import { planSweep, refineHorizon, requiredTiles, sweepHorizon, type HorizonProfile, type RefineOptions, type SweepOptions } from '../src/lib/core/terrain/horizon';
import { lngLatToTilePixel, metersPerPixel, zoomForResolution, tileKey, type TileCoord } from '../src/lib/core/terrain/tiles';

const SIZE = 512;
const RANGE_M = 100_000;
const AZ_STEP = 0.5;
const EYE_AGL_M = 1.6;
/** Reference: cells at most this fraction of distance, capped at REF_MAX_Z, stepped at half a cell. */
const REF_FRAC = 0.0001;
const REF_MAX_Z = 15;

const scenes: Record<string, LngLat> = {
  zermatt: { lng: 7.7491, lat: 46.0207 },
  bern: { lng: 7.4474, lat: 46.948 },
  palisades: { lng: -73.973, lat: 40.796 },
  denver: { lng: -104.9903, lat: 39.7392 },
  seattle: { lng: -122.3321, lat: 47.6062 },
  polder: { lng: 4.605, lat: 52.001 }
};

const cacheDir = process.argv[2];
if (!cacheDir) throw new Error('usage: bun scripts/horizon-audit.ts <tile cache dir> [scene ...]');
const pick = process.argv.slice(3);

/** Disk-backed tile store; absent tiles are overzoomed from their deepest ancestor like the worker's cache. */
class Store implements DemSource {
  tiles = new Map<string, DemTile | null>();
  private inflight = new Map<string, Promise<DemTile | null>>();
  fetched = 0;

  get(z: number, x: number, y: number) {
    return this.tiles.get(tileKey(z, x, y));
  }

  async ensure(coords: TileCoord[]) {
    const queue = [...coords];
    const work = async () => {
      for (let c = queue.pop(); c; c = queue.pop()) await this.load(c);
    };
    await Promise.all(Array.from({ length: 12 }, work));
  }

  load(c: TileCoord): Promise<DemTile | null> {
    const k = tileKey(c.z, c.x, c.y);
    const have = this.tiles.get(k);
    if (have !== undefined) return Promise.resolve(have);
    let p = this.inflight.get(k);
    if (!p) {
      p = this.read(c).then((t) => {
        this.tiles.set(k, t);
        this.inflight.delete(k);
        return t;
      });
      this.inflight.set(k, p);
    }
    return p;
  }

  private async read(c: TileCoord): Promise<DemTile | null> {
    const dir = join(cacheDir, `${c.z}`, `${c.x}`);
    const f32 = join(dir, `${c.y}.f32`);
    const absent = join(dir, `${c.y}.absent`);
    if (existsSync(f32)) return { ...c, size: SIZE, elev: new Float32Array(readFileSync(f32).buffer.slice(0)) };
    if (!existsSync(absent)) {
      const res = await fetch(`https://tiles.mapterhorn.com/${c.z}/${c.x}/${c.y}.webp`, { headers: { 'User-Agent': 'scape-horizon-audit' } });
      mkdirSync(dir, { recursive: true });
      if (res.ok) {
        const proc = Bun.spawn(['magick', 'webp:-', '-depth', '8', 'RGBA:-'], { stdin: new Uint8Array(await res.arrayBuffer()), stdout: 'pipe' });
        const rgba = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
        if (rgba.length !== SIZE * SIZE * 4) throw new Error(`decode ${tileKey(c.z, c.x, c.y)}: ${rgba.length} bytes`);
        const elev = groundSurface(decodeTerrarium(rgba, SIZE, 4).elev, BelowSea.Land);
        writeFileSync(f32, new Uint8Array(elev.buffer));
        this.fetched++;
        return { ...c, size: SIZE, elev };
      }
      if (res.status !== 404 && res.status !== 403) throw new Error(`fetch ${tileKey(c.z, c.x, c.y)}: ${res.status}`);
      writeFileSync(absent, '');
    }
    if (c.z === 0) return null;
    const parent = await this.load({ z: c.z - 1, x: c.x >> 1, y: c.y >> 1 });
    return parent ? overzoomTile(parent, c) : null;
  }
}

function tileOf(lng: number, lat: number, z: number): TileCoord {
  const t = lngLatToTilePixel(lng, lat, z);
  return { z, x: t.x, y: t.y };
}

/** Bilinear read plus the range of the 3x3 posts around it, for the reference's candidate bound. */
function readWithRange(src: DemSource, lng: number, lat: number, z: number): { g: number; hi: number } {
  const t = lngLatToTilePixel(lng, lat, z, 1);
  const tile = src.get(t.z, t.x, t.y);
  if (!tile) return { g: NaN, hi: NaN };
  const s = tile.size;
  const fx = Math.min(Math.max(t.px * s - 0.5, 0), s - 1);
  const fy = Math.min(Math.max(t.py * s - 0.5, 0), s - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  let lo = Infinity;
  let hi = -Infinity;
  for (let dy = -1; dy <= 2; dy++)
    for (let dx = -1; dx <= 2; dx++) {
      const v = tile.elev[Math.min(Math.max(y0 + dy, 0), s - 1) * s + Math.min(Math.max(x0 + dx, 0), s - 1)];
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  const x1 = Math.min(x0 + 1, s - 1);
  const y1 = Math.min(y0 + 1, s - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const e = tile.elev;
  const g = (e[y0 * s + x0] * (1 - tx) + e[y0 * s + x1] * tx) * (1 - ty) + (e[y1 * s + x0] * (1 - tx) + e[y1 * s + x1] * tx) * ty;
  return { g, hi: hi + (hi - lo) };
}

/**
 * Reference skyline: a sweep at 0.1 % of distance (capped at REF_MAX_Z) finds candidates with a generous
 * bound, then every candidate stretch is re-marched at REF_FRAC and half-cell steps.
 */
async function reference(store: Store, pin: LngLat, eyeM: number, marginM: number, frac = REF_FRAC, maxZ = REF_MAX_Z): Promise<HorizonProfile> {
  const plan = planSweep(pin, RANGE_M, { azStepDeg: AZ_STEP, minZoom: 5, maxZoom: maxZ, tileSize: SIZE, stepFraction: 0.001 });
  await store.ensure(requiredTiles(plan));
  const frame = pinFrame(pin);
  const angleDeg = new Float32Array(plan.nAz);
  const distM = new Float32Array(plan.nAz);
  const spans: { i: number; d0: number; d1: number }[] = [];
  const lowBest = new Float64Array(plan.nAz);
  for (let i = 0; i < plan.nAz; i++) {
    const n = plan.start[i + 1] - plan.start[i];
    const up = new Float64Array(n);
    let best = -Infinity;
    for (let j = plan.start[i], k = 0; j < plan.start[i + 1]; j++, k++) {
      const r = readWithRange(store, plan.lng[j], plan.lat[j], plan.zoom[j]);
      const a = elevationAngleDeg(plan.distM[j], r.g - eyeM);
      if (a > best) {
        best = a;
        distM[i] = plan.distM[j];
      }
      up[k] = elevationAngleDeg(plan.distM[j], r.hi + marginM - eyeM);
    }
    lowBest[i] = best;
    angleDeg[i] = best;
    for (let j = plan.start[i], k = 0; j < plan.start[i + 1]; j++, k++) {
      if (up[k] < best) continue;
      const cell = metersPerPixel(pin.lat, plan.zoom[j], SIZE);
      const d0 = Math.max(plan.distM[plan.start[i]], plan.distM[j] - 2 * cell);
      const d1 = Math.min(RANGE_M, plan.distM[j] + 2 * cell);
      const last = spans[spans.length - 1];
      if (last && last.i === i && d0 <= last.d1) last.d1 = Math.max(last.d1, d1);
      else spans.push({ i, d0, d1 });
    }
  }
  // Fine samples per span, tiles gathered first so every read is resident.
  const fine: { i: number; lng: Float64Array; lat: Float64Array; d: Float64Array; z: Uint8Array }[] = [];
  const need = new Map<string, TileCoord>();
  for (const s of spans) {
    const az = (plan.azFromDeg + s.i * AZ_STEP) * (Math.PI / 180);
    const ds: number[] = [];
    const zs: number[] = [];
    for (let d = s.d0; d <= s.d1; ) {
      const z = zoomForResolution(pin.lat, frac * d, 5, maxZ, SIZE);
      ds.push(d);
      zs.push(z);
      d += 0.5 * metersPerPixel(pin.lat, z, SIZE);
    }
    const lng = new Float64Array(ds.length);
    const lat = new Float64Array(ds.length);
    for (let k = 0; k < ds.length; k++) {
      const p = frame.fromEn(ds[k] * Math.sin(az), ds[k] * Math.cos(az));
      lng[k] = p.lng;
      lat[k] = p.lat;
      const t = tileOf(p.lng, p.lat, zs[k]);
      need.set(tileKey(t.z, t.x, t.y), t);
    }
    fine.push({ i: s.i, lng, lat, d: Float64Array.from(ds), z: Uint8Array.from(zs) });
  }
  await store.ensure([...need.values()]);
  // A candidate stretch replaces the coarse reads it covers; the coarse best only stands where nothing was refined.
  const refined = new Float64Array(plan.nAz).fill(-Infinity);
  const refinedD = new Float32Array(plan.nAz);
  for (const f of fine)
    for (let k = 0; k < f.d.length; k++) {
      const t = lngLatToTilePixel(f.lng[k], f.lat[k], f.z[k], 1);
      const tile = store.get(t.z, t.x, t.y);
      if (!tile) continue;
      const g = readWithRange({ get: () => tile }, f.lng[k], f.lat[k], f.z[k]).g;
      const a = elevationAngleDeg(f.d[k], g - eyeM);
      if (a > refined[f.i]) {
        refined[f.i] = a;
        refinedD[f.i] = f.d[k];
      }
    }
  for (let i = 0; i < plan.nAz; i++)
    if (refined[i] > -Infinity) {
      angleDeg[i] = refined[i];
      distM[i] = refinedD[i];
    }
  console.log(`  reference: ${spans.length} spans, ${need.size} fine tiles, coarse→fine max lift ${Math.max(...Array.from(angleDeg, (a, i) => a - lowBest[i])).toFixed(3)}°`);
  return { azStepDeg: AZ_STEP, angleDeg, distM, rangeM: RANGE_M };
}

const REFINE = JSON.parse(process.env.AUDIT_REFINE ?? '{}') as RefineOptions;

/** The worker's horizon request, in 512 px terms. */
const APP_SWEEP: SweepOptions = { azStepDeg: AZ_STEP, minZoom: 7, maxZoom: 13, tileSize: SIZE };

async function appSweep(store: Store, pin: LngLat, eyeM: number, refine: boolean): Promise<{ h: HorizonProfile; tiles: number; ms: number }> {
  const plan = planSweep(pin, RANGE_M, APP_SWEEP);
  const tiles = requiredTiles(plan);
  await store.ensure(tiles);
  const t0 = performance.now();
  if (!refine) {
    const h = sweepHorizon(store, plan, eyeM, EYE_AGL_M, RANGE_M);
    return { h, tiles: tiles.length, ms: performance.now() - t0 };
  }
  const r = refineHorizon(store, plan, eyeM, EYE_AGL_M, RANGE_M, { minZoom: 7, maxZoom: 15, ...REFINE, tileSize: SIZE });
  const planMs = performance.now() - t0;
  await store.ensure(r.tiles);
  const t1 = performance.now();
  const h = r.sweep(store);
  const fineMs = performance.now() - t1;
  if (process.env.AUDIT_SPLIT) {
    const byZ = new Map<number, number>();
    for (const t of r.tiles) byZ.set(t.z, (byZ.get(t.z) ?? 0) + 1);
    const zs = [...byZ].toSorted((a, b) => a[0] - b[0]).map(([z, c]) => `z${z}:${c}`);
    console.log(`    coarse+plan ${planMs.toFixed(0)} fine ${fineMs.toFixed(0)} ms, ${r.samples} fine samples of ${plan.distM.length}, fine tiles ${zs.join(' ')}`);
  }
  return { h, tiles: tiles.length + r.tiles.length, ms: planMs + fineMs };
}

function pct(xs: number[], p: number): number {
  const s = xs.toSorted((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

function compare(ref: HorizonProfile, h: HorizonProfile) {
  const low: number[] = [];
  const lowM: number[] = [];
  let high = 0;
  for (let i = 0; i < ref.angleDeg.length; i++) {
    const e = ref.angleDeg[i] - h.angleDeg[i];
    low.push(Math.abs(e));
    lowM.push(Math.abs(e) * (Math.PI / 180) * ref.distM[i]);
    high = Math.max(high, -e);
  }
  const at = low.indexOf(Math.max(...low));
  return { max: low[at], p95: pct(low, 0.95), maxM: Math.max(...lowM), p95M: pct(lowM, 0.95), high, atAz: at * AZ_STEP, atKm: ref.distM[at] / 1000 };
}

/** Largest |Δt| of the Sun's terrain rise/set between two skylines, over four days of the year. */
function riseSetShift(pin: LngLat, eyeM: number, a: HorizonProfile, b: HorizonProfile): number {
  const obs = new Observer(pin.lat, pin.lng, eyeM);
  let worst = 0;
  for (const day of ['2026-03-20', '2026-06-21', '2026-09-23', '2026-12-21']) {
    const start = Date.parse(`${day}T00:00:00Z`) - (pin.lng / 15) * 3_600_000;
    const curve = dayCurve(obs, start, start + 86_400_000);
    const ea = terrainRiseSet(obs, curve, a, start + 86_400_000).filter((e) => e.body === SkyBody.Sun);
    const eb = terrainRiseSet(obs, curve, b, start + 86_400_000).filter((e) => e.body === SkyBody.Sun);
    for (const e of ea) {
      const m = eb.filter((f) => f.kind === e.kind).map((f) => Math.abs(f.time - e.time));
      if (m.length) worst = Math.max(worst, Math.min(...m) / 1000);
    }
  }
  return worst;
}

const fmt = (c: ReturnType<typeof compare>) =>
  `max ${c.max.toFixed(4)}° (${c.maxM.toFixed(1)} m, az ${c.atAz} at ${c.atKm.toFixed(1)} km)  p95 ${c.p95.toFixed(4)}° (${c.p95M.toFixed(1)} m)  reads high ≤${c.high.toFixed(4)}°`;

for (const [name, pin] of Object.entries(scenes)) {
  if (pick.length && !pick.includes(name)) continue;
  const store = new Store();
  const pinTiles = [tileOf(pin.lng, pin.lat, 17)];
  await store.ensure(pinTiles);
  const ground = elevationAtCubic(store, pin.lng, pin.lat, 17);
  const eyeM = (Number.isNaN(ground) ? 0 : ground) + EYE_AGL_M;
  console.log(`${name} (${pin.lng}, ${pin.lat}) eye ${eyeM.toFixed(1)} m`);
  const ref = await reference(store, pin, eyeM, 20);
  if (process.env.AUDIT_CONVERGE) {
    const ref2 = await reference(store, pin, eyeM, 80, REF_FRAC / 2, REF_MAX_Z + 1);
    console.log(`  reference vs 2x finer + 4x margin: ${fmt(compare(ref2, ref))}`);
  }
  for (const refine of [false, true]) {
    const runs = [];
    for (let k = 0; k < 5; k++) runs.push(await appSweep(store, pin, eyeM, refine));
    const { h, tiles } = runs[0];
    const ms = runs.map((r) => r.ms).toSorted((a, b) => a - b)[2];
    if (process.env.AUDIT_WORST)
      for (const i of Array.from(ref.angleDeg.keys()).toSorted((a, b) => Math.abs(ref.angleDeg[b] - h.angleDeg[b]) - Math.abs(ref.angleDeg[a] - h.angleDeg[a])).slice(0, +process.env.AUDIT_WORST))
        console.log(`    az ${i * AZ_STEP}: ref ${ref.angleDeg[i].toFixed(4)}° @${ref.distM[i].toFixed(0)} m, got ${h.angleDeg[i].toFixed(4)}° @${h.distM[i].toFixed(0)} m`);
    console.log(`  ${refine ? 'refined' : 'current'}: ${fmt(compare(ref, h))}  tiles ${tiles}  sweep ${ms.toFixed(0)} ms  sun rise/set shift ≤${riseSetShift(pin, eyeM, ref, h).toFixed(0)} s`);
  }
  console.log(`  fetched ${store.fetched} new tiles`);
}
