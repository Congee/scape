/** How swissBUILDINGS3D and 3DBAG announce their newest release, and the tileset each release serves. */

const SWISS_BASE = 'https://3d.geo.admin.ch/ch.swisstopo.swissbuildings3d.3d/v1';
/** Undated: always the newest publication, whose children name its date. Never walked itself, so a flip mid-session cannot mix releases. */
export const SWISS_LATEST = `${SWISS_BASE}/tileset.json`;
export const SWISS_RELEASE = '20260520';
export const swissTileset = (release: string): string => `${SWISS_BASE}/${release}/tileset.json`;

/** The publication date shared by every child of the undated tileset, e.g. "20261116"; null when there is none or they disagree. */
export function swissRelease(tilesetJson: string): string | null {
  const dates = new Set([...tilesetJson.matchAll(/"uri"\s*:\s*"(\d{8})\//g)].map((m) => m[1]));
  return dates.size === 1 ? [...dates][0] : null;
}

const BAG3D_BASE = 'https://data.3dbag.nl';
/** Redirects to the newest release's tileset. */
export const BAG3D_LATEST = `${BAG3D_BASE}/latest/cesium3dtiles/lod22/tileset.json`;
export const BAG3D_RELEASE = 'v20250903';
export const bag3dTileset = (release: string): string => `${BAG3D_BASE}/${release}/cesium3dtiles/lod22/tileset.json`;

/** The release in the URL `BAG3D_LATEST` redirected to, e.g. "v20250903"; null when it did not redirect to one. */
export function bag3dRelease(finalUrl: string): string | null {
  return /^https:\/\/data\.3dbag\.nl\/(v\d{8})\//.exec(finalUrl)?.[1] ?? null;
}
