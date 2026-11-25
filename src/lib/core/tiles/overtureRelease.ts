/** Overture keeps only its last two tile releases, so the app picks the newest one from the bucket listing. */

export const OVERTURE_TILES_BUCKET = 'https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com';
/** Keys rather than prefixes: a release directory can appear before its archive finishes uploading. */
export const OVERTURE_TILES_LISTING = `${OVERTURE_TILES_BUCKET}/?list-type=2&prefix=tiles/`;

export const overtureTilesUrl = (release: string, theme: string): string => `${OVERTURE_TILES_BUCKET}/tiles/${release}/${theme}.pmtiles`;

const RELEASE = /^(\d{4}-\d{2}-\d{2})\.(\d+)$/;

/** -1, 0, 1 for releases like "2026-11-18.0"; the date first, then the numeric revision. */
export function compareReleases(a: string, b: string): number {
  const ma = RELEASE.exec(a);
  const mb = RELEASE.exec(b);
  if (!ma || !mb) return 0;
  if (ma[1] !== mb[1]) return ma[1] < mb[1] ? -1 : 1;
  return Math.sign(Number(ma[2]) - Number(mb[2]));
}

/** The newest release in an S3 ListObjectsV2 body that holds `<theme>.pmtiles`; null when none does. */
export function newestOvertureRelease(listingXml: string, theme: string): string | null {
  let best: string | null = null;
  for (const m of listingXml.matchAll(/<Key>tiles\/([^/<]+)\/([^/<]+)\.pmtiles<\/Key>/g)) {
    if (m[2] !== theme || !RELEASE.test(m[1])) continue;
    if (best === null || compareReleases(m[1], best) > 0) best = m[1];
  }
  return best;
}
