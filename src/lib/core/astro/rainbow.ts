import { azAltFromDir, dirFromAzAlt, type Vec3 } from '@core/optics/projection';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Refractive index of water: red 656 nm, sodium D 589 nm, violet 405 nm. */
export const WATER_N = { Red: 1.3311, Yellow: 1.333, Violet: 1.3435 } as const;

/** Descartes' minimum-deviation ray: radius of the `k`-reflection bow around the antisolar point, degrees. */
export function rainbowRadiusDeg(n: number, k: number): number {
  const i = Math.acos(Math.sqrt((n * n - 1) / (k * (k + 2))));
  const r = Math.asin(Math.sin(i) / n);
  const dev = (k * Math.PI + 2 * i - 2 * (k + 1) * r) * R2D;
  return Math.abs((((dev % 360) + 360) % 360) - 180);
}

export const PRIMARY_DEG = rainbowRadiusDeg(WATER_N.Yellow, 1);
export const SECONDARY_DEG = rainbowRadiusDeg(WATER_N.Yellow, 2);

export interface RainbowTop {
  azimuthDeg: number;
  altitudeDeg: number;
  /** Some of the bow stands above the horizon. */
  possible: boolean;
  /** Half the horizon span between the bow's feet, degrees of azimuth. */
  halfSpanDeg: number;
}

/** The bow's top sits straight above the antisolar point, `radius − sunAlt` up. */
export function rainbowTop(sunAzDeg: number, sunAltDeg: number, radiusDeg = PRIMARY_DEG): RainbowTop {
  const possible = sunAltDeg > 0 && sunAltDeg < radiusDeg;
  const c = Math.cos(radiusDeg * D2R) / Math.cos(sunAltDeg * D2R);
  return {
    azimuthDeg: (((sunAzDeg + 180) % 360) + 360) % 360,
    altitudeDeg: radiusDeg - sunAltDeg,
    possible,
    halfSpanDeg: possible ? Math.acos(Math.min(1, c)) * R2D : 0
  };
}

/** Antisolar axis `a` and the in-plane directions `u` (towards the zenith side) and `v`. */
function bowBasis(sunAzDeg: number, sunAltDeg: number): { a: Vec3; u: Vec3; v: Vec3 } {
  const a = dirFromAzAlt(sunAzDeg + 180, -sunAltDeg);
  let u: Vec3 = { x: -a.z * a.x, y: -a.z * a.y, z: 1 - a.z * a.z };
  const ul = Math.hypot(u.x, u.y, u.z);
  // Sun at the zenith: any perpendicular works.
  u = ul > 1e-9 ? { x: u.x / ul, y: u.y / ul, z: u.z / ul } : { x: 1, y: 0, z: 0 };
  const v: Vec3 = { x: a.y * u.z - a.z * u.y, y: a.z * u.x - a.x * u.z, z: a.x * u.y - a.y * u.x };
  return { a, u, v };
}

const dot = (p: Vec3, q: Vec3) => p.x * q.x + p.y * q.y + p.z * q.z;

/**
 * Arc parameter range (radians, 0 at the top) of the bow lying within `halfDeg` of a view
 * direction, so a long lens samples only the part it sees; null when none of it is that close.
 */
export function arcWindow(sunAzDeg: number, sunAltDeg: number, radiusDeg: number, viewAzDeg: number, viewAltDeg: number, halfDeg: number): [number, number] | null {
  const { a, u, v } = bowBasis(sunAzDeg, sunAltDeg);
  const w = dirFromAzAlt(viewAzDeg, viewAltDeg);
  const dv = Math.acos(Math.max(-1, Math.min(1, dot(w, a))));
  const r = radiusDeg * D2R;
  const h = halfDeg * D2R;
  const den = Math.sin(r) * Math.sin(dv);
  if (den < 1e-9) return Math.abs(dv - r) <= h ? [-Math.PI, Math.PI] : null;
  const c = (Math.cos(h) - Math.cos(r) * Math.cos(dv)) / den;
  if (c > 1) return null;
  if (c <= -1) return [-Math.PI, Math.PI];
  const t0 = Math.atan2(dot(w, v), dot(w, u));
  const d = Math.acos(c);
  return [t0 - d, t0 + d];
}

/** Points of the bow at or above `minAltDeg`, over parameter `range` (default the whole circle, foot to foot through the top). */
export function rainbowArc(
  sunAzDeg: number,
  sunAltDeg: number,
  radiusDeg: number,
  minAltDeg = 0,
  steps = 240,
  range: readonly [number, number] = [-Math.PI, Math.PI]
): { azimuthDeg: number; altitudeDeg: number }[] {
  const { a, u, v } = bowBasis(sunAzDeg, sunAltDeg);
  const cr = Math.cos(radiusDeg * D2R);
  const sr = Math.sin(radiusDeg * D2R);
  const out: { azimuthDeg: number; altitudeDeg: number }[] = [];
  for (let s = 0; s <= steps; s++) {
    const t = range[0] + ((range[1] - range[0]) * s) / steps;
    const ct = Math.cos(t);
    const st = Math.sin(t);
    const p = azAltFromDir({ x: cr * a.x + sr * (ct * u.x + st * v.x), y: cr * a.y + sr * (ct * u.y + st * v.y), z: cr * a.z + sr * (ct * u.z + st * v.z) });
    if (p.altitudeDeg >= minAltDeg) out.push(p);
  }
  return out;
}
