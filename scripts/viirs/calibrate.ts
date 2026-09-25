/**
 * Fits SKYGLOW_PARAMS (k, λ) to the published zenith brightness in skyglow.sites.ts and prints residuals.
 *   bun scripts/viirs/calibrate.ts --h5 <dir of VNP46A4 .h5 tiles>
 *   bun scripts/viirs/calibrate.ts --windows <dir of <site>.u16 + <site>.json 15" count windows>
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bytesSource } from '../../src/lib/core/io/hdf5';
import { cdm2ToMag, magToCdm2, NATURAL_SKY_MAG } from '../../src/lib/core/sky/brightness';
import { altitudeFactor, KM_PER_DEG_LAT, KM_PER_DEG_LON, kernel, REACH_KM } from '../../src/lib/core/sky/skyglow';
import { SQM_SITES, type SqmSite } from '../../src/lib/core/sky/skyglow.sites';
import { decodeViirsTile } from '../../src/lib/core/sky/viirsTile';
import { parseViirsName, tileName, tilesForWindow, VIIRS_COLS, VIIRS_PX_PER_DEG, VIIRS_SCALE, VIIRS_TILE_PX, type ViirsWindow, windowAround } from '../../src/lib/core/sky/viirs';

const [mode, dir] = process.argv.slice(2);
if (!dir || (mode !== '--h5' && mode !== '--windows')) {
  console.error('usage: bun scripts/viirs/calibrate.ts --h5|--windows <dir>');
  process.exit(1);
}

const siteKey = (s: SqmSite) => s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function h5Tiles(): Promise<Map<string, Uint16Array>> {
  const out = new Map<string, Uint16Array>();
  for (const f of readdirSync(dir).filter((n) => parseViirsName(n))) {
    const t = await decodeViirsTile(bytesSource(new Uint8Array(readFileSync(join(dir, f)))), f);
    out.set(tileName(t.tile), t.counts);
  }
  return out;
}

function windowFromTiles(tiles: Map<string, Uint16Array>, s: SqmSite): ViirsWindow {
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
  return { ...w, data };
}

function windowFromFile(s: SqmSite): ViirsWindow {
  const meta = JSON.parse(readFileSync(join(dir, `${siteKey(s)}.json`), 'utf8'));
  const buf = readFileSync(join(dir, `${siteKey(s)}.u16`));
  return { ...meta, data: new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2) };
}

const BIN_KM = 0.05;
/** Radiance·area histogram by distance, so every λ reuses one pass over the pixels. */
function radialHistogram(win: ViirsWindow, s: SqmSite): Float64Array {
  const h = new Float64Array(Math.ceil(REACH_KM / BIN_KM));
  const d2r = Math.PI / 180;
  const px = 1 / VIIRS_PX_PER_DEG;
  const kx = KM_PER_DEG_LON * Math.cos(s.lat * d2r);
  for (let r = 0; r < win.rows; r++) {
    const pLat = 90 - (win.row0 + r + 0.5) * px;
    const dy = (pLat - s.lat) * KM_PER_DEG_LAT;
    const area = px * KM_PER_DEG_LAT * px * KM_PER_DEG_LON * Math.cos(pLat * d2r);
    for (let c = 0; c < win.cols; c++) {
      const v = win.data[r * win.cols + c];
      if (!v) continue;
      let dLon = (win.col0 + c + 0.5) * px - 180 - s.lng;
      dLon -= 360 * Math.round(dLon / 360);
      const i = Math.floor(Math.hypot(dLon * kx, dy) / BIN_KM);
      if (i < h.length) h[i] += v * VIIRS_SCALE * area;
    }
  }
  return h;
}

const tiles = mode === '--h5' ? await h5Tiles() : null;
const hist = SQM_SITES.map((s) => radialHistogram(tiles ? windowFromTiles(tiles, s) : windowFromFile(s), s));
const sum = (h: Float64Array, lambda: number) => h.reduce((a, v, i) => a + v * kernel((i + 0.5) * BIN_KM, lambda), 0);
const natural = magToCdm2(NATURAL_SKY_MAG);
const predict = (k: number, lambda: number) => SQM_SITES.map((s, i) => cdm2ToMag(natural + k * sum(hist[i], lambda) * altitudeFactor(s.elevM)));
const cost = (k: number, lambda: number) => predict(k, lambda).reduce((a, m, i) => a + (m - SQM_SITES[i].sqm) ** 2, 0);

function bestK(lambda: number): number {
  let lo = -12;
  let hi = 0;
  for (let it = 0; it < 80; it++) {
    const a = lo + (hi - lo) / 3;
    const b = hi - (hi - lo) / 3;
    if (cost(10 ** a, lambda) < cost(10 ** b, lambda)) hi = b;
    else lo = a;
  }
  return 10 ** ((lo + hi) / 2);
}

let best = { k: 0, lambda: 0, c: Infinity };
for (let lambda = 10; lambda <= 400; lambda *= 1.1) {
  const k = bestK(lambda);
  const c = cost(k, lambda);
  if (c < best.c) best = { k, lambda, c };
}
const pred = predict(best.k, best.lambda);
console.log(`k = ${best.k.toPrecision(4)}, lambdaKm = ${best.lambda.toFixed(0)}, rms = ${Math.sqrt(best.c / SQM_SITES.length).toFixed(2)} mag`);
for (const [i, s] of SQM_SITES.entries()) console.log(`${s.kind.padEnd(9)}${s.name.padEnd(34)}${s.sqm.toFixed(2)}  model ${pred[i].toFixed(2)}  ${(pred[i] - s.sqm >= 0 ? '+' : '') + (pred[i] - s.sqm).toFixed(2)}`);
