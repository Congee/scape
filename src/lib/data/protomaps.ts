/** Protomaps daily basemap builds. Pure: URL and date arithmetic only. */

export const PROTOMAPS_BUILD = 'https://build.protomaps.com';

const stamp = (d: Date): string =>
  `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;

export function buildUrl(yyyymmdd: string): string {
  return `${PROTOMAPS_BUILD}/${yyyymmdd}.pmtiles`;
}

/** Today's UTC build first, then earlier days: the current day is not published until late. */
export function buildDateCandidates(date = new Date(), back = 10): string[] {
  const out: string[] = [];
  for (let i = 0; i <= back; i++) out.push(stamp(new Date(date.getTime() - i * 86_400_000)));
  return out;
}

export function defaultBasemapSourceUrl(date = new Date()): string {
  return buildUrl(stamp(date));
}
