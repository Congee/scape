import { describe, expect, it } from 'vitest';
import { localMidnight } from '@core/time/localDay';
import { makeObserver } from './bodies';
import { altitudeBands, azDistanceDeg, describePass, findPasses, inAzWindow, mergePasses, passesFilters, SkyFilter, skyRange, type FinderQuery } from './finder';
import { position } from './positions';
import { airDensity, riseApparentDeg } from './refraction';

const nyc = makeObserver({ lat: 40.7463, lng: -74.1553 });
const zermatt = makeObserver({ lat: 46.0207, lng: 7.7491 });
const NY = 'America/New_York';
const CH = 'Europe/Zurich';
const range = (tz: string, y: number, m: number, d: number, days: number) => {
  const start = localMidnight(y, m, d, tz).getTime();
  return { startMs: start, endMs: start + days * 86_400_000 };
};
const base = (q: Partial<FinderQuery>): FinderQuery => ({
  body: 'Sun',
  azFromDeg: 0,
  azToDeg: 0,
  altMinDeg: -90,
  altMaxDeg: 90,
  tz: NY,
  sky: SkyFilter.Any,
  moonIllumMin: 0,
  moonIllumMax: 1,
  moonDown: false,
  weekdays: null,
  ...range(NY, 2026, 9, 1, 30),
  ...q
});
const inside = (q: FinderQuery, obs: ReturnType<typeof makeObserver>, ms: number) => {
  const p = position(q.body, new Date(ms), obs);
  return inAzWindow(p.azimuth, q.azFromDeg, q.azToDeg) && p.altitude >= q.altMinDeg && p.altitude <= q.altMaxDeg;
};

describe('sky filter', () => {
  it('splits day from night at the eye\'s rise/set threshold', () => {
    const rho = airDensity(3000);
    expect(skyRange(SkyFilter.Daylight, rho)[0]).toBe(riseApparentDeg(rho));
    expect(skyRange(SkyFilter.SunDown, rho)[1]).toBe(riseApparentDeg(rho));
    expect(riseApparentDeg(1) - riseApparentDeg(rho)).toBeCloseTo(0.032, 3);
  });
});

describe('azimuth windows', () => {
  it('wraps through north and treats equal edges as any azimuth', () => {
    expect(inAzWindow(355, 350, 10)).toBe(true);
    expect(inAzWindow(5, 350, 10)).toBe(true);
    expect(inAzWindow(180, 350, 10)).toBe(false);
    expect(inAzWindow(123, 40, 40)).toBe(true);
    expect(azDistanceDeg(20, 350, 10)).toBeCloseTo(10);
    expect(azDistanceDeg(340, 350, 10)).toBeCloseTo(10);
    expect(azDistanceDeg(0, 350, 10)).toBe(0);
  });
});

describe('altitude bands', () => {
  it('brackets the sun between 0° and 10° twice a day', () => {
    const bands = altitudeBands('Sun', nyc, 0, 10, ...Object.values(range(NY, 2026, 9, 1, 3)) as [number, number]);
    expect(bands.length).toBe(6);
    for (const b of bands) {
      expect(b.endMs - b.startMs).toBeGreaterThan(30 * 60_000);
      expect(b.endMs - b.startMs).toBeLessThan(90 * 60_000);
      const mid = position('Sun', new Date((b.startMs + b.endMs) / 2), nyc).altitude;
      expect(mid).toBeGreaterThan(0);
      expect(mid).toBeLessThan(10);
    }
  });

  it('skips edges the body can never reach', () => {
    expect(altitudeBands('Sun', nyc, 80, 90, ...Object.values(range(NY, 2026, 9, 1, 10)) as [number, number])).toEqual([]);
    const whole = altitudeBands('Sun', nyc, -90, 90, ...Object.values(range(NY, 2026, 9, 1, 2)) as [number, number]);
    expect(whole.length).toBe(1);
  });
});

