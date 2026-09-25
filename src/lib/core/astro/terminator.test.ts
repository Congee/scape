import { Body, Observer, SearchAltitude, SearchRiseSet } from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import { angleDeg, bandIndex, capRing, NightBand, nightFeatures, nightModel, nightShiftPx } from './terminator';

const EPS = 1 / (512 * 2 ** 12);

/** Time within [a, b] at which the camera leaves or enters cap `i`, by bisection. */
function crossing(obs: Observer, agl: number, i: number, a: number, b: number): number {
  const inside = (ms: number) => {
    const m = nightModel(new Date(ms), obs, agl);
    return angleDeg(m.antisolar, { lat: obs.latitude, lng: obs.longitude }) < m.caps[i].radiusDeg;
  };
  const ia = inside(a);
  for (let k = 0; k < 40; k++) {
    const mid = (a + b) / 2;
    if (inside(mid) === ia) a = mid;
    else b = mid;
  }
  return (a + b) / 2;
}

const SITES = [
  { name: 'Zermatt summit', obs: new Observer(45.9763, 7.6586, 4478 + 1.6), agl: 1.6, start: '2026-06-21T00:00:00Z' },
  { name: 'Rotterdam tower', obs: new Observer(51.9055, 4.4666, 185), agl: 180, start: '2026-03-20T00:00:00Z' },
  { name: 'Tromsø', obs: new Observer(69.6492, 18.9553, 10 + 1.6), agl: 1.6, start: '2026-02-10T00:00:00Z' },
  { name: 'Fiji', obs: new Observer(-17.7134, 178.065, 2), agl: 1.6, start: '2026-12-01T00:00:00Z' }
];

describe('nightModel', () => {
  for (const { name, obs, agl, start } of SITES) {
    it(`meets SearchRiseSet and SearchAltitude at ${name}`, () => {
      const t0 = new Date(start);
      const rise = SearchRiseSet(Body.Sun, obs, 1, t0, 2, agl)!;
      const r = rise.date.getTime();
      expect(Math.abs(crossing(obs, agl, 0, r - 1_200_000, r + 1_200_000) - r)).toBeLessThan(2000);
      const set = SearchRiseSet(Body.Sun, obs, -1, t0, 2, agl)!;
      const s = set.date.getTime();
      expect(Math.abs(crossing(obs, agl, 0, s - 1_200_000, s + 1_200_000) - s)).toBeLessThan(2000);
      for (const [i, alt] of [[1, -6], [2, -12], [3, -18]]) {
        const tw = SearchAltitude(Body.Sun, obs, 1, t0, 2, alt);
        if (!tw) continue;
        const ms = tw.date.getTime();
        expect(Math.abs(crossing(obs, agl, i, ms - 1_200_000, ms + 1_200_000) - ms)).toBeLessThan(2000);
      }
    });
  }

  it('orders caps rise ⊃ civil ⊃ nautical ⊃ astro', () => {
    const m = nightModel(new Date('2026-09-24T12:00:00Z'), SITES[0].obs, 1.6);
    expect(m.caps.map((c) => c.band)).toEqual([NightBand.Rise, NightBand.Civil, NightBand.Nautical, NightBand.Astro]);
    for (let i = 1; i < 4; i++) expect(m.caps[i].radiusDeg).toBeLessThan(m.caps[i - 1].radiusDeg);
    expect(bandIndex(m, m.antisolar)).toBe(4);
    expect(bandIndex(m, { lat: -m.antisolar.lat, lng: m.antisolar.lng + 180 })).toBe(0);
  });

  it('has polar day at Tromsø in June', () => {
    const obs = SITES[2].obs;
    for (let h = 0; h < 24; h += 3) {
      const m = nightModel(new Date(Date.UTC(2026, 5, 21, h)), obs, 1.6);
      expect(bandIndex(m, { lat: obs.latitude, lng: obs.longitude })).toBe(0);
    }
  });

  it('shifts about 0.25° a minute', () => {
    const a = nightModel(new Date('2026-09-24T12:00:00Z'), SITES[0].obs, 1.6);
    const b = nightModel(new Date('2026-09-24T12:01:00Z'), SITES[0].obs, 1.6);
    const px = nightShiftPx(a, b, 360);
    expect(px).toBeGreaterThan(0.24);
    expect(px).toBeLessThan(0.4);
  });
});

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI);

/** Distance from p to segment ab. */
function segDist(p: number[], a: number[], b: number[]) {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

describe('capRing', () => {
  it('lies on the circle with continuous longitudes across the antimeridian', () => {
    const c = { lat: 10, lng: 175 };
    const { ring, pole } = capRing(c, 60, EPS);
    expect(pole).toBe(0);
    for (const [lng, lat] of ring) expect(angleDeg(c, { lng, lat })).toBeCloseTo(60, 6);
    for (let i = 1; i < ring.length; i++) expect(Math.abs(ring[i][0] - ring[i - 1][0])).toBeLessThan(5);
    expect(Math.max(...ring.map((p) => p[0]))).toBeGreaterThan(180);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('keeps every circle point within eps of a chord in mercator', () => {
    const c = { lat: -20, lng: -30 };
    const eps = 1 / (512 * 2 ** 6);
    const xy = ([lng, lat]: number[]) => [lng / 360, mercY(Math.max(-85, Math.min(85, lat)))];
    const ring = capRing(c, 89, eps).ring.map(xy);
    const fine = capRing(c, 89, eps / 64).ring.map(xy);
    let worst = 0;
    for (const p of fine) {
      let best = Infinity;
      for (let i = 1; i < ring.length; i++) best = Math.min(best, segDist(p, ring[i - 1], ring[i]));
      worst = Math.max(worst, best);
    }
    expect(worst).toBeLessThan(1.5 * eps);
    expect(ring.length).toBeLessThan(fine.length);
  });

  it('closes a pole cap along the pole and spans 360°', () => {
    const c = { lat: 23, lng: 0 };
    const { ring, pole } = capRing(c, 80, EPS);
    expect(pole).toBe(1);
    expect(Math.abs(ring[ring.length - 1][0] - ring[0][0])).toBeCloseTo(360, 6);
    const f = nightFeatures({ antisolar: c, caps: [{ band: NightBand.Rise, radiusDeg: 80 }] }, EPS);
    const poly = f.features[0].geometry.coordinates[0] as number[][];
    expect(poly.slice(-3, -1).map((p) => p[1])).toEqual([90, 90]);
    expect(f.features[1].geometry.type).toBe('LineString');
  });

  it('cuts a pole cap at the antimeridian so it stays within ±180', () => {
    for (const c of [{ lat: 23, lng: -164.5 }, { lat: -23, lng: 40 }]) {
      const f = nightFeatures({ antisolar: c, caps: [{ band: NightBand.Rise, radiusDeg: 80 }] }, EPS);
      const poly = f.features[0].geometry.coordinates[0] as number[][];
      const lngs = poly.map((p) => p[0]);
      expect(Math.min(...lngs)).toBe(-180);
      expect(Math.max(...lngs)).toBe(180);
      const edge = poly.slice(0, -3);
      expect(edge.every((p, i) => i === 0 || p[0] >= edge[i - 1][0])).toBe(true);
      expect(edge[0][1]).toBeCloseTo(edge[edge.length - 1][1], 9);
    }
  });

  it('closes a south pole cap', () => {
    expect(capRing({ lat: -23, lng: 40 }, 70, EPS).pole).toBe(-1);
  });
});
