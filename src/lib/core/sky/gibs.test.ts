import { describe, expect, it } from 'vitest';
import type { LngLat } from '@core/geo/geodesy';
import { decodeIndexedPng } from '@core/terrain/png';
import { encodeIndexedPng } from '@core/terrain/pngFixture';
import { cdm2ToMag, magToCdm2, NATURAL_SKY_MAG } from './brightness';
import {
  GIBS_FAR_NIGHTS,
  GIBS_FAR_ZOOM,
  GIBS_NEAR_KM,
  GIBS_NEAR_ZOOM,
  GIBS_NIGHTS,
  GIBS_RADIANCE,
  GIBS_SAT_COUNT,
  GIBS_SATURATED,
  GIBS_TILE_PX,
  gibsFarNights,
  gibsNights,
  gibsNightTiles,
  gibsPlan,
  gibsTileKey,
  isStale,
  medianWindow,
  mercX,
  mercY,
  probeDates,
  type GibsNight,
  type GibsTile
} from './gibs';
import { histSum, radialHistogram } from './radial';
import { altitudeFactor, KM_PER_DEG_LAT, KM_PER_DEG_LON, referenceBins, SKYGLOW_PARAMS, skyglowFrom } from './skyglow';
import { VIIRS_PX_PER_DEG, windowAround } from './viirs';

const CHERRY: LngLat = { lat: 41.66, lng: -77.82 };
const DAY = 86_400_000;

/** gibs_windows.py's zoom and tile for one window pixel. */
function pyPixel(p: LngLat, row: number, col: number): { z: number; y: number; x: number } {
  const lat = 90 - (row + 0.5) / VIIRS_PX_PER_DEG;
  const lng = (col + 0.5) / VIIRS_PX_PER_DEG - 180;
  const dy = (lat - p.lat) * KM_PER_DEG_LAT;
  const dlon = lng - p.lng;
  const dx = (dlon - 360 * Math.round(dlon / 360)) * KM_PER_DEG_LON * Math.cos((p.lat * Math.PI) / 180);
  const z = Math.hypot(dx, dy) > GIBS_NEAR_KM ? GIBS_FAR_ZOOM : GIBS_NEAR_ZOOM;
  return { z, y: mercY(lat, z), x: mercX(lng, z) };
}

const tileSet = (ts: GibsTile[]) => new Set(ts.map(gibsTileKey));

/** Deterministic 0–180 palette indices, some no data. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

function synthNights(tiles: GibsTile[], n: number, seed: number): GibsNight[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => {
    const m = new Map<string, Uint8Array | null>();
    for (const t of tiles) {
      if (r() < 0.1) {
        m.set(gibsTileKey(t), null);
        continue;
      }
      const px = new Uint8Array(GIBS_TILE_PX * GIBS_TILE_PX);
      for (let i = 0; i < px.length; i++) {
        const u = r();
        px[i] = u < 0.2 ? 0 : u > 0.97 ? GIBS_SATURATED : 1 + Math.floor(r() * 179);
      }
      m.set(gibsTileKey(t), px);
    }
    return m;
  });
}

const roundHalfEven = (x: number) => {
  const r = Math.round(x);
  return r - x === 0.5 && r % 2 !== 0 ? r - 1 : r;
};

/** Literal per-pixel port of gibs_windows.py's stack, sort and median; far pixels stack only the far nights. */
function pyMedian(p: LngLat, win: { row0: number; col0: number; rows: number; cols: number }, nights: GibsNight[], far: number[]): Uint16Array {
  const out = new Uint16Array(win.rows * win.cols);
  for (let r = 0; r < win.rows; r++)
    for (let c = 0; c < win.cols; c++) {
      const { z, y, x } = pyPixel(p, win.row0 + r, win.col0 + c);
      const key = gibsTileKey({ z, row: Math.floor(y / 256), col: Math.floor(x / 256) });
      const stack = nights.filter((_, i) => z === GIBS_NEAR_ZOOM || far.includes(i)).map((n) => {
        const v = n.get(key)?.[(y % 256) * 256 + (x % 256)] ?? 0;
        return v === 0 ? 255 : v;
      });
      stack.sort((a, b) => a - b);
      const n = stack.filter((v) => v !== 255).length;
      const lo = stack[Math.max(0, (n - 1) >> 1)];
      const hi = stack[Math.max(0, n >> 1)];
      const med = n > 0 ? (GIBS_RADIANCE[lo === 255 ? 0 : lo] + GIBS_RADIANCE[hi === 255 ? 0 : hi]) / 2 : 0;
      const sat = n > 0 && lo === GIBS_SATURATED && hi === GIBS_SATURATED;
      out[r * win.cols + c] = sat ? GIBS_SAT_COUNT : Math.min(GIBS_SAT_COUNT - 1, Math.max(0, roundHalfEven(med / 0.01)));
    }
  return out;
}