describe('passes', () => {
  it('matches a brute-force scan of the sun through a low western window', () => {
    const q = base({ azFromDeg: 250, azToDeg: 290, altMinDeg: 0, altMaxDeg: 15, ...range(NY, 2026, 9, 10, 7) });
    const passes = findPasses(q, nyc);
    expect(passes.length).toBe(7);
    // Brute force at 30 s.
    const brute: { startMs: number; endMs: number }[] = [];
    let open: number | null = null;
    for (let t = q.startMs; t <= q.endMs; t += 30_000) {
      const on = t < q.endMs && inside(q, nyc, t);
      if (on && open === null) open = t;
      if (!on && open !== null) {
        brute.push({ startMs: open, endMs: t });
        open = null;
      }
    }
    expect(brute.length).toBe(passes.length);
    passes.forEach((p, i) => {
      expect(Math.abs(p.startMs - brute[i].startMs)).toBeLessThanOrEqual(31_000);
      expect(Math.abs(p.endMs - brute[i].endMs)).toBeLessThanOrEqual(31_000);
    });
  });

  it('pins pass boundaries to the window edge within seconds', () => {
    const q = base({ azFromDeg: 85, azToDeg: 95, altMinDeg: 0, altMaxDeg: 10 });
    const passes = findPasses(q, nyc);
    expect(passes.length).toBeGreaterThan(10);
    for (const p of passes) {
      expect(p.endMs).toBeGreaterThan(p.startMs);
      expect(inside(q, nyc, (p.startMs + p.endMs) / 2)).toBe(true);
      expect(inside(q, nyc, p.startMs - 5000)).toBe(false);
      expect(inside(q, nyc, p.endMs + 5000)).toBe(false);
    }
  });

  it('describes the best moment inside the pass and flags clipped passes', () => {
    const q = base({ azFromDeg: 85, azToDeg: 95, altMinDeg: 0, altMaxDeg: 10, ...range(NY, 2026, 9, 1, 2) });
    const hits = findPasses(q, nyc).map((p) => describePass(q, nyc, p));
    expect(hits.length).toBe(2);
    for (const h of hits) {
      expect(h.bestMs).toBeGreaterThanOrEqual(h.startMs);
      expect(h.bestMs).toBeLessThanOrEqual(h.endMs);
      expect(inAzWindow(h.azDeg, 85, 95)).toBe(true);
      expect(h.altDeg).toBeGreaterThanOrEqual(0);
      expect(h.altDeg).toBeLessThanOrEqual(10);
      expect(h.clippedStart).toBe(false);
      expect(h.clippedEnd).toBe(false);
      expect(h.sunAltDeg).toBeCloseTo(h.altDeg, 5);
    }
    const clipped = base({ altMinDeg: -90, altMaxDeg: 90, ...range(NY, 2026, 9, 1, 1) });
    const [whole] = findPasses(clipped, nyc).map((p) => describePass(clipped, nyc, p));
    expect(whole.clippedStart && whole.clippedEnd).toBe(true);
  });

  it('finds the moon over the Matterhorn direction and keeps only bright phases when asked', () => {
    const q = base({ body: 'Moon', azFromDeg: 231, azToDeg: 239, altMinDeg: 14, altMaxDeg: 21, tz: CH, ...range(CH, 2026, 9, 1, 120) });
    const hits = findPasses(q, zermatt).map((p) => describePass(q, zermatt, p));
    expect(hits.length).toBeGreaterThan(8);
    for (const h of hits) {
      expect(inAzWindow(h.azDeg, 231, 239)).toBe(true);
      expect(h.altDeg).toBeGreaterThanOrEqual(14 - 1e-6);
      expect(h.altDeg).toBeLessThanOrEqual(21 + 1e-6);
    }
    const full = hits.filter((h) => passesFilters(h, { ...q, moonIllumMin: 0.9 }, zermatt));
    expect(full.length).toBeGreaterThan(0);
    expect(full.length).toBeLessThan(hits.length / 3);
    for (const h of full) expect(h.moonIllumination).toBeGreaterThanOrEqual(0.9);
  });

  it('applies sky, moon-down and weekday filters', () => {
    const q = base({ body: 'Gc', altMinDeg: 10, altMaxDeg: 90, tz: CH, sky: SkyFilter.AstroDark, moonDown: true, ...range(CH, 2026, 6, 1, 30) });
    const hits = findPasses(q, zermatt).map((p) => describePass(q, zermatt, p));
    const dark = hits.filter((h) => passesFilters(h, q, zermatt));
    expect(dark.length).toBeGreaterThan(5);
    expect(dark.length).toBeLessThan(hits.length);
    for (const h of dark) expect(h.moonAltDeg).toBeLessThan(0);
    const weekend = hits.filter((h) => passesFilters(h, { ...q, sky: SkyFilter.Any, moonDown: false, weekdays: [0, 6] }, zermatt));
    expect(weekend.length).toBeGreaterThan(0);
    for (const h of weekend) {
      const wd = new Date(h.bestMs).toLocaleDateString('en-US', { timeZone: CH, weekday: 'short' });
      expect(['Sat', 'Sun']).toContain(wd);
    }
  });
});

describe('merging passes', () => {
  it('joins passes split by a cut and keeps distinct ones apart', () => {
    expect(mergePasses([])).toEqual([]);
    expect(
      mergePasses([
        { startMs: 0, endMs: 1000 },
        { startMs: 1000, endMs: 2000 },
        { startMs: 3400, endMs: 4000 },
        { startMs: 9000, endMs: 9500 }
      ])
    ).toEqual([
      { startMs: 0, endMs: 4000 },
      { startMs: 9000, endMs: 9500 }
    ]);
  });

  it('leaves the input untouched', () => {
    const a = [
      { startMs: 0, endMs: 1000 },
      { startMs: 1000, endMs: 2000 }
    ];
    mergePasses(a);
    expect(a[0].endMs).toBe(1000);
  });
});
