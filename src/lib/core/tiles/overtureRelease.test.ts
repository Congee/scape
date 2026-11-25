import { describe, expect, it } from 'vitest';
import { compareReleases, newestOvertureRelease, overtureTilesUrl } from './overtureRelease';

const listing = (keys: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>overturemaps-extras-us-west-2</Name><Prefix>tiles/</Prefix>${keys.map((k) => `<Contents><Key>${k}</Key><Size>1</Size></Contents>`).join('')}</ListBucketResult>`;

describe('newestOvertureRelease', () => {
  it('picks the newest release that holds the theme', () => {
    const xml = listing(['tiles/2026-10-21.0/buildings.pmtiles', 'tiles/2026-11-18.0/base.pmtiles', 'tiles/2026-11-18.0/buildings.pmtiles', 'tiles/2026-10-21.0/places.pmtiles']);
    expect(newestOvertureRelease(xml, 'buildings')).toBe('2026-11-18.0');
  });

  it('skips a newer release whose archive is not uploaded yet', () => {
    const xml = listing(['tiles/2026-10-21.0/buildings.pmtiles', 'tiles/2026-12-16.0/base.pmtiles']);
    expect(newestOvertureRelease(xml, 'buildings')).toBe('2026-10-21.0');
  });

  it('does not trust listing order and compares revisions numerically', () => {
    const xml = listing(['tiles/2026-11-18.10/buildings.pmtiles', 'tiles/2026-11-18.9/buildings.pmtiles', 'tiles/2026-10-21.0/buildings.pmtiles']);
    expect(newestOvertureRelease(xml, 'buildings')).toBe('2026-11-18.10');
  });

  it('ignores keys that are not releases or not archives', () => {
    const xml = listing(['tiles/latest/buildings.pmtiles', 'tiles/2026-11-18.0/buildings.pmtiles.tmp', 'tiles/2026-11-18.0/sub/buildings.pmtiles', 'other/2027-01-01.0/buildings.pmtiles']);
    expect(newestOvertureRelease(xml, 'buildings')).toBeNull();
  });

  it('returns null for an empty or garbled body', () => {
    expect(newestOvertureRelease(listing([]), 'buildings')).toBeNull();
    expect(newestOvertureRelease('<Error><Code>AccessDenied</Code></Error>', 'buildings')).toBeNull();
    expect(newestOvertureRelease('', 'buildings')).toBeNull();
  });
});

describe('compareReleases', () => {
  it('orders by date, then revision', () => {
    expect(compareReleases('2026-10-21.0', '2026-11-18.0')).toBe(-1);
    expect(compareReleases('2026-11-18.1', '2026-11-18.0')).toBe(1);
    expect(compareReleases('2026-11-18.0', '2026-11-18.0')).toBe(0);
  });
});

describe('overtureTilesUrl', () => {
  it('builds the archive URL of a release', () => {
    expect(overtureTilesUrl('2026-11-18.0', 'buildings')).toBe('https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/2026-11-18.0/buildings.pmtiles');
  });
});
