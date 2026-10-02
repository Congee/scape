import { Fragment } from 'react';
import { SkyBody } from '@core/astro/bodies';
import { EventKind, type DayEvent } from '@core/astro/dayEvents';
import { azimuth, distance, moonPhase } from '@core/format';
import { formatTime } from '@core/time/format';
import type { SightVerdict } from '@core/weather/sightline';
import { tideDay, TideKind } from '@data/tides';
import { useDayData } from '@state/dayData';
import { settingsStore, useSettings } from '@state/settings';
import { usePlanTime, useWorld, worldStore } from '@state/world';
import { Dial } from './Dial';
import { CloudRow } from './CloudChart';
import { sightKey, useSightlines, VERDICT_TEXT } from './Sightlines';
import { anyUnknown, rowVerdict } from './summaries';
import { TideChart, tideKindText, tideText, useNearestTide } from './TideChart';

const LABELS: Record<SkyBody, Partial<Record<EventKind, string>>> = {
  Sun: {
    AstroDawn: 'Astronomical dawn',
    NauticalDawn: 'Nautical dawn',
    CivilDawn: 'Civil dawn',
    BlueEnd: 'Blue hour ends',
    Rise: 'Sunrise',
    GoldenEnd: 'Golden hour ends',
    Transit: 'Sun transit',
    GoldenStart: 'Golden hour begins',
    Set: 'Sunset',
    BlueStart: 'Blue hour begins',
    CivilDusk: 'Civil dusk',
    NauticalDusk: 'Nautical dusk',
    AstroDusk: 'Astronomical dusk',
    TerrainRise: 'Sun clears the terrain',
    TerrainSet: 'Sun behind the terrain'
  },
  Moon: { Rise: 'Moonrise', Transit: 'Moon transit', Set: 'Moonset', TerrainRise: 'Moon clears the terrain', TerrainSet: 'Moon behind the terrain' },
  Gc: {
    Rise: 'Galactic Centre rises',
    Transit: 'Galactic Centre transit',
    Set: 'Galactic Centre sets',
    TerrainRise: 'Galactic Centre clears the terrain',
    TerrainSet: 'Galactic Centre behind the terrain'
  }
};

const RISING = new Set<EventKind>([EventKind.AstroDawn, EventKind.NauticalDawn, EventKind.CivilDawn, EventKind.BlueEnd, EventKind.Rise, EventKind.GoldenEnd, EventKind.TerrainRise]);
const TERRAIN = new Set<EventKind>([EventKind.TerrainRise, EventKind.TerrainSet]);

/** Rows the default, TPE-like list keeps; everything else waits behind Details. */
const ESSENTIAL: Partial<Record<SkyBody, Set<EventKind>>> = {
  Sun: new Set<EventKind>([EventKind.CivilDawn, EventKind.BlueEnd, EventKind.Rise, EventKind.GoldenEnd, EventKind.GoldenStart, EventKind.Set, EventKind.BlueStart, EventKind.CivilDusk]),
  Moon: new Set<EventKind>([EventKind.Rise, EventKind.Set])
};

const isDetail = (ev: DayEvent) => !ESSENTIAL[ev.body]?.has(ev.kind);

function shade(kind: EventKind): string {
  if (kind === EventKind.Transit) return 'mid';
  return RISING.has(kind) ? 'rise' : 'set';
}

export function Timeline() {
  const events = useDayData((s) => s.events);
  const loading = useDayData((s) => s.loading);
  const tz = useWorld((s) => s.tz);
  const hour12 = useSettings((s) => s.hour12);
  const showGc = useSettings((s) => s.showGc);
  const detail = useSettings((s) => s.timelineDetail);

  const sight = useSightlines().lines;
  const list = events.filter((e) => (detail ? showGc || e.body !== SkyBody.Gc : !isDetail(e)));
  const verdicts = list.map((e) => sight.get(sightKey(e))?.verdict);
  // An index selector, so a clock tick re-renders only when the active event changes.
  const activeIdx = useWorld((s) => {
    let idx = -1;
    for (let i = 0; i < list.length; i++) if (list[i].time <= s.time) idx = i;
    return idx;
  });

  return (
    <div className={`timeline${loading ? ' loading' : ''}`}>
      {list.length === 0 && !loading && <p className="muted">No events on this day.</p>}
      <ul>
        {activeIdx === -1 && list.length > 0 && <NowLine />}
        {list.map((ev, i) => (
          <Fragment key={`${ev.body}-${ev.kind}-${ev.time}`}>
            <Row ev={ev} active={i === activeIdx} tz={tz} hour12={hour12} sight={rowVerdict(verdicts[i])} />
            {i === activeIdx && <NowLine />}
          </Fragment>
        ))}
      </ul>
      {anyUnknown(verdicts) && <p className="muted sight-unknown">{VERDICT_TEXT.Unknown}</p>}
    </div>
  );
}

