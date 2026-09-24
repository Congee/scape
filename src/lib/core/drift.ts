import type { FeatureCollection } from 'geojson';

const D2R = Math.PI / 180;
/** Fastest a sky point turns about the pole, sidereal rate with a margin; the sun and moon are slower. */
const SKY_DEG_PER_MS = 15.1 / 3_600_000;

/** True when two store snapshots differ in `key` alone. */
export function onlyChanged<T extends object>(a: T, b: T, key: keyof T): boolean {
  for (const k in a) if (k !== key && a[k] !== b[k]) return false;
  return true;
}

/** Degrees between two alt/az directions. */
export function skyAngleDeg(alt0: number, az0: number, alt1: number, az1: number): number {
  const c = Math.sin(alt0 * D2R) * Math.sin(alt1 * D2R) + Math.cos(alt0 * D2R) * Math.cos(alt1 * D2R) * Math.cos((az1 - az0) * D2R);
  return Math.acos(Math.min(1, Math.max(-1, c))) / D2R;
}

/** Most any sky point can move on a rectilinear frame over dtMs: the centre scale stretched 1/cos² at the corner. */
export function skyDriftPx(dtMs: number, pxPerDegCentre: number, halfDiagDeg: number): number {
  const c = Math.cos(Math.min(halfDiagDeg, 89) * D2R);
  return (Math.abs(dtMs) * SKY_DEG_PER_MS * pxPerDegCentre) / (c * c);
}

type Project = (lngLat: [number, number]) => { x: number; y: number };

/**
 * Largest on-screen move of a line vertex between two renders of the same lines; Infinity when the lines
 * or their properties differ. Only vertices on screen, or next to one, count.
 */
export function linesShiftPx(a: FeatureCollection, b: FeatureCollection, project: Project, w: number, h: number): number {
  if (a.features.length !== b.features.length) return Infinity;
  const on = (p: { x: number; y: number }) => p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h;
  let max = 0;
  for (let i = 0; i < a.features.length; i++) {
    const fa = a.features[i];
    const fb = b.features[i];
    if (fa.geometry.type !== 'LineString' || fb.geometry.type !== 'LineString') return Infinity;
    if (JSON.stringify(fa.properties) !== JSON.stringify(fb.properties)) return Infinity;
    const ca = fa.geometry.coordinates;
    const cb = fb.geometry.coordinates;
    if (ca.length !== cb.length) return Infinity;
    const pa = ca.map((c) => project(c as [number, number]));
    const pb = cb.map((c) => project(c as [number, number]));
    const seen = pa.map((p, j) => on(p) || on(pb[j]));
    for (let j = 0; j < pa.length; j++) {
      if (!seen[j] && !seen[j - 1] && !seen[j + 1]) continue;
      max = Math.max(max, Math.hypot(pa[j].x - pb[j].x, pa[j].y - pb[j].y));
    }
  }
  return max;
}
