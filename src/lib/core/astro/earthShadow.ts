import { Body, SearchAltitude, type Observer } from 'astronomy-engine';
import { EARTH_RADIUS_M } from '@core/geo/geodesy';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Lowest height still in sunlight straight above a point where the sun is at `sunAltDeg`: R(sec δ − 1). */
export function litHeightM(sunAltDeg: number): number {
  if (sunAltDeg >= 0) return 0;
  const c = Math.cos(-sunAltDeg * D2R);
  return c > 0 ? EARTH_RADIUS_M * (1 / c - 1) : Infinity;
}

/** Sun depression at which a point `heightM` up leaves the Earth's shadow. */
export function depressionForHeightDeg(heightM: number): number {
  return Math.acos(EARTH_RADIUS_M / (EARTH_RADIUS_M + Math.max(0, heightM))) * R2D;
}

/** Sun altitude seen from the ground `distM` away along `bearingDeg`. */
export function sunAltitudeAtDeg(sunAltDeg: number, sunAzDeg: number, bearingDeg: number, distM: number): number {
  const z = (90 - sunAltDeg) * D2R;
  const g = distM / EARTH_RADIUS_M;
  const cz = Math.cos(z) * Math.cos(g) + Math.sin(z) * Math.sin(g) * Math.cos((bearingDeg - sunAzDeg) * D2R);
  return 90 - Math.acos(Math.max(-1, Math.min(1, cz))) * R2D;
}

/** Whether a cloud `heightM` up, `distM` away along `bearingDeg`, is still sunlit. */
export function cloudSunlit(heightM: number, distM: number, bearingDeg: number, sun: { altitudeDeg: number; azimuthDeg: number }): boolean {
  return litHeightM(sunAltitudeAtDeg(sun.altitudeDeg, sun.azimuthDeg, bearingDeg, distM)) <= heightM;
}

/** When the Earth's shadow next climbs past `heightM` overhead (geometric, no refraction), or null within a day. */
export function lastLightMs(obs: Observer, fromMs: number, heightM: number): number | null {
  const t = SearchAltitude(Body.Sun, obs, -1, new Date(fromMs), 1, -depressionForHeightDeg(heightM));
  return t ? t.date.getTime() : null;
}
