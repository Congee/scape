import type { Observer } from 'astronomy-engine';
import type { HorizonProfile } from '@core/terrain/horizon';
import { SkyBody } from './bodies';
import { dayCurve } from './dayCurve';
import { EventKind } from './dayEvents';
import { sunLitAt } from './lightSource';
import { position } from './positions';
import { terrainRiseSet } from './terrainEvents';

export const GlowKind = { Sunrise: 'Sunrise', Sunset: 'Sunset' } as const;
export type GlowKind = (typeof GlowKind)[keyof typeof GlowKind];

/** A stretch of direct sun at the point while the Sun is low. */
export interface GlowWindow {
  kind: GlowKind;
  startMs: number;
  endMs: number;
  midMs: number;
  /** The Sun at `midMs`: azimuth, and apparent altitude of its centre, degrees. */
  azimuthDeg: number;
  altitudeDeg: number;
}

export interface GlowDay {
  startMs: number;
  endMs: number;
  sunrise: GlowWindow | null;
  sunset: GlowWindow | null;
}

type Span = [number, number];

function intersect(a: Span[], b: Span[]): Span[] {
  const out: Span[] = [];
  for (const [a0, a1] of a) for (const [b0, b1] of b) if (Math.min(a1, b1) > Math.max(a0, b0)) out.push([Math.max(a0, b0), Math.min(a1, b1)]);
  return out.toSorted((x, y) => x[0] - y[0]);
}

/**
 * The morning and evening windows over one day when the point's own skyline lets the Sun through
 * and the Sun's centre stands at most `lowDeg` high.
 */
export function glowDay(obs: Observer, horizon: HorizonProfile, startMs: number, endMs: number, lowDeg: number): GlowDay {
  const curve = dayCurve(obs, startMs, endMs);
  const alt = curve.altitude[SkyBody.Sun];

  const lit: Span[] = [];
  let since = sunLitAt(obs, horizon, startMs) ? startMs : null;
  for (const e of terrainRiseSet(obs, curve, horizon, endMs)) {
    if (e.body !== SkyBody.Sun) continue;
    if (e.kind === EventKind.TerrainRise) since = e.time;
    else if (since !== null) {
      lit.push([since, e.time]);
      since = null;
    }
  }
  if (since !== null) lit.push([since, endMs]);

  const lowAt = (ms: number) => position(SkyBody.Sun, new Date(ms), obs).altitude <= lowDeg;
  const low: Span[] = [];
  let from: number | null = alt[0] <= lowDeg ? startMs : null;
  let transit = 0;
  for (let i = 1; i < curve.n; i++) {
    if (alt[i] > alt[transit]) transit = i;
    const was = alt[i - 1] <= lowDeg;
    if ((alt[i] <= lowDeg) === was) continue;
    let lo = startMs + (i - 1) * curve.stepMs;
    let hi = lo + curve.stepMs;
    for (let k = 0; k < 20; k++) {
      const mid = (lo + hi) / 2;
      if (lowAt(mid) === was) lo = mid;
      else hi = mid;
    }
    const t = Math.min(Math.round((lo + hi) / 2), endMs);
    if (was) {
      if (from !== null) low.push([from, t]);
      from = null;
    } else from = t;
  }
  if (from !== null) low.push([from, endMs]);

  const transitMs = startMs + transit * curve.stepMs;
  const spans = intersect(lit, low);
  const window = (kind: GlowKind, s: Span | undefined): GlowWindow | null => {
    if (!s) return null;
    const midMs = Math.round((s[0] + s[1]) / 2);
    const p = position(SkyBody.Sun, new Date(midMs), obs);
    return { kind, startMs: s[0], endMs: s[1], midMs, azimuthDeg: p.azimuth, altitudeDeg: p.altitude };
  };
  return {
    startMs,
    endMs,
    sunrise: window(GlowKind.Sunrise, spans.find((s) => s[1] <= transitMs)),
    sunset: window(GlowKind.Sunset, spans.findLast((s) => s[0] >= transitMs))
  };
}
