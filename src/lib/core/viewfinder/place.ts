import { horizontalOf, refractEnu } from '@core/astro/skyFrame';
import type { Occluder } from '@core/geo/meshOcclude';
import { project, type Camera, type CameraBasis } from '@core/optics/projection';
import { flatHorizonDeg } from '@core/terrain/los';
import { columnAt, type ViewProfile } from '@core/terrain/view';
import type { Rect } from './frameFit';

const D2R = Math.PI / 180;
const SIN_10_DEG = Math.sin(10 * D2R);
const LIFT = new Float64Array(3);

/** Sensor frame on the canvas, CSS px. */
export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
  pxPerMm: number;
}

/** What placing a direction on the canvas needs from the scene. */
export interface PlaceView {
  cam: Camera;
  basis: CameraBasis;
  frame: Frame;
  /** Picture area the scene fills around the frame, CSS px. */
  area: Rect;
  view: ViewProfile | null;
  eyeAboveGroundM: number;
  /** Air at the eye relative to sea level; scales refraction. */
  airDensity: number;
  /** Highest skyline angle in the sweep; directions above it need no occlusion test. */
  maxSkyline: number;
}

export interface Placed {
  x: number;
  y: number;
  altDeg: number;
  /** Behind the terrain skyline (or below the flat horizon). */
  hidden: boolean;
}

export function toPx(sc: PlaceView, azDeg: number, altDeg: number): { x: number; y: number } | null {
  const p = project(sc.cam, sc.basis, azDeg, altDeg);
  if (!p) return null;
  return { x: sc.frame.x + sc.frame.w / 2 + p.x * sc.frame.pxPerMm, y: sc.frame.y + sc.frame.h / 2 - p.y * sc.frame.pxPerMm };
}

export function inView(sc: PlaceView, p: { x: number; y: number } | null, slack = 0): p is { x: number; y: number } {
  const a = sc.area;
  return !!p && p.x >= a.x - slack && p.x <= a.x + a.w + slack && p.y >= a.y - slack && p.y <= a.y + a.h + slack;
}

export function hiddenBySkyline(sc: PlaceView, azDeg: number, altDeg: number): boolean {
  if (!sc.view) return altDeg < flatHorizonDeg(sc.eyeAboveGroundM);
  const col = columnAt(sc.view, azDeg);
  return col >= 0 && altDeg < sc.view.skylineDeg[col];
}

/** True when a building stands between the eye and a direction; `distM` is Infinity for the sky. */
export function behindBuilding(occ: Occluder | null, azDeg: number, altDeg: number, distM: number): boolean {
  if (!occ) return false;
  const ca = Math.cos(altDeg * D2R);
  return occ.occludes(ca * Math.sin(azDeg * D2R), ca * Math.cos(azDeg * D2R), Math.sin(altDeg * D2R), distM);
}

/**
 * Frame position of a local direction. Low directions take the exact path; the rest, refracted,
 * project straight through the camera basis, which is what makes 9k stars cheap.
 * `buildings` false leaves them to the picture pass, which tests each drawn pixel instead.
 */
export function placeEnu(sc: PlaceView, occ: Occluder | null, e: number, n: number, u: number, slack: number, buildings = true): Placed | null {
  const len = Math.hypot(e, n, u);
  const uz = u / len;
  if (uz < -0.05) return null;
  let az = Number.NaN;
  let alt: number;
  let p: { x: number; y: number } | null;
  if (uz < SIN_10_DEG) {
    const h = horizontalOf(e / len, n / len, uz, sc.airDensity);
    az = h.azimuthDeg;
    alt = h.altitudeDeg;
    p = toPx(sc, az, alt);
  } else {
    const { forward: F, right: R, up: U } = sc.basis;
    refractEnu(e / len, n / len, uz, LIFT, sc.airDensity);
    const le = LIFT[0];
    const ln = LIFT[1];
    const lu = LIFT[2];
    alt = Math.asin(lu) / D2R;
    const depth = le * F.x + ln * F.y + lu * F.z;
    if (depth <= 1e-6) return null;
    const xs = ((le * R.x + ln * R.y + lu * R.z) / depth) * sc.cam.focalMm;
    const ys = ((le * U.x + ln * U.y + lu * U.z) / depth) * sc.cam.focalMm;
    p = { x: sc.frame.x + sc.frame.w / 2 + xs * sc.frame.pxPerMm, y: sc.frame.y + sc.frame.h / 2 - ys * sc.frame.pxPerMm };
  }
  if (!inView(sc, p, slack)) return null;
  let hidden = false;
  if (alt < sc.maxSkyline) {
    if (Number.isNaN(az)) az = Math.atan2(e, n) / D2R;
    hidden = hiddenBySkyline(sc, az, alt);
  }
  if (!hidden && buildings && occ) hidden = occ.occludes(e, n, u, Infinity);
  return { x: p.x, y: p.y, altDeg: alt, hidden };
}

/** Elevation angle of the terrain surface at a distance along an azimuth, from the sweep's visible points. */
export function surfaceAngle(sc: PlaceView, az: number, d: number): number | null {
  if (!sc.view) return flatHorizonDeg(sc.eyeAboveGroundM);
  const col = columnAt(sc.view, az);
  if (col < 0) return null;
  let best = sc.view.start[col];
  for (let m = sc.view.start[col]; m < sc.view.start[col + 1]; m++) {
    if (sc.view.distM[m] <= d) best = m;
    else break;
  }
  return sc.view.start[col] === sc.view.start[col + 1] ? null : sc.view.angleDeg[best];
}
