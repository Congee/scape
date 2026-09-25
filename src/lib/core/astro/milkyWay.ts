import type { Observer } from 'astronomy-engine';
import { horizonAngleAt, type HorizonProfile } from '@core/terrain/horizon';
import { SkyBody } from './bodies';
import type { DayCurve } from './dayCurve';
import { lunarEclipseLight } from './eclipse';
import { moonInfo, position } from './positions';

export const MoonRule = {
  /** Moonlight does not matter. */
  Ignore: 'Ignore',
  /** The moon must be below the horizon. */
  Down: 'Down',
  /** A moon up to `moonMaxIllumination` may be up. */
  Dim: 'Dim'
} as const;
export type MoonRule = (typeof MoonRule)[keyof typeof MoonRule];

export interface MilkyWayOptions {
  /** Sun altitude below which the sky counts as dark, degrees (−18 is astronomical night). */
  sunMaxAltDeg: number;
  /** Altitude the Galactic Centre must reach, degrees. */
  gcMinAltDeg: number;
  moonRule: MoonRule;
  /** Illumination tolerated by `MoonRule.Dim` while the moon is up, 0..1; an eclipse dims it. */
  moonMaxIllumination: number;
}

export const DEFAULT_MILKY_WAY_OPTIONS: MilkyWayOptions = { sunMaxAltDeg: -18, gcMinAltDeg: 10, moonRule: MoonRule.Down, moonMaxIllumination: 0.25 };

export interface MilkyWayWindow {
  startMs: number;
  endMs: number;
  /** When the core stands highest inside the window. */
  peakMs: number;
  peakAltDeg: number;
  azStartDeg: number;
  azEndDeg: number;
  altStartDeg: number;
  altEndDeg: number;
  /** The window runs into the day boundary rather than ending on a condition. */
  clippedStart: boolean;
  clippedEnd: boolean;
}

export interface MilkyWayStatus {
  azimuthDeg: number;
  altitudeDeg: number;
  sunAltDeg: number;
  moonAltDeg: number;
  moonIllumination: number;
  /** Altitude the core must clear here: the rule's minimum or the terrain skyline. */
  floorDeg: number;
  dark: boolean;
  coreUp: boolean;
  moonOk: boolean;
  visible: boolean;
}

/** Whether the core counts as visible at one instant under the options. */
export function milkyWayStatus(obs: Observer, timeMs: number, opts: MilkyWayOptions, horizon?: HorizonProfile): MilkyWayStatus {
  const d = new Date(timeMs);
  const sun = position(SkyBody.Sun, d, obs).altitude;
  const gc = position(SkyBody.Gc, d, obs);
  const moon = position(SkyBody.Moon, d, obs).altitude;
  const floor = horizon ? Math.max(opts.gcMinAltDeg, horizonAngleAt(horizon, gc.azimuth)) : opts.gcMinAltDeg;
  const illumination = moonInfo(d).illumination;
  const dark = sun <= opts.sunMaxAltDeg;
  const coreUp = gc.altitude >= floor;
  const moonOk = moonAllowed(opts, moon, () => illumination * lunarEclipseLight(d));
  return { azimuthDeg: gc.azimuth, altitudeDeg: gc.altitude, sunAltDeg: sun, moonAltDeg: moon, moonIllumination: illumination, floorDeg: floor, dark, coreUp, moonOk, visible: dark && coreUp && moonOk };
}

// Brightness is lazy: the eclipse check only runs for an up moon under `Dim`.
function moonAllowed(opts: MilkyWayOptions, moonAlt: number, brightness: () => number): boolean {
  if (opts.moonRule === MoonRule.Ignore || moonAlt < 0) return true;
  return opts.moonRule === MoonRule.Dim && brightness() <= opts.moonMaxIllumination;
}

/**
 * Periods within the day curve when the Galactic Centre is up in a dark, moon-free enough sky.
 * Brackets on the curve samples, then bisects each boundary with exact positions.
 */
export function milkyWayWindows(obs: Observer, curve: DayCurve, opts: MilkyWayOptions, horizon?: HorizonProfile): MilkyWayWindow[] {
  const sunAlt = curve.altitude[SkyBody.Sun];
  const gcAlt = curve.altitude[SkyBody.Gc];
  const gcAz = curve.azimuth[SkyBody.Gc];
  const moonAlt = curve.altitude[SkyBody.Moon];
  const timeAt = (i: number) => curve.startMs + i * curve.stepMs;
  const floorAt = (az: number) => (horizon ? Math.max(opts.gcMinAltDeg, horizonAngleAt(horizon, az)) : opts.gcMinAltDeg);
  const okSample = (i: number) => {
    if (sunAlt[i] > opts.sunMaxAltDeg || gcAlt[i] < floorAt(gcAz[i])) return false;
    const d = new Date(timeAt(i));
    return moonAllowed(opts, moonAlt[i], () => moonInfo(d).illumination * lunarEclipseLight(d));
  };
  const okExact = (ms: number) => milkyWayStatus(obs, ms, opts, horizon).visible;
  // Boundary between a sample that fails and one that passes, to a few seconds.
  const refine = (lo: number, hi: number, loOk: boolean) => {
    for (let k = 0; k < 16; k++) {
      const mid = (lo + hi) / 2;
      if (okExact(mid) === loOk) lo = mid;
      else hi = mid;
    }
    return Math.round((lo + hi) / 2);
  };

  const out: MilkyWayWindow[] = [];
  let i = 0;
  while (i < curve.n) {
    if (!okSample(i)) {
      i++;
      continue;
    }
    const first = i;
    while (i + 1 < curve.n && okSample(i + 1)) i++;
    const last = i;
    i++;
    let peak = first;
    for (let k = first; k <= last; k++) if (gcAlt[k] > gcAlt[peak]) peak = k;
    const clippedStart = first === 0;
    const clippedEnd = last === curve.n - 1;
    const startMs = clippedStart ? timeAt(0) : refine(timeAt(first - 1), timeAt(first), false);
    const endMs = clippedEnd ? timeAt(last) : refine(timeAt(last), timeAt(last + 1), true);
    const a = position(SkyBody.Gc, new Date(startMs), obs);
    const b = position(SkyBody.Gc, new Date(endMs), obs);
    out.push({ startMs, endMs, peakMs: timeAt(peak), peakAltDeg: gcAlt[peak], azStartDeg: a.azimuth, azEndDeg: b.azimuth, altStartDeg: a.altitude, altEndDeg: b.altitude, clippedStart, clippedEnd });
  }
  // A window split only by the day boundary is one night: merge nothing here, the caller sees both halves.
  return out;
}
