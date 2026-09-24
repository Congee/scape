import {
  EclipseKind,
  NextLocalSolarEclipse,
  NextLunarEclipse,
  NextMoonQuarter,
  SearchLocalSolarEclipse,
  SearchLunarEclipse,
  SearchMoonQuarter,
  type LocalSolarEclipseInfo,
  type LunarEclipseInfo,
  type Observer
} from 'astronomy-engine';
import { formatTime } from '@core/time/format';
import { isoDate, localParts } from '@core/time/localDay';
import { SkyBody } from './bodies';
import { position } from './positions';

/** The few moon and eclipse events worth a glyph in a month grid; ordinary phases are left out. */
export const CalendarMarkKind = {
  NewMoon: 'NewMoon',
  FirstQuarter: 'FirstQuarter',
  FullMoon: 'FullMoon',
  LastQuarter: 'LastQuarter',
  SolarEclipse: 'SolarEclipse',
  LunarEclipse: 'LunarEclipse'
} as const;
export type CalendarMarkKind = (typeof CalendarMarkKind)[keyof typeof CalendarMarkKind];

export interface CalendarMark {
  /** Local calendar date in `tz`, "YYYY-MM-DD". */
  day: string;
  kind: CalendarMarkKind;
  /** Epoch milliseconds of the phase or eclipse peak. */
  timeMs: number;
  detail?: string;
}

export interface CalendarOptions {
  hour12?: boolean;
}

const QUARTER_KIND: CalendarMarkKind[] = [
  CalendarMarkKind.NewMoon,
  CalendarMarkKind.FirstQuarter,
  CalendarMarkKind.FullMoon,
  CalendarMarkKind.LastQuarter
];

const QUARTER_NAME = ['New moon', 'First quarter', 'Full moon', 'Last quarter'];

const MINUTE_MS = 60_000;

export const ECLIPSE_LABEL: Record<EclipseKind, string> = {
  [EclipseKind.Penumbral]: 'Penumbral',
  [EclipseKind.Partial]: 'Partial',
  [EclipseKind.Annular]: 'Annular',
  [EclipseKind.Total]: 'Total'
};

/** The sun is up at the peak or at either edge of the partial phase. */
function solarVisible(e: LocalSolarEclipseInfo): boolean {
  return e.peak.altitude > 0 || e.partial_begin.altitude > 0 || e.partial_end.altitude > 0;
}

/** The moon is up somewhere in the partial phase, or in the penumbral phase when that is all there is. */
function lunarVisible(e: LunarEclipseInfo, obs: Observer): boolean {
  const peak = e.peak.date.getTime();
  const span = (e.sd_partial || e.sd_penum) * MINUTE_MS;
  return [peak - span, peak, peak + span].some((t) => position(SkyBody.Moon, new Date(t), obs).altitude > 0);
}

/**
 * Moon quarters and locally visible eclipses with `fromMs <= time <= toMs`, sorted by time.
 * Eclipse visibility is judged at the camera location; lunar eclipses ignore the terrain horizon.
 */
export function calendarMarks(obs: Observer, fromMs: number, toMs: number, tz: string, opts: CalendarOptions = {}): CalendarMark[] {
  const hour12 = opts.hour12 ?? false;
  const at = (ms: number) => formatTime(ms, tz, hour12);
  const out: CalendarMark[] = [];
  const push = (timeMs: number, kind: CalendarMarkKind, detail?: string) => {
    if (timeMs < fromMs || timeMs > toMs) return;
    out.push({ day: isoDate(localParts(new Date(timeMs), tz)), kind, timeMs, detail });
  };

  for (let mq = SearchMoonQuarter(new Date(fromMs)); mq.time.date.getTime() <= toMs; mq = NextMoonQuarter(mq)) {
    const ms = mq.time.date.getTime();
    push(ms, QUARTER_KIND[mq.quarter], `${QUARTER_NAME[mq.quarter]} · ${at(ms)}`);
  }

  for (let se = SearchLocalSolarEclipse(new Date(fromMs), obs); se.peak.time.date.getTime() <= toMs; se = NextLocalSolarEclipse(se.peak.time, obs)) {
    if (!solarVisible(se)) continue;
    const ms = se.peak.time.date.getTime();
    const pct = Number.isFinite(se.obscuration) ? `max ${Math.floor(se.obscuration * 100)} % obscured at ${at(ms)}` : `max ${at(ms)}`;
    push(ms, CalendarMarkKind.SolarEclipse, `${ECLIPSE_LABEL[se.kind]} solar eclipse · ${pct}`);
  }

  for (let le = SearchLunarEclipse(new Date(fromMs)); le.peak.date.getTime() <= toMs; le = NextLunarEclipse(le.peak)) {
    if (!lunarVisible(le, obs)) continue;
    const ms = le.peak.date.getTime();
    push(ms, CalendarMarkKind.LunarEclipse, `${ECLIPSE_LABEL[le.kind]} lunar eclipse · max ${at(ms)}`);
  }

  return out.toSorted((a, b) => a.timeMs - b.timeMs);
}
