import { describe, expect, it } from 'vitest';
import { NATURAL_SKY_MAG } from './brightness';
import { altitudeFactor, DOME_PROMINENCE, domeHeightDeg, domesOf, emptyBins, glowToward, kernel, referenceBins, RINGS, ringOf, SECTORS, skyglowFrom } from './skyglow';
import { VIIRS_PX_PER_DEG, type ViirsWindow, windowAround } from './viirs';

const P = { k: 1e-6, lambdaKm: 60 };
const OBS = { lat: 50, lng: 10 };

/** A dark window around OBS with lights at the given offsets in km (east, north). */
function windowWith(lights: [number, number, number][]): ViirsWindow {
  const w = windowAround(OBS, 400);
  const data = new Uint16Array(w.rows * w.cols);
  for (const [e, n, v] of lights) {
    const lat = OBS.lat + n / 110.574;
    const lng = OBS.lng + e / (111.32 * Math.cos((OBS.lat * Math.PI) / 180));
    const r = Math.floor((90 - lat) * VIIRS_PX_PER_DEG) - w.row0;
    const c = Math.floor((lng + 180) * VIIRS_PX_PER_DEG) - w.col0;
    data[r * w.cols + c] = v;
  }
  return { ...w, data };
}

describe('skyglow kernel', () => {
  it('falls off as d^-2.5 far out and stays finite at the source', () => {
    expect(kernel(0, 1e9)).toBe(1);
    expect(kernel(20, 1e9) / kernel(40, 1e9)).toBeCloseTo(2 ** 2.5, 1);
    expect(kernel(100, 60)).toBeLessThan(kernel(100, 1e9));
  });

  it('dims with observer height', () => {
    expect(altitudeFactor(0)).toBe(1);
    expect(altitudeFactor(2000)).toBeLessThan(altitudeFactor(500));
    expect(altitudeFactor(-50)).toBe(1);
  });

  it('bins distances into rings', () => {
    expect(ringOf(0.1)).toBe(0);
    expect(ringOf(3)).toBe(4);
    expect(ringOf(383)).toBe(RINGS - 1);
    expect(ringOf(400)).toBe(-1);
  });
});

describe('reference bins', () => {
  it('puts a city 30 km east in the east sector and 16–32 km ring', () => {
    const bins = referenceBins(windowWith([[30, 5, 5000]]), OBS.lat, OBS.lng, P.lambdaKm);
    const i = bins.w.findIndex((v) => v > 0);
    expect(i % SECTORS).toBe(8);
    expect(Math.floor(i / SECTORS)).toBe(ringOf(30));
    expect(bins.wd[i] / bins.w[i]).toBeCloseTo(Math.hypot(30, 5), 0);
  });

  it('reads a dark window as the natural sky', () => {
    const g = skyglowFrom(referenceBins(windowWith([]), OBS.lat, OBS.lng, P.lambdaKm), 0, P);
    expect(g.mag).toBeCloseTo(NATURAL_SKY_MAG, 10);
    expect(g.domes).toEqual([]);
    expect(g.bortle.cls).toBe(1);
  });

  it('brightens with nearer and brighter light', () => {
    const at = (km: number, v: number) => skyglowFrom(referenceBins(windowWith([[0, km, v]]), OBS.lat, OBS.lng, P.lambdaKm), 0, P).mag;
    expect(at(10, 5000)).toBeLessThan(at(50, 5000));
    expect(at(50, 60000)).toBeLessThan(at(50, 5000));
  });
});

describe('light domes', () => {
  const g = skyglowFrom(referenceBins(windowWith([[-40, -20, 60000], [0, 150, 3000]]), OBS.lat, OBS.lng, P.lambdaKm), 0, P);

  it('finds the main dome with its bearing and height', () => {
    const d = g.domes[0];
    expect(d.azimuthDeg).toBeGreaterThan(240);
    expect(d.azimuthDeg).toBeLessThan(250);
    expect(d.distanceKm).toBeCloseTo(Math.hypot(40, 20), 0);
    expect(d.heightDeg).toBeCloseTo(domeHeightDeg(Math.hypot(40, 20)), 1);
    expect(d.hidden).toBe(false);
    expect(g.sectorShare.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it('hides a dome behind a higher skyline', () => {
    const share = new Float64Array(SECTORS);
    const dist = new Float64Array(SECTORS);
    share[9] = 1;
    dist[9] = 30;
    const [d] = domesOf(share, dist, (az) => (az > 80 && az < 110 ? 10 : 0));
    expect(d.azimuthDeg).toBe(95);
    expect(d.skylineDeg).toBe(10);
    expect(d.hidden).toBe(true);
    dist[9] = 1;
    expect(domesOf(share, dist)).toEqual([]);
  });

  it('scores glow toward a direction, fading with altitude', () => {
    const low = glowToward(g, 245, 0);
    expect(low.prominence).toBeGreaterThan(DOME_PROMINENCE);
    expect(glowToward(g, 245, 20).prominence).toBeLessThan(low.prominence / 10);
    expect(glowToward(g, 90, 0).prominence).toBeLessThan(1);
    expect(glowToward(g, 245, 0, () => 30).hidden).toBe(true);
  });

  it('empty bins give no shares', () => {
    expect(skyglowFrom(emptyBins(), 0, P).sectorShare.every((v) => v === 0)).toBe(true);
  });
});
