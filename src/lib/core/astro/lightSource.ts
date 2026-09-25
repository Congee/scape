import type { Observer } from 'astronomy-engine';
import { horizonAngleAt, type HorizonProfile } from '@core/terrain/horizon';
import { SkyBody } from './bodies';
import { lunarEclipseLight } from './eclipse';
import type { DayCurve } from './dayCurve';
import { EventKind, type DayEvent } from './dayEvents';
import { position } from './positions';
import { SEMIDIAMETER_DEG, terrainRiseSet } from './terrainEvents';

/** Which body casts the shadows: the sun by day and the moon by night, or one of them held. */
export const LightMode = { Auto: 'Auto', Sun: 'Sun', Moon: 'Moon' } as const;
export type LightMode = (typeof LightMode)[keyof typeof LightMode];

/** Civil dusk: past it the moon outshines what is left of the day. */
export const MOON_TAKES_OVER_DEG = -6;

/** An eclipsed moon this dim casts no shadow worth drawing. */
const ECLIPSED_MOON_MIN_LIGHT = 0.02;

export type LightBody = typeof SkyBody.Sun | typeof SkyBody.Moon;

/** The body lighting the ground, or null when neither is up (or, in Auto, during the dusk gap). */
export function pickLight(mode: LightMode, sunAltDeg: number, moonAltDeg: number): LightBody | null {
  if (mode === LightMode.Sun) return sunAltDeg > 0 ? SkyBody.Sun : null;
  if (mode === LightMode.Moon) return moonAltDeg > 0 ? SkyBody.Moon : null;
  if (sunAltDeg > 0) return SkyBody.Sun;
  return sunAltDeg < MOON_TAKES_OVER_DEG && moonAltDeg > 0 ? SkyBody.Moon : null;
}

export interface FirstLastLight {
  /** When the sun's upper limb first and last clears the skyline, ms; null when that edge falls outside the day. */
  first: number | null;
  last: number | null;
  /** Time with the sun above the skyline over the day, ms. */
  litMs: number;
  /** The sun is above the skyline at `nowMs`. */
  litNow: boolean;
}

/** Some of the sun's disc clears the point's skyline. */
export function sunLitAt(obs: Observer, horizon: HorizonProfile, ms: number): boolean {
  const p = position(SkyBody.Sun, new Date(ms), obs);
  return p.altitude + SEMIDIAMETER_DEG.Sun - horizonAngleAt(horizon, p.azimuth) >= 0;
}

/** Stretches of direct sun from `curve.startMs` to `endMs` against the point's skyline, with the sun's skyline crossings. */
export function sunLitSpans(obs: Observer, curve: DayCurve, horizon: HorizonProfile, endMs: number): { spans: [number, number][]; events: DayEvent[] } {
  const events = terrainRiseSet(obs, curve, horizon, endMs).filter((e) => e.body === SkyBody.Sun);
  const spans: [number, number][] = [];
  let since = sunLitAt(obs, horizon, curve.startMs) ? curve.startMs : null;
  for (const e of events) {
    if (e.kind === EventKind.TerrainRise) since = e.time;
    else if (since !== null) {
      spans.push([since, e.time]);
      since = null;
    }
  }
  if (since !== null) spans.push([since, endMs]);
  return { spans, events };
}

/** First and last direct sun at a point over one day, against that point's own skyline. */
export function firstLastLight(obs: Observer, curve: DayCurve, horizon: HorizonProfile, endMs: number, nowMs: number): FirstLastLight {
  const { spans, events } = sunLitSpans(obs, curve, horizon, endMs);
  return {
    first: events.find((e) => e.kind === EventKind.TerrainRise)?.time ?? null,
    last: events.findLast((e) => e.kind === EventKind.TerrainSet)?.time ?? null,
    litMs: spans.reduce((sum, [a, b]) => sum + b - a, 0),
    litNow: sunLitAt(obs, horizon, nowMs)
  };
}

export interface Light {
  body: LightBody;
  azimuthDeg: number;
  altitudeDeg: number;
}

/** The picked body and where it stands. */
export function lightAt(mode: LightMode, date: Date, obs: Observer): Light | null {
  const sun = position(SkyBody.Sun, date, obs);
  const moon = position(SkyBody.Moon, date, obs);
  const body = pickLight(mode, sun.altitude, moon.altitude);
  if (!body) return null;
  if (body === SkyBody.Moon && lunarEclipseLight(date) < ECLIPSED_MOON_MIN_LIGHT) return null;
  const p = body === SkyBody.Sun ? sun : moon;
  return { body, azimuthDeg: p.azimuth, altitudeDeg: p.altitude };
}
