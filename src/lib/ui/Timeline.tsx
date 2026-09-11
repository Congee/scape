import type { SkyBody } from '@core/astro/bodies';
import type { DayEvent, EventKind } from '@core/astro/dayEvents';
import { degrees, percent } from '@core/format';
import { formatTime } from '@core/time/format';
import { useDayData } from '@state/dayData';
import { useSettings } from '@state/settings';
import { useWorld, worldStore } from '@state/world';

const LABELS: Record<SkyBody, Partial<Record<EventKind, string>>> = {
  sun: {
    astroDawn: 'Astronomical dawn',
    nauticalDawn: 'Nautical dawn',
    civilDawn: 'Civil dawn',
    rise: 'Sunrise',
    goldenEnd: 'Golden hour ends',
    transit: 'Sun transit',
    goldenStart: 'Golden hour begins',
    set: 'Sunset',
    civilDusk: 'Civil dusk',
    nauticalDusk: 'Nautical dusk',
    astroDusk: 'Astronomical dusk',
    terrainRise: 'Sun clears the terrain',
    terrainSet: 'Sun behind the terrain'
  },
  moon: { rise: 'Moonrise', transit: 'Moon transit', set: 'Moonset', terrainRise: 'Moon clears the terrain', terrainSet: 'Moon behind the terrain' },
  gc: {
    rise: 'Galactic Centre rises',
    transit: 'Galactic Centre transit',
    set: 'Galactic Centre sets',
    terrainRise: 'Galactic Centre clears the terrain',
    terrainSet: 'Galactic Centre behind the terrain'
  }
};

const RISING = new Set<EventKind>(['astroDawn', 'nauticalDawn', 'civilDawn', 'rise', 'goldenEnd', 'terrainRise']);
const TERRAIN = new Set<EventKind>(['terrainRise', 'terrainSet']);

function shade(kind: EventKind): string {
  if (kind === 'transit') return 'mid';
  return RISING.has(kind) ? 'rise' : 'set';
}

export function Timeline() {
  const events = useDayData((s) => s.events);
  const loading = useDayData((s) => s.loading);
  const time = useWorld((s) => s.time);
  const tz = useWorld((s) => s.tz);
  const hour12 = useSettings((s) => s.hour12);
  const showGc = useSettings((s) => s.showGc);

  const list = showGc ? events : events.filter((e) => e.body !== 'gc');
  let activeIdx = -1;
  for (let i = 0; i < list.length; i++) if (list[i].time <= time) activeIdx = i;

  return (
    <div className={`timeline${loading ? ' loading' : ''}`}>
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
    <li className={active ? 'active' : ''}>
      <button onClick={() => worldStore.getState().setTime(ev.time)} title="Set the clock to this event">
        <span className={`dot ${ev.body} ${shade(ev.kind)}${TERRAIN.has(ev.kind) ? ' terrain' : ''}`} aria-hidden="true" />
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
