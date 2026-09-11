import { describe, expect, it } from 'vitest';
import { addLocalDays, dayBounds, localMidnight, offsetLabel, tzOffsetMs, withLocalTime } from './localDay';

describe('localDay', () => {
  it('computes New York offset in summer and winter', () => {
    expect(tzOffsetMs(new Date('2026-07-01T12:00:00Z'), 'America/New_York')).toBe(-4 * 3600e3);
    expect(tzOffsetMs(new Date('2026-01-15T12:00:00Z'), 'America/New_York')).toBe(-5 * 3600e3);
    expect(offsetLabel(new Date('2026-07-01T12:00:00Z'), 'Asia/Kolkata')).toBe('GMT+5:30');
  });

  it('finds local midnight across a DST change', () => {
    // US spring-forward 2026-03-08: the local day is 23 hours long.
    const b = dayBounds(new Date('2026-03-08T15:00:00Z'), 'America/New_York');
    expect(b.isoDate).toBe('2026-03-08');
    expect(b.start.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(b.end.toISOString()).toBe('2026-03-09T04:00:00.000Z');
  });

  it('handles a date west of the antimeridian', () => {
    const m = localMidnight(2026, 9, 11, 'Pacific/Honolulu');
    expect(m.toISOString()).toBe('2026-09-11T10:00:00.000Z');
  });

  it('keeps wall-clock time when stepping days', () => {
    const t = new Date('2026-09-11T18:30:00Z'); // 14:30 in New York
    const next = addLocalDays(t, 1, 'America/New_York');
    expect(next.toISOString()).toBe('2026-09-12T18:30:00.000Z');
  });

  it('sets wall-clock seconds', () => {
    const t = withLocalTime(new Date('2026-09-11T18:30:00Z'), 6 * 3600 + 33 * 60, 'America/New_York');
    expect(t.toISOString()).toBe('2026-09-11T10:33:00.000Z');
  });
});
