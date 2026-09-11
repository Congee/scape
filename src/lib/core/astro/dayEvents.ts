import {
  Body,
  SearchAltitude,
  SearchHourAngle,
  SearchRiseSet,
  type AstroTime,
  type Observer
} from 'astronomy-engine';
import { BODY, type SkyBody } from './bodies';
import { moonInfo, position, type MoonInfo } from './positions';

export type EventKind =
  | 'astroDawn'
  | 'nauticalDawn'
  | 'civilDawn'
  | 'rise'
  | 'goldenEnd'
  | 'transit'
  | 'goldenStart'
  | 'set'
  | 'civilDusk'
  | 'nauticalDusk'
  | 'astroDusk'
  /** Upper limb clearing / dropping behind the terrain horizon. */
  | 'terrainRise'
  | 'terrainSet';

export interface DayEvent {
  body: SkyBody;
  kind: EventKind;
  /** Epoch milliseconds. */
  time: number;
  azimuth: number;
  altitude: number;
  moon?: MoonInfo;
}

export interface DayEventOptions {
  /** Sun altitude that bounds the golden hour, degrees. */
  goldenAltitude?: number;
  /** Observer height above local ground, metres; lowers the apparent horizon. */
  heightAboveGroundM?: number;
}

const DAY_MS = 86_400_000;

/**
 * Every rise/set/twilight/transit event for sun, moon and Galactic Centre with
 * `startMs <= time < endMs`, sorted by time.
 */
export function dayEvents(
  obs: Observer,
  startMs: number,
  endMs: number,
  opts: DayEventOptions = {}
): DayEvent[] {
  const golden = opts.goldenAltitude ?? 6;
  const agl = opts.heightAboveGroundM ?? 0;
  const out: DayEvent[] = [];

  const remaining = (from: Date) => (endMs - from.getTime()) / DAY_MS + 1 / 1440;

  // Searches restart just after each hit so bodies crossing twice in one local day are kept.
  const collect = (body: SkyBody, kind: EventKind, search: (from: Date) => AstroTime | null) => {
    let from = new Date(startMs);
    for (let i = 0; i < 3; i++) {
      const t = search(from);
      if (!t) break;
      const ms = t.date.getTime();
      if (ms >= endMs) break;
      if (ms >= startMs) {
        const pos = position(body, t.date, obs);
        const ev: DayEvent = { body, kind, time: ms, azimuth: pos.azimuth, altitude: pos.altitude };
        if (body === 'moon') ev.moon = moonInfo(t.date);
        out.push(ev);
      }
      from = new Date(ms + 60_000);
    }
  };

  const altitudeSearch = (body: Body, dir: 1 | -1, alt: number) => (from: Date) =>
    SearchAltitude(body, obs, dir, from, remaining(from), alt);
  const riseSet = (body: Body, dir: 1 | -1) => (from: Date) =>
    SearchRiseSet(body, obs, dir, from, remaining(from), agl);
  const transit = (body: Body) => (from: Date) => {
    const ev = SearchHourAngle(body, obs, 0, from, 1);
    return ev.time.date.getTime() < endMs ? ev.time : null;
  };

  collect('sun', 'astroDawn', altitudeSearch(Body.Sun, 1, -18));
  collect('sun', 'nauticalDawn', altitudeSearch(Body.Sun, 1, -12));
  collect('sun', 'civilDawn', altitudeSearch(Body.Sun, 1, -6));
  collect('sun', 'rise', riseSet(Body.Sun, 1));
  collect('sun', 'goldenEnd', altitudeSearch(Body.Sun, 1, golden));
  collect('sun', 'transit', transit(Body.Sun));
  collect('sun', 'goldenStart', altitudeSearch(Body.Sun, -1, golden));
  collect('sun', 'set', riseSet(Body.Sun, -1));
  collect('sun', 'civilDusk', altitudeSearch(Body.Sun, -1, -6));
  collect('sun', 'nauticalDusk', altitudeSearch(Body.Sun, -1, -12));
  collect('sun', 'astroDusk', altitudeSearch(Body.Sun, -1, -18));

  for (const body of ['moon', 'gc'] as const) {
    collect(body, 'rise', riseSet(BODY[body], 1));
    collect(body, 'transit', transit(BODY[body]));
    collect(body, 'set', riseSet(BODY[body], -1));
  }

  return out.toSorted((a, b) => a.time - b.time);
}
