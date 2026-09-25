import { SkyBody } from './bodies';
import { noonToNoon } from '@core/time/localDay';
import { EventKind, type DayEvent } from './dayEvents';

export const NightKind = {
  Astronomical: 'Astronomical',
  Nautical: 'Nautical',
  /** The sun never sinks far enough for a night. */
  None: 'None',
  /** The sun never climbs out of astronomical night. */
  AllDark: 'AllDark'
} as const;
export type NightKind = (typeof NightKind)[keyof typeof NightKind];

export interface NightWindow {
  /** Epoch milliseconds; 0 for `None` and `AllDark`, which have no boundaries. */
  startMs: number;
  endMs: number;
  kind: NightKind;
}

export interface TimeWindow {
  startMs: number;
  endMs: number;
}

const MOON_CROSSINGS = new Set<EventKind>([EventKind.Rise, EventKind.Set]);

function sunEvents(events: DayEvent[], kind: EventKind): DayEvent[] {
  return events.filter((e) => e.body === SkyBody.Sun && e.kind === kind);
}

/** The dusk→dawn pair still running at or after `nowMs`, else the last complete one. */
function duskToDawn(events: DayEvent[], nowMs: number, dusk: EventKind, dawn: EventKind): TimeWindow | null {
  const dawns = sunEvents(events, dawn);
  let last: TimeWindow | null = null;
  for (const d of sunEvents(events, dusk)) {
    const a = dawns.find((x) => x.time > d.time);
    if (!a) continue;
    last = { startMs: d.time, endMs: a.time };
    if (a.time >= nowMs) return last;
  }
  return last;
}

/**
 * The coming night inside `events` (a local noon → noon window), preferring
 * astronomical darkness and falling back to nautical.
 */
export function nightWindow(events: DayEvent[], nowMs: number): NightWindow {
  const astro = duskToDawn(events, nowMs, EventKind.AstroDusk, EventKind.AstroDawn);
  if (astro) return { ...astro, kind: NightKind.Astronomical };
  const nautical = duskToDawn(events, nowMs, EventKind.NauticalDusk, EventKind.NauticalDawn);
  if (nautical) return { ...nautical, kind: NightKind.Nautical };
  // No twilight crossings: the sun's highest point says which side of darkness the day sits on.
  const transit = events.find((e) => e.body === SkyBody.Sun && e.kind === EventKind.Transit);
  return { startMs: 0, endMs: 0, kind: transit && transit.altitude < -18 ? NightKind.AllDark : NightKind.None };
}

export interface PanelNight extends TimeWindow {
  events: DayEvent[];
}

/** The noon-to-noon night the panel shows at `instant`: the one containing it, or the next once its sunrise (else its dawn) has passed. */
export function panelNight(instant: Date, tz: string, eventsFor: (startMs: number, endMs: number) => DayEvent[]): PanelNight {
  const w = noonToNoon(instant, tz);
  const events = eventsFor(w.startMs, w.endMs);
  const endMs = sunEvents(events, EventKind.Rise)[0]?.time ?? nightWindow(events, instant.getTime()).endMs;
  if (!endMs || instant.getTime() < endMs) return { ...w, events };
  const next = noonToNoon(new Date(w.endMs), tz);
  return { ...next, events: eventsFor(next.startMs, next.endMs) };
}

export interface MoonFreeWindow extends TimeWindow {
  /** Part of it has the moon up but totally eclipsed. */
  eclipsed: boolean;
}

/** Longest stretch of `night` with the moon below the horizon or inside `totality`, or null when there is none. */
export function moonFreeWindow(night: NightWindow, moonEvents: DayEvent[], moonUpAtStart: boolean, totality: TimeWindow | null = null): MoonFreeWindow | null {
  if (night.endMs <= night.startMs) return null;
  const inside = (t: number) => t > night.startMs && t < night.endMs;
  const crossings = moonEvents.filter((e) => e.body === SkyBody.Moon && MOON_CROSSINGS.has(e.kind) && inside(e.time)).toSorted((a, b) => a.time - b.time);
  const cuts = [...new Set([night.startMs, ...crossings.map((e) => e.time), ...(totality ? [totality.startMs, totality.endMs].filter(inside) : []), night.endMs])].toSorted((a, b) => a - b);

  let best: MoonFreeWindow | null = null;
  const consider = (w: MoonFreeWindow) => {
    if (w.endMs > w.startMs && (!best || w.endMs - w.startMs > best.endMs - best.startMs)) best = w;
  };

  let up = moonUpAtStart;
  let next = 0;
  let run: MoonFreeWindow = { startMs: night.startMs, endMs: night.startMs, eclipsed: false };
  for (let k = 0; k + 1 < cuts.length; k++) {
    const [a, b] = [cuts[k], cuts[k + 1]];
    while (next < crossings.length && crossings[next].time <= a) up = crossings[next++].kind === EventKind.Rise;
    const eclipsed = up && totality !== null && a >= totality.startMs && b <= totality.endMs;
    if (up && !eclipsed) {
      consider(run);
      run = { startMs: b, endMs: b, eclipsed: false };
    } else run = { ...run, endMs: b, eclipsed: run.eclipsed || eclipsed };
  }
  consider(run);
  return best;
}

/** First moonrise or moonset after `nowMs`. */
export function nextMoonEvent(events: DayEvent[], nowMs: number): DayEvent | null {
  return events.find((e) => e.body === SkyBody.Moon && MOON_CROSSINGS.has(e.kind) && e.time > nowMs) ?? null;
}
