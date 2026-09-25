/** Windy counts 256 px tiles, MapLibre 512 px, so its zoom runs one higher. */
const MAP_ZOOM_OFFSET = 1;
/** Windy's zoom range; its forecast pane forces at least FORECAST_MIN_ZOOM. */
const MIN_ZOOM = 3;
const MAX_ZOOM = 16;
const FORECAST_MIN_ZOOM = 8;

/** Windy's cloud view centred on a point; zoom follows Windy's own scale, with the point forecast when Windy keeps that zoom. */
export function windyUrl(lat: number, lng: number, zoom = 9): string {
  const la = lat.toFixed(4);
  const lo = (((((lng + 180) % 360) + 360) % 360) - 180).toFixed(4);
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom)));
  const path = z >= FORECAST_MIN_ZOOM ? `/${la}/${lo}` : '/';
  return `https://www.windy.com${path}?clouds,${la},${lo},${z}`;
}

/** Windy showing the same ground scale as a MapLibre view. */
export function windyMapUrl(lat: number, lng: number, mapZoom: number): string {
  return windyUrl(lat, lng, mapZoom + MAP_ZOOM_OFFSET);
}
