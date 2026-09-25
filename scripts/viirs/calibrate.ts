/**
 * Fits SKYGLOW_PARAMS (k, λ) to the published zenith brightness in skyglow.sites.ts and prints residuals.
 *   bun scripts/viirs/calibrate.ts --h5 <dir of VNP46A4 .h5 tiles>
 *   bun scripts/viirs/calibrate.ts --windows <dir of <site>.u16 + <site>.json 15" count windows> [--sat] [--basket <dir>]
 * --sat also fits one gain for saturated pixels (json satCount); --basket scores the fit on basket.ts windows.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bytesSource } from '../../src/lib/core/io/hdf5';
import { bortleOf, cdm2ToMag, magToCdm2, NATURAL_SKY_MAG } from '../../src/lib/core/sky/brightness';
import { histSum, radialHistogram, type Hist, type Win } from '../../src/lib/core/sky/radial';
import { altitudeFactor, REACH_KM, SKYGLOW_PARAMS } from '../../src/lib/core/sky/skyglow';
import { SQM_SITES } from '../../src/lib/core/sky/skyglow.sites';
import { decodeViirsTile } from '../../src/lib/core/sky/viirsTile';
import { parseViirsName, tileName, tilesForWindow, VIIRS_COLS, VIIRS_SCALE, VIIRS_TILE_PX, windowAround } from '../../src/lib/core/sky/viirs';
import { BASKET } from './basket';

const args = process.argv.slice(2);
const [mode, dir] = args;
const fitSat = args.includes('--sat');
const basketDir = args.includes('--basket') ? args[args.indexOf('--basket') + 1] : null;
if (!dir || (mode !== '--h5' && mode !== '--windows')) {
  console.error('usage: bun scripts/viirs/calibrate.ts --h5|--windows <dir> [--sat] [--basket <dir>]');
  process.exit(1);
}

interface Site {
  name: string;
  lat: number;
  lng: number;
  elevM: number;
}

const siteKey = (s: Site) => s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function h5Tiles(): Promise<Map<string, Uint16Array>> {
  const out = new Map<string, Uint16Array>();
  for (const f of readdirSync(dir).filter((n) => parseViirsName(n))) {
    // oxlint-disable-next-line no-await-in-loop -- one 11 MB tile in memory at a time
    const t = await decodeViirsTile(bytesSource(new Uint8Array(readFileSync(join(dir, f)))), f);
    out.set(tileName(t.tile), t.counts);
  }
  return out;
}

function windowFromTiles(tiles: Map<string, Uint16Array>, s: Site): Win {
  const w = windowAround(s, REACH_KM);
  const data = new Uint16Array(w.rows * w.cols);
  for (const t of tilesForWindow(w)) if (!tiles.has(tileName(t))) console.warn(`${s.name}: tile ${tileName(t)} missing, treated as dark`);
  for (let r = 0; r < w.rows; r++) {
    const gr = w.row0 + r;
    for (let c = 0; c < w.cols; c++) {
      const gc = (((w.col0 + c) % VIIRS_COLS) + VIIRS_COLS) % VIIRS_COLS;
      const t = tiles.get(tileName({ h: Math.floor(gc / VIIRS_TILE_PX), v: Math.floor(gr / VIIRS_TILE_PX) }));
      if (t) data[r * w.cols + c] = t[(gr % VIIRS_TILE_PX) * VIIRS_TILE_PX + (gc % VIIRS_TILE_PX)];
    }
  }
  return { ...w, data, scale: VIIRS_SCALE, satCount: Infinity };
}

function windowFromFile(d: string, s: Site): Win {
  const meta = JSON.parse(readFileSync(join(d, `${siteKey(s)}.json`), 'utf8'));
  const buf = readFileSync(join(d, `${siteKey(s)}.u16`));
  return { scale: VIIRS_SCALE, satCount: Infinity, ...meta, data: new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2) };
}

const load = (d: string, tiles: Map<string, Uint16Array> | null, sites: readonly Site[]) => sites.map((s) => radialHistogram(tiles ? windowFromTiles(tiles, s) : windowFromFile(d, s), s));
const tiles = mode === '--h5' ? await h5Tiles() : null;
const hist = load(dir, tiles, SQM_SITES);
const sum = histSum;
const natural = magToCdm2(NATURAL_SKY_MAG);

interface Fit {
  k: number;
  lambda: number;
  gain: number;
}

/** Kernel sums per site at one λ, unsaturated and saturated apart. */
const sumsAt = (hs: Hist[], lambda: number) => hs.map((h) => [sum(h.lit, lambda), sum(h.sat, lambda)] as const);
const magsFrom = (sums: (readonly [number, number])[], sites: readonly Site[], k: number, gain: number) => sites.map((s, i) => cdm2ToMag(natural + k * (sums[i][0] + gain * sums[i][1]) * altitudeFactor(s.elevM)));
const predictFor = (hs: Hist[], sites: readonly Site[], f: Fit) => magsFrom(sumsAt(hs, f.lambda), sites, f.k, f.gain);
const cost = (ms: number[]) => ms.reduce((a, m, i) => a + (m - SQM_SITES[i].sqm) ** 2, 0);