/** The plan's clock between the events either side of it. */
function NowLine() {
  const hour12 = useSettings((s) => s.hour12);
  const label = useWorld((s) => formatTime(s.time, s.tz, hour12));
  return (
    <li className="now-line" aria-hidden="true">
      <span>{label}</span>
    </li>
  );
}

/** The Today section's header switch for the full event list. */
export function DetailsToggle() {
  const detail = useSettings((s) => s.timelineDetail);
  return (
    <label className="toggle">
      <input type="checkbox" checked={detail} onChange={(e) => settingsStore.getState().update({ timelineDetail: e.target.checked })} />
      <span>Details</span>
    </label>
  );
}

/** The pin's tide and cloud rows, styled as timeline rows. */
export function TideCloud() {
  return (
    <div className="timeline">
      <TideRow />
      <CloudRow />
    </div>
  );
}

function Row({ ev, active, tz, hour12, sight }: { ev: DayEvent; active: boolean; tz: string; hour12: boolean; sight?: SightVerdict }) {
  return (
    <li className={[isDetail(ev) ? 'detail' : '', active ? 'active' : ''].filter(Boolean).join(' ')} data-time={ev.time}>
      <button onClick={() => worldStore.getState().setTime(ev.time)} title="Set the clock to this event">
        <Dial az={ev.azimuth} ink={`${ev.body.toLowerCase()} ${shade(ev.kind)}${TERRAIN.has(ev.kind) ? ' terrain' : ''}`} />
        <span className="label">{LABELS[ev.body][ev.kind] ?? ev.kind}</span>
        <span className="time">{formatTime(ev.time, tz, hour12)}</span>
        <span className="az">{azimuth(ev.azimuth)}</span>
        {(ev.moon || sight) && (
          <span className="extra">
            {ev.moon && moonPhase(ev.moon.name, ev.moon.illumination)}
            {ev.moon && sight && ' · '}
            {sight && (
              <span className={`sight ${sight.toLowerCase()}`} data-sight={sight}>
                {VERDICT_TEXT[sight]}
              </span>
            )}
          </span>
        )}
      </button>
    </li>
  );
}

/** The day's tide at the pin's nearest station; absent when none is in range. */
function TideRow() {
  const { site, distM } = useNearestTide();
  const time = usePlanTime();
  const tz = useWorld((s) => s.tz);
  const dayStart = useDayData((s) => s.dayStart);
  const dayEnd = useDayData((s) => s.dayEnd);
  const hour12 = useSettings((s) => s.hour12);
  const units = useSettings((s) => s.units);
  if (!site || dayEnd <= dayStart) return null;
  const day = tideDay(site, dayStart, dayEnd);
  const next = day.extremes.find((e) => e.timeMs > time);
  return (
    <div className="tide-row">
      <button onClick={() => next && worldStore.getState().setTime(next.timeMs)} title="Set the clock to the next high or low" disabled={!next}>
        <span className="dot tide" aria-hidden="true" />
        <span className="label">{next ? `Next ${next.high ? 'high' : 'low'} tide` : 'Tide'}</span>
        {next && <span className="time">{formatTime(next.timeMs, tz, hour12)}</span>}
        {next && <span className="az">{tideText(next.heightM, units)}</span>}
        <span className="extra">
          {site.station.name} · {tideKindText(site)} · {distance(distM, units)} away
        </span>
      </button>
      <TideChart day={day} startMs={dayStart} endMs={dayEnd} time={time} h={40} interpolated={site.kind === TideKind.Subordinate} />
    </div>
  );
}
