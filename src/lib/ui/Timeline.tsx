import { SkyBody } from '@core/astro/bodies';
import { EventKind, type DayEvent } from '@core/astro/dayEvents';
import { degrees, distance, percent } from '@core/format';
import { formatTime } from '@core/time/format';
import { tideDay } from '@data/tides';
import { useDayData } from '@state/dayData';
import { settingsStore, useSettings } from '@state/settings';
import { useWorld, worldStore } from '@state/world';
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
  const time = useWorld((s) => s.time);
  const tz = useWorld((s) => s.tz);
  const hour12 = useSettings((s) => s.hour12);
  const showGc = useSettings((s) => s.showGc);
  const detail = useSettings((s) => s.timelineDetail);

  const list = events.filter((e) => (detail ? showGc || e.body !== SkyBody.Gc : !isDetail(e)));
  let activeIdx = -1;
  for (let i = 0; i < list.length; i++) if (list[i].time <= time) activeIdx = i;

  return (
    <div className={`timeline${loading ? ' loading' : ''}`}>
      <div className="head">
        <label className="toggle">
          <input type="checkbox" checked={detail} onChange={(e) => settingsStore.getState().update({ timelineDetail: e.target.checked })} />
          <span>Details</span>
        </label>
      </div>
      <TideRow />
      {list.length === 0 && !loading && <p className="muted">No events on this day.</p>}
      <ul>
        {list.map((ev, i) => (
          <Row key={`${ev.body}-${ev.kind}-${ev.time}`} ev={ev} active={i === activeIdx} tz={tz} hour12={hour12} />
        ))}
      </ul>
    </div>
  );
}

function Row({ ev, active, tz, hour12 }: { ev: DayEvent; active: boolean; tz: string; hour12: boolean }) {
  return (
    <li className={[isDetail(ev) ? 'detail' : '', active ? 'active' : ''].filter(Boolean).join(' ')}>
      <button onClick={() => worldStore.getState().setTime(ev.time)} title="Set the clock to this event">
        <span className={`dot ${ev.body.toLowerCase()} ${shade(ev.kind)}${TERRAIN.has(ev.kind) ? ' terrain' : ''}`} aria-hidden="true" />
        <span className="label">{LABELS[ev.body][ev.kind] ?? ev.kind}</span>
        <span className="time">{formatTime(ev.time, tz, hour12)}</span>
        <span className="az">{degrees(ev.azimuth)}</span>
        {ev.moon && (
          <span className="extra">
            {ev.moon.name} · {percent(ev.moon.illumination, ev.moon.illumination < 0.1 ? 2 : 1)}
          </span>
        )}
      </button>
    </li>
  );
}

/** The day's tide at the pin's nearest station; absent when none is in range. */
function TideRow() {
  const { site, distM } = useNearestTide();
  const time = useWorld((s) => s.time);
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
          {site.station.name} · {tideKindText(site.kind)} · {distance(distM, units)} away
        </span>
      </button>
      <TideChart day={day} startMs={dayStart} endMs={dayEnd} time={time} h={40} />
    </div>
  );
}
