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

/** Longest stretch of `night` with the moon below the horizon, or null when there is none. */
export function moonFreeWindow(night: NightWindow, moonEvents: DayEvent[], moonUpAtStart: boolean): TimeWindow | null {
  if (night.endMs <= night.startMs) return null;
  const crossings = moonEvents
    .filter((e) => e.body === SkyBody.Moon && MOON_CROSSINGS.has(e.kind) && e.time > night.startMs && e.time < night.endMs)
    .toSorted((a, b) => a.time - b.time);

  let best: TimeWindow | null = null;
  const consider = (startMs: number, endMs: number) => {
    if (endMs > startMs && (!best || endMs - startMs > best.endMs - best.startMs)) best = { startMs, endMs };
  };

  let up = moonUpAtStart;
  let from = night.startMs;
  for (const e of crossings) {
    const rising = e.kind === EventKind.Rise;
    if (rising === up) continue; // crossing that does not change the state; ignore
    if (!up) consider(from, e.time);
    up = rising;
    from = e.time;
  }
  if (!up) consider(from, night.endMs);
  return best;
}

/** First moonrise or moonset after `nowMs`. */
export function nextMoonEvent(events: DayEvent[], nowMs: number): DayEvent | null {
  return events.find((e) => e.body === SkyBody.Moon && MOON_CROSSINGS.has(e.kind) && e.time > nowMs) ?? null;
}
