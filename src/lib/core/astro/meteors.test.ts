import { describe, expect, it } from 'vitest';
import { makeObserver } from './bodies';
import { activeShowers, peakTime, radiantHorizontal, SHOWERS, showerStatus, upcomingPeaks } from './meteors';

const by = (code: string) => SHOWERS.find((s) => s.code === code)!;
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe('meteor showers', () => {
  it('places the maxima on the expected dates', () => {
    expect(['2026-08-12', '2026-08-13']).toContain(iso(peakTime(by('PER'), 2026)));
    expect(['2025-12-13', '2025-12-14', '2025-12-15']).toContain(iso(peakTime(by('GEM'), 2025)));
    expect(['2026-01-03', '2026-01-04']).toContain(iso(peakTime(by('QUA'), 2026)));
  });

  it('handles activity that wraps the year', () => {
    const late = showerStatus(by('QUA'), Date.UTC(2025, 11, 30));
    expect(late.active).toBe(true);
    expect(new Date(late.peakMs).getUTCFullYear()).toBe(2026);
    expect(showerStatus(by('QUA'), Date.UTC(2026, 0, 5)).active).toBe(true);
    expect(showerStatus(by('QUA'), Date.UTC(2026, 1, 1)).active).toBe(false);
    expect(showerStatus(by('PER'), Date.UTC(2026, 8, 15)).active).toBe(false);
  });

  it('lists the Perseids first in mid-August and the next peaks in order', () => {
    const t = Date.UTC(2026, 7, 12, 12);
    expect(activeShowers(t)[0].shower.code).toBe('PER');
    const next = upcomingPeaks(t, 60);
    expect(next.map((s) => s.shower.code)).toContain('AUR');
    for (let i = 1; i < next.length; i++) expect(next[i].peakMs).toBeGreaterThanOrEqual(next[i - 1].peakMs);
  });

  it('puts the Perseid radiant high in the north-east before dawn', () => {
    const t = Date.UTC(2026, 7, 13, 1);
    const h = radiantHorizontal(showerStatus(by('PER'), t), t, makeObserver({ lat: 45, lng: 7 }));
    expect(h.altitudeDeg).toBeGreaterThan(40);
    expect(h.altitudeDeg).toBeLessThan(60);
    expect(h.azimuthDeg).toBeGreaterThan(30);
    expect(h.azimuthDeg).toBeLessThan(65);
  });
});
