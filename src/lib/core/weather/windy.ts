/** Windy's cloud view centred on a point; zoom follows Windy's own scale. */
export function windyUrl(lat: number, lng: number, zoom = 9): string {
  const la = lat.toFixed(4);
  const lo = (((((lng + 180) % 360) + 360) % 360) - 180).toFixed(4);
  return `https://www.windy.com/${la}/${lo}?clouds,${la},${lo},${Math.round(zoom)}`;
}