function bestK(sums: (readonly [number, number])[], gain: number): number {
  let lo = -12;
  let hi = 0;
  for (let it = 0; it < 80; it++) {
    const a = lo + (hi - lo) / 3;
    const b = hi - (hi - lo) / 3;
    if (cost(magsFrom(sums, SQM_SITES, 10 ** a, gain)) < cost(magsFrom(sums, SQM_SITES, 10 ** b, gain))) hi = b;
    else lo = a;
  }
  return 10 ** ((lo + hi) / 2);
}

let best = { k: 0, lambda: 0, gain: 1, c: Infinity };
for (let lambda = 10; lambda <= 400; lambda *= 1.1) {
  const sums = sumsAt(hist, lambda);
  for (let gain = 1; gain <= (fitSat ? 64 : 1); gain *= 1.1) {
    const k = bestK(sums, gain);
    const c = cost(magsFrom(sums, SQM_SITES, k, gain));
    if (c < best.c) best = { k, lambda, gain, c };
  }
}

/** DarkHours radiance_to_sqm: the observer's own pixel, no propagation. */
const localMag = (h: Hist) => 21.7 - 2.5 * Math.log10(h.local + 0.6);
/** Class distance with the half class 4.5 spanning 4–5 and 8 standing for 8–9. */
function classGap(mag: number, cls: number): number {
  const b = bortleOf(mag).cls;
  const [lo, hi] = b === 4.5 ? [4, 5] : b === 8 ? [8, 9] : [b, b];
  return cls < lo ? lo - cls : cls > hi ? cls - hi : 0;
}
const fmt = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(2);
const rms = (xs: number[]) => Math.sqrt(xs.reduce((a, v) => a + v * v, 0) / xs.length);
const total = (h: Float64Array) => h.reduce((a, v) => a + v, 0);

const pred = predictFor(hist, SQM_SITES, best);
const curFit = { k: SKYGLOW_PARAMS.k, lambda: SKYGLOW_PARAMS.lambdaKm, gain: 1 };
const cur = predictFor(hist, SQM_SITES, curFit);
const loc = hist.map(localMag);
const hyb = pred.map((m, i) => Math.min(m, loc[i]));
const hits = (ms: number[]) => `${ms.filter((m, i) => bortleOf(m).cls === bortleOf(SQM_SITES[i].sqm).cls).length}/${SQM_SITES.length}`;
const resid = (ms: number[]) => ms.map((m, i) => m - SQM_SITES[i].sqm);
console.log(`k = ${best.k.toPrecision(4)}, lambdaKm = ${best.lambda.toFixed(0)}, satGain = ${best.gain.toFixed(2)}, rms = ${Math.sqrt(best.c / SQM_SITES.length).toFixed(2)} mag, Bortle ${hits(pred)}`);
console.log(`SKYGLOW_PARAMS as is: rms = ${rms(resid(cur)).toFixed(2)} mag, Bortle ${hits(cur)}`);
console.log(`local (DarkHours): rms = ${rms(resid(loc)).toFixed(2)} mag, Bortle ${hits(loc)}; hybrid min: rms = ${rms(resid(hyb)).toFixed(2)} mag, Bortle ${hits(hyb)}`);
for (const [i, s] of SQM_SITES.entries()) {
  const satShare = total(hist[i].sat) / (total(hist[i].lit) + total(hist[i].sat) || 1);
  console.log(`${s.kind.padEnd(9)}${s.name.padEnd(34)}${s.sqm.toFixed(2)}  model ${pred[i].toFixed(2)}  ${fmt(pred[i] - s.sqm)}  local ${fmt(loc[i] - s.sqm)}  hybrid ${fmt(hyb[i] - s.sqm)}  satArea ${satShare.toFixed(2)}`);
}

if (basketDir) {
  if (!existsSync(basketDir)) throw new Error(`no basket windows in ${basketDir}`);
  const bh = load(basketDir, null, BASKET);
  const kern = predictFor(bh, BASKET, best);
  const local = bh.map(localMag);
  const asIs = predictFor(bh, BASKET, curFit);
  const all = { kernel: kern, local, hybrid: kern.map((m, i) => Math.min(m, local[i])), 'SKYGLOW_PARAMS': asIs, 'SKYGLOW_PARAMS hybrid': asIs.map((m, i) => Math.min(m, local[i])) };
  for (const [name, ms] of Object.entries(all)) {
    const gaps = ms.map((m, i) => classGap(m, BASKET[i].bortle));
    console.log(`basket ${name}: exact ${gaps.filter((g) => g === 0).length}/${BASKET.length}, ±1 ${gaps.filter((g) => g <= 1).length}/${BASKET.length}`);
  }
  for (const [i, s] of BASKET.entries())
    console.log(`${s.name.padEnd(28)}B${s.bortle}  kernel ${kern[i].toFixed(2)} B${bortleOf(kern[i]).label.padEnd(4)} local ${local[i].toFixed(2)} B${bortleOf(local[i]).label.padEnd(4)} hybrid B${bortleOf(all.hybrid[i]).label}`);
}
