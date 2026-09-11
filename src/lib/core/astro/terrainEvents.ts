import type { Observer } from 'astronomy-engine';
import { horizonAngleAt, type HorizonProfile } from '@core/terrain/horizon';
import { BODIES, type SkyBody } from './bodies';
import type { DayCurve } from './dayCurve';
import type { DayEvent } from './dayEvents';
import { moonInfo, position } from './positions';

/** Mean apparent angular radius, degrees; the upper limb decides visibility as in standard rise/set. */
export const SEMIDIAMETER_DEG: Record<SkyBody, number> = { sun: 0.2667, moon: 0.259, gc: 0 };

/**
 * Moments when each body's upper limb crosses the terrain horizon at its azimuth.
 * Brackets on the day curve, then bisects with exact positions to sub-second precision.
 */
export function terrainRiseSet(obs: Observer, curve: DayCurve, horizon: HorizonProfile, endMs: number): DayEvent[] {
  const out: DayEvent[] = [];
  for (const body of BODIES) {
    const alt = curve.altitude[body];
    const az = curve.azimuth[body];
    const r = SEMIDIAMETER_DEG[body];
    const above = (ms: number) => {
      const p = position(body, new Date(ms), obs);
      return p.altitude + r - horizonAngleAt(horizon, p.azimuth) >= 0;
    };
    let prev = alt[0] + r - horizonAngleAt(horizon, az[0]) >= 0;
    for (let i = 1; i < curve.n; i++) {
      const cur = alt[i] + r - horizonAngleAt(horizon, az[i]) >= 0;
      if (cur !== prev) {
        let lo = curve.startMs + (i - 1) * curve.stepMs;
        let hi = lo + curve.stepMs;
        for (let k = 0; k < 22; k++) {
          const mid = (lo + hi) / 2;
          if (above(mid) === prev) lo = mid;
          else hi = mid;
        }
        const time = Math.round((lo + hi) / 2);
        if (time < endMs) {
          const p = position(body, new Date(time), obs);
          const ev: DayEvent = { body, kind: cur ? 'terrainRise' : 'terrainSet', time, azimuth: p.azimuth, altitude: p.altitude };
          if (body === 'moon') ev.moon = moonInfo(new Date(time));
          out.push(ev);
        }
      }
      prev = cur;
    }
  }
  return out.toSorted((a, b) => a.time - b.time);
}

/** Drops terrain events that coincide with the geometric rise/set (flat horizon), to keep the timeline clean. */
export function distinctTerrainEvents(terrain: DayEvent[], geometric: DayEvent[], toleranceMs = 60_000): DayEvent[] {
  return terrain.filter((t) => {
    const kind = t.kind === 'terrainRise' ? 'rise' : 'set';
    return !geometric.some((g) => g.body === t.body && g.kind === kind && Math.abs(g.time - t.time) <= toleranceMs);
  });
}
