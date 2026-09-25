import { useState } from 'react';
import { formatTime } from '@core/time/format';
import { isoDate, localParts, offsetLabel, withLocalTime } from '@core/time/localDay';
import { useClock, useSecondsTick } from '@state/clock';
import { useSettings } from '@state/settings';
import { useWorld, worldStore } from '@state/world';
import { Calendar } from './Calendar';

const pad2 = (n: number) => String(n).padStart(2, '0');
const ZONES: string[] = Intl.supportedValuesOf('timeZone');

/** The only part of the bar that can change every second; live, it shows seconds only while hovered, focused or asked for elsewhere. */
function Clock() {
  const [hot, setHot] = useState(false);
  useSecondsTick(hot);
  const time = useWorld((s) => s.time);
  const tz = useWorld((s) => s.tz);
  const live = useWorld((s) => s.live);
  const seconds = useClock((s) => s.secondsWanted > 0);
  const hour12 = useSettings((s) => s.hour12);
  return (
    <span
      className={`clock${live ? ' live' : ''}`}
      title={live ? 'Following real time' : 'Simulated time'}
      tabIndex={0}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      onFocus={() => setHot(true)}
      onBlur={() => setHot(false)}
    >
      {formatTime(time, tz, hour12, !live || seconds)}
    </span>
  );
}

export function DateBar() {
  const tz = useWorld((s) => s.tz);
  const tzAuto = useWorld((s) => s.tzAuto);
  const live = useWorld((s) => s.live);
  // String selectors, so a clock tick re-renders the bar only when the minute turns.
  const iso = useWorld((s) => isoDate(localParts(new Date(s.time), s.tz)));
  const hm = useWorld((s) => {
    const p = localParts(new Date(s.time), s.tz);
    return `${pad2(p.hour)}:${pad2(p.minute)}`;
  });
  const offset = useWorld((s) => offsetLabel(new Date(s.time), s.tz));
  const { addDays, setDate, setNow, setTime, setTz } = worldStore.getState();

  return (
    <div className="datebar">
      <button onClick={() => addDays(-7)} title="Back one week">
        «
      </button>
      <button onClick={() => addDays(-1)} title="Previous day">
        ‹
      </button>
      <input type="date" value={iso} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date" />
      <Calendar />
      <button onClick={() => addDays(1)} title="Next day">
        ›
      </button>
      <button onClick={() => addDays(7)} title="Forward one week">
        »
      </button>
      <input
        type="time"
        value={hm}
        onChange={(e) => {
          const [h, m] = e.target.value.split(':').map(Number);
          if (Number.isFinite(h) && Number.isFinite(m)) setTime(withLocalTime(new Date(worldStore.getState().time), h * 3600 + m * 60, tz).getTime());
        }}
        aria-label="Time"
      />
      <Clock />
      <button className={live ? 'on' : ''} onClick={setNow} title="Jump to the current time">
        Now
      </button>
      <select
        className="tz"
        value={tzAuto ? '' : tz}
        onChange={(e) => setTz(e.target.value || null)}
        title="Time zone (auto from the camera location, or override)"
        aria-label="Time zone"
      >
        <option value="">{`Auto · ${tz} (${offset})`}</option>
        {ZONES.map((z) => (
          <option key={z} value={z}>
            {z}
          </option>
        ))}
      </select>
    </div>
  );
}
