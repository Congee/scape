import {
  Body,
  SearchAltitude,
  SearchHourAngle,
  SearchRiseSet,
  type AstroTime,
  type Observer
} from 'astronomy-engine';
import { BODY, riseSetObserver, SkyBody } from './bodies';
import { moonInfo, position, type MoonInfo } from './positions';

export const EventKind = {
  AstroDawn: 'AstroDawn',
  NauticalDawn: 'NauticalDawn',
  CivilDawn: 'CivilDawn',
  BlueEnd: 'BlueEnd',
  Rise: 'Rise',
  GoldenEnd: 'GoldenEnd',
  Transit: 'Transit',
  GoldenStart: 'GoldenStart',
  Set: 'Set',
  BlueStart: 'BlueStart',
  CivilDusk: 'CivilDusk',
  NauticalDusk: 'NauticalDusk',
  AstroDusk: 'AstroDusk',
  /** Upper limb clearing / dropping behind the terrain horizon. */
  TerrainRise: 'TerrainRise',
  TerrainSet: 'TerrainSet'
} as const;
export type EventKind = (typeof EventKind)[keyof typeof EventKind];

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
  /** Sun altitude that bounds the blue hour on the daylight side, degrees; civil dawn/dusk bounds the other. */
  blueAltitude?: number;
  /** Eye height above local ground, metres; dips the horizon as over a flat plateau, refraction scaled to the eye's air density. */
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
  const blue = opts.blueAltitude ?? -4;
  const agl = opts.heightAboveGroundM ?? 0;
  const riseObs = riseSetObserver(obs, agl);
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
        if (body === SkyBody.Moon) ev.moon = moonInfo(t.date);
        out.push(ev);
      }
      from = new Date(ms + 60_000);
    }
  };

  const altitudeSearch = (body: Body, dir: 1 | -1, alt: number) => (from: Date) =>
    SearchAltitude(body, obs, dir, from, remaining(from), alt);
  const riseSet = (body: Body, dir: 1 | -1) => (from: Date) =>
    SearchRiseSet(body, riseObs, dir, from, remaining(from), agl);
  const transit = (body: Body) => (from: Date) => {
    const ev = SearchHourAngle(body, obs, 0, from, 1);
    return ev.time.date.getTime() < endMs ? ev.time : null;
  };

  collect(SkyBody.Sun, EventKind.AstroDawn, altitudeSearch(Body.Sun, 1, -18));
  collect(SkyBody.Sun, EventKind.NauticalDawn, altitudeSearch(Body.Sun, 1, -12));
  collect(SkyBody.Sun, EventKind.CivilDawn, altitudeSearch(Body.Sun, 1, -6));
  collect(SkyBody.Sun, EventKind.BlueEnd, altitudeSearch(Body.Sun, 1, blue));
  collect(SkyBody.Sun, EventKind.Rise, riseSet(Body.Sun, 1));
  collect(SkyBody.Sun, EventKind.GoldenEnd, altitudeSearch(Body.Sun, 1, golden));
  collect(SkyBody.Sun, EventKind.Transit, transit(Body.Sun));
  collect(SkyBody.Sun, EventKind.GoldenStart, altitudeSearch(Body.Sun, -1, golden));
  collect(SkyBody.Sun, EventKind.Set, riseSet(Body.Sun, -1));
  collect(SkyBody.Sun, EventKind.BlueStart, altitudeSearch(Body.Sun, -1, blue));
  collect(SkyBody.Sun, EventKind.CivilDusk, altitudeSearch(Body.Sun, -1, -6));
  collect(SkyBody.Sun, EventKind.NauticalDusk, altitudeSearch(Body.Sun, -1, -12));
  collect(SkyBody.Sun, EventKind.AstroDusk, altitudeSearch(Body.Sun, -1, -18));

  for (const body of [SkyBody.Moon, SkyBody.Gc]) {
    collect(body, EventKind.Rise, riseSet(BODY[body], 1));
    collect(body, EventKind.Transit, transit(BODY[body]));
    collect(body, EventKind.Set, riseSet(BODY[body], -1));
  }

  return out.toSorted((a, b) => a.time - b.time);
}
