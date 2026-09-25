import { describe, expect, it } from 'vitest';
import { NOAA_HARMONIC, NOAA_SUBORDINATE } from './noaaFixture';
import { parseStation, tideExtremes, type TideStationRow } from './predict';
import { cosineCurve, cosineTide, HeightOffset, parseSubordinate, subordinateExtremes, type SubordinateRow } from './subordinate';

const T0 = Date.UTC(2026, 9, 1);
const T1 = Date.UTC(2026, 9, 22);
const MIN = 60_000;

const reference = (id: string) => {
  const hit = NOAA_HARMONIC.find((s) => s.row[0] === id);
  if (!hit) throw new Error(`no fixture for ${id}`);
  return parseStation(hit.row);
};

describe('subordinateExtremes', () => {
  for (const { row, hilo } of NOAA_SUBORDINATE) {
    it(`matches NOAA CO-OPS published highs/lows at ${row[1]} (${row[0]}, ${row[9] === 'R' ? 'height ratio' : 'feet added'})`, () => {
      const sub = parseSubordinate(row);
      const got = subordinateExtremes(sub, reference(sub.refId), T0, T1);
      expect(got.length).toBe(hilo.length / 3);
      got.forEach((g, i) => {
        expect(g.high).toBe(hilo[i * 3 + 2] === 1);
        // NOAA rounds times to the minute and heights to the millimetre.
        expect(Math.abs(g.timeMs - (T0 + hilo[i * 3] * MIN))).toBeLessThanOrEqual(MIN);
        expect(Math.abs(g.heightM - hilo[i * 3 + 1] / 1000)).toBeLessThanOrEqual(0.005);
      });
    });
  }

  const ref: TideStationRow = NOAA_HARMONIC[0].row;
  const base = (over: Partial<Record<'highMin' | 'lowMin' | 'highH' | 'lowH', number>>, kind = 'R'): SubordinateRow => [
    'X',
    'Test',
    0,
    0,
    ref[0],
    over.highMin ?? 0,
    over.lowMin ?? 0,
    over.highH ?? 1,
    over.lowH ?? 1,
    kind
  ];
  const day = [T0 + 86_400_000, T0 + 2 * 86_400_000] as const;

  it('shifts highs and lows by their own time offsets and scales or adds their own heights', () => {
    const st = parseStation(ref);
    const want = tideExtremes(st, day[0] - 3 * 3_600_000, day[1] + 3 * 3_600_000);
    const ratio = parseSubordinate(base({ highMin: 30, lowMin: -45, highH: 0.5, lowH: 2 }));
    expect(ratio.heightOffset).toBe(HeightOffset.Ratio);
    for (const g of subordinateExtremes(ratio, st, ...day)) {
      const w = want.find((e) => e.timeMs + (e.high ? 30 : -45) * MIN === g.timeMs);
      expect(w?.high).toBe(g.high);
      expect(g.heightM).toBeCloseTo(w!.heightM * (g.high ? 0.5 : 2), 9);
    }
    const feet = parseSubordinate(base({ highH: 1, lowH: -0.5 }, 'F'));
    expect(feet.heightOffset).toBe(HeightOffset.AddFeet);
    const plain = subordinateExtremes(parseSubordinate(base({})), st, ...day);
    subordinateExtremes(feet, st, ...day).forEach((g, i) => {
      expect(g.heightM).toBeCloseTo(plain[i].heightM + (g.high ? 0.3048 : -0.1524), 9);
    });
  });

  it('keeps exactly the shifted extremes that land in the window, including ones shifted in from outside it', () => {
    const st = parseStation(ref);
    const shift = 5 * 60;
    const all = tideExtremes(st, day[0] - 86_400_000, day[1] + 86_400_000).map((e) => e.timeMs + shift * MIN);
    const want = all.filter((t) => t >= day[0] && t < day[1]);
    const got = subordinateExtremes(parseSubordinate(base({ highMin: shift, lowMin: shift })), st, ...day);
    expect(got.map((g) => g.timeMs)).toEqual(want);
  });

  it('returns times in order when unequal offsets swap a high and a low', () => {
    const st = parseStation(ref);
    const got = subordinateExtremes(parseSubordinate(base({ highMin: 400, lowMin: -400 })), st, ...day);
    expect(got.length).toBeGreaterThan(1);
    for (let i = 1; i < got.length; i++) expect(got[i].timeMs).toBeGreaterThanOrEqual(got[i - 1].timeMs);
  });

  it('rejects a height offset kind it does not know', () => {
    expect(() => parseSubordinate(base({}, 'X'))).toThrow(/unknown height offset/);
  });
});

describe('cosineTide', () => {
  const H = 3_600_000;
  const ext = [
    { timeMs: 0, heightM: 0.2, high: false },
    { timeMs: 6 * H, heightM: 1.8, high: true },
    { timeMs: 12 * H, heightM: 0.4, high: false }
  ];

  it('passes through each high and low and follows half a cosine between them', () => {
    expect(cosineTide(ext, 0)?.heightM).toBeCloseTo(0.2, 9);
    expect(cosineTide(ext, 6 * H)?.heightM).toBeCloseTo(1.8, 9);
    expect(cosineTide(ext, 3 * H)?.heightM).toBeCloseTo(1.0, 9);
    // Table 3: a quarter of the way through, a (1 - cos 45°) / 2 share of the range.
    expect(cosineTide(ext, 1.5 * H)?.heightM).toBeCloseTo(0.2 + 1.6 * ((1 - Math.SQRT1_2) / 2), 9);
    expect(cosineTide(ext, 9 * H)?.heightM).toBeCloseTo(1.1, 9);
  });

  it('rises toward a high and falls toward a low', () => {
    expect(cosineTide(ext, 2 * H)?.rising).toBe(true);
    expect(cosineTide(ext, 8 * H)?.rising).toBe(false);
  });

  it('is null outside the extremes', () => {
    expect(cosineTide(ext, -1)).toBeNull();
    expect(cosineTide(ext, 12 * H + 1)).toBeNull();
    expect(cosineTide(ext.slice(0, 1), 0)).toBeNull();
  });

  it('samples a curve that stays within each pair and throws on an unbracketed span', () => {
    const c = cosineCurve(ext, 0, 12 * H);
    expect(c.length).toBe(73);
    expect(c[36]).toBeCloseTo(1.8, 6);
    for (const v of c) expect(v >= 0.2 - 1e-6 && v <= 1.8 + 1e-6).toBe(true);
    expect(() => cosineCurve(ext, 0, 13 * H)).toThrow(/bracket/);
  });
});
