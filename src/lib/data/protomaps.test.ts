import { describe, expect, it } from 'vitest';
import { buildDateCandidates, defaultBasemapSourceUrl } from './protomaps';

describe('protomaps builds', () => {
  it('names the UTC day of the build', () => {
    expect(defaultBasemapSourceUrl(new Date('2026-09-12T23:30:00Z'))).toBe('https://build.protomaps.com/20260912.pmtiles');
    // Local time in the western hemisphere is still the 11th; the build is named in UTC.
    expect(defaultBasemapSourceUrl(new Date('2026-01-01T00:10:00Z'))).toBe('https://build.protomaps.com/20260101.pmtiles');
  });

  it('walks back over month and year boundaries', () => {
    expect(buildDateCandidates(new Date('2026-03-02T12:00:00Z'), 3)).toEqual(['20260302', '20260301', '20260228', '20260227']);
    expect(buildDateCandidates(new Date('2026-01-01T12:00:00Z'), 1)).toEqual(['20260101', '20251231']);
  });
});
