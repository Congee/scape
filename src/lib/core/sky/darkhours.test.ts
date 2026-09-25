import { describe, expect, it } from 'vitest';
import { darkHoursUrl, localNightDate } from './darkhours';

describe('DarkHours link', () => {
  it('dates the night by its evening in the local zone', () => {
    expect(localNightDate(new Date('2026-03-10T21:00:00Z'), 'Europe/Amsterdam')).toBe('2026-03-10');
    expect(localNightDate(new Date('2026-03-11T02:30:00Z'), 'Europe/Amsterdam')).toBe('2026-03-10');
    expect(localNightDate(new Date('2026-03-11T12:30:00Z'), 'Europe/Amsterdam')).toBe('2026-03-11');
    expect(localNightDate(new Date('2026-01-01T05:00:00Z'), 'America/New_York')).toBe('2025-12-31');
  });

  it('writes 5-decimal coordinates', () => {
    expect(darkHoursUrl({ lat: 51.922, lng: 4.4792345 }, new Date('2026-03-10T21:00:00Z'), 'Europe/Amsterdam')).toBe(
      'https://darkhours.app/?lat=51.92200&lon=4.47923&date=2026-03-10'
    );
    expect(darkHoursUrl({ lat: -24.9, lng: -16.05 }, new Date('2026-03-10T21:00:00Z'), 'Africa/Windhoek')).toContain('lat=-24.90000&lon=-16.05000');
  });
});