/** One constant palette index per tile, for readable medians. */
const flat = (tiles: GibsTile[], v: number | null): GibsNight => new Map(tiles.map((t) => [gibsTileKey(t), v === null ? null : new Uint8Array(GIBS_TILE_PX * GIBS_TILE_PX).fill(v)]));

describe('GIBS colormap', () => {
  it('reads bin midpoints, the fixed ref 91 and the saturated floor', () => {
    expect(GIBS_RADIANCE[0]).toBe(0);
    expect(GIBS_RADIANCE[1]).toBeCloseTo(0.05, 12);
    expect(GIBS_RADIANCE[91]).toBeCloseTo(9.9, 12);
    expect(GIBS_RADIANCE[179]).toBeCloseTo(37.9, 12);
    expect(GIBS_SATURATED).toBe(180);
    expect(GIBS_RADIANCE[180]).toBe(38.2);
    expect(GIBS_SAT_COUNT).toBe(3820);
    for (let i = 2; i <= 180; i++) expect(GIBS_RADIANCE[i]).toBeGreaterThan(GIBS_RADIANCE[i - 1]);
  });
});

describe('gibsPlan', () => {
  it('reads z8 within 32 km and z6 beyond, only tiles that hold a pixel', () => {
    const win = windowAround(CHERRY, 60);
    const plan = gibsPlan(CHERRY, win);
    const need = new Set<string>();
    for (let r = 0; r < win.rows; r++)
      for (let c = 0; c < win.cols; c++) {
        const { z, y, x } = pyPixel(CHERRY, win.row0 + r, win.col0 + c);
        need.add(gibsTileKey({ z, row: Math.floor(y / 256), col: Math.floor(x / 256) }));
      }
    expect(tileSet(plan.tiles)).toEqual(need);
    expect(plan.tiles.some((t) => t.z === GIBS_NEAR_ZOOM)).toBe(true);
    expect(plan.tiles.some((t) => t.z === GIBS_FAR_ZOOM)).toBe(true);
  });

  it('needs no z6 inside 32 km, and a dozen tiles at full reach', () => {
    expect(gibsPlan(CHERRY, windowAround(CHERRY, 20)).tiles.every((t) => t.z === GIBS_NEAR_ZOOM)).toBe(true);
    const full = gibsPlan(CHERRY).tiles;
    expect(full.filter((t) => t.z === GIBS_NEAR_ZOOM).length).toBeLessThanOrEqual(4);
    expect(full.length).toBeGreaterThan(4);
    expect(full.length).toBeLessThanOrEqual(16);
  });
});

const isNear = (k: string) => k.startsWith(`${GIBS_NEAR_ZOOM}/`);
/** Mean of the bins' midpoints, in counts. */
const count = (...i: number[]) => Math.round(i.reduce((a, j) => a + GIBS_RADIANCE[j], 0) / i.length / 0.01);

describe('medianWindow', () => {
  const plan = gibsPlan(CHERRY, windowAround(CHERRY, 5));
  const at = (nights: GibsNight[]) => medianWindow(plan, nights).data[0];

  it('takes the middle bin, or the mean of the middle two, without no data', () => {
    expect(at([flat(plan.tiles, 3), flat(plan.tiles, 1), flat(plan.tiles, 2)])).toBe(15);
    expect(at([flat(plan.tiles, 10), flat(plan.tiles, 20), flat(plan.tiles, 0), flat(plan.tiles, null)])).toBe(145);
    expect(at([flat(plan.tiles, 0), flat(plan.tiles, null)])).toBe(0);
  });

  it('marks saturation only when both middle bins are saturated', () => {
    expect(at([flat(plan.tiles, 180), flat(plan.tiles, 180), flat(plan.tiles, 5)])).toBe(GIBS_SAT_COUNT);
    expect(at([flat(plan.tiles, 180), flat(plan.tiles, 179)])).toBe(3805);
  });

  it('matches gibs_windows.py pixel for pixel across the z8/z6 seam', () => {
    const p = gibsPlan(CHERRY, windowAround(CHERRY, 40));
    const nights = synthNights(p.tiles, 8, 7);
    const got = medianWindow(p, nights);
    expect(got).toMatchObject({ scale: 0.01, satCount: GIBS_SAT_COUNT });
    expect(Array.from(got.data)).toEqual(Array.from(pyMedian(CHERRY, p.win, nights, gibsFarNights())));
    expect(Array.from(medianWindow(p, nights, [0, 1, 2, 3, 4, 5, 6, 7]).data)).toEqual(Array.from(pyMedian(CHERRY, p.win, nights, [0, 1, 2, 3, 4, 5, 6, 7])));
  });

  it('reads far pixels from the far nights only, near pixels from all', () => {
    const p = gibsPlan(CHERRY, windowAround(CHERRY, 40));
    // Near tiles read 1…8 by night; far tiles read 2 except far nights 0 and 7, which read 1 and 8.
    const night = (i: number, farV: number | null) => new Map([...flat(p.tiles, i + 1)].map(([k, v]) => [k, isNear(k) ? v : farV === null ? null : v!.fill(farV)]));
    const nights = Array.from({ length: 8 }, (_, i) => night(i, i === 0 ? 1 : i === 7 ? 8 : 2));
    // A pixel on the point's row, km east.
    const px = (w: { data: Uint16Array }, km: number) => w.data[p.dy2.indexOf(Math.min(...p.dy2)) * p.win.cols + p.dx2.findIndex((d) => Math.abs(Math.sqrt(d) - km) < 0.4)];
    const got = medianWindow(p, nights, [0, 7]);
    expect(px(got, 5)).toBe(count(4, 5));
    expect(px(got, 38)).toBe(count(1, 8));
    // A far night without data leaves the other.
    nights[7] = night(7, null);
    expect(px(medianWindow(p, nights, [0, 7]), 38)).toBe(count(1));
  });

  it('decodes paletted tiles into the same median', async () => {
    const nights = synthNights(plan.tiles, 3, 11);
    const png = await Promise.all(
      nights.map(async (n) => new Map(await Promise.all([...n].map(async ([k, v]) => [k, v && (await decodeIndexedPng(encodeIndexedPng(GIBS_TILE_PX, GIBS_TILE_PX, v))).index] as const))))
    );
    expect(Array.from(medianWindow(plan, png).data)).toEqual(Array.from(medianWindow(plan, nights).data));
  });
});

describe('calibration equivalence', () => {
  it('predicts what calibrate.ts --windows does for the same window', () => {
    const plan = gibsPlan(CHERRY, windowAround(CHERRY, 40));
    const win = medianWindow(plan, synthNights(plan.tiles, 8, 3));
    const elevM = 700;
    const h = radialHistogram(win, CHERRY);
    const lambda = SKYGLOW_PARAMS.lambdaKm;
    const calibrated = cdm2ToMag(magToCdm2(NATURAL_SKY_MAG) + SKYGLOW_PARAMS.k * (histSum(h.lit, lambda) + histSum(h.sat, lambda)) * altitudeFactor(elevM));
    const app = skyglowFrom(referenceBins(win, CHERRY.lat, CHERRY.lng, lambda), elevM, SKYGLOW_PARAMS).mag;
    expect(Math.abs(app - calibrated)).toBeLessThan(0.005);
  });
});

describe('GIBS nights', () => {
  it('spreads the far nights from the newest to the oldest', () => {
    expect(gibsFarNights(8, 2)).toEqual([0, 7]);
    expect(gibsFarNights(8, 3)).toEqual([0, 4, 7]);
    expect(gibsFarNights(8, 4)).toEqual([0, 2, 5, 7]);
    expect(gibsFarNights(8, 8)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(gibsFarNights(3, 4)).toEqual([0, 1, 2]);
    expect(gibsFarNights(8, 1)).toEqual([0]);
    expect(gibsFarNights().length).toBe(GIBS_FAR_NIGHTS);
  });

  it('fetches near tiles every night and far tiles on the far nights', () => {
    const plan = gibsPlan(CHERRY);
    const per = gibsNightTiles(plan, GIBS_NIGHTS);
    const near = plan.tiles.filter((t) => t.z === GIBS_NEAR_ZOOM);
    const far = gibsFarNights();
    expect(per).toHaveLength(GIBS_NIGHTS);
    for (const [i, ts] of per.entries()) expect(ts).toEqual(far.includes(i) ? plan.tiles : near);
    expect(per.flat().length).toBe(GIBS_NIGHTS * near.length + GIBS_FAR_NIGHTS * (plan.tiles.length - near.length));
  });

  it('steps back 8 days from the newest night', () => {
    expect(gibsNights('2026-09-20')).toEqual(['2026-09-20', '2026-09-12', '2026-09-04', '2026-08-27', '2026-08-19', '2026-08-11', '2026-08-03', '2026-07-26']);
  });

  it('probes from today back', () => {
    const d = probeDates(Date.parse('2026-09-25T12:00:00Z'), 3);
    expect(d).toEqual(['2026-09-25', '2026-09-24', '2026-09-23', '2026-09-22']);
  });

  it('looks the newest night up again after 30 days or a clock change', () => {
    const t = Date.parse('2026-09-01T00:00:00Z');
    expect(isStale(t, t)).toBe(false);
    expect(isStale(t, t + 29 * DAY)).toBe(false);
    expect(isStale(t, t + 30 * DAY)).toBe(true);
    expect(isStale(t, t - 1)).toBe(true);
  });
});
