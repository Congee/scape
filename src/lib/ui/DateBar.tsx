import { isoDate, localParts, offsetLabel, withLocalTime } from '@core/time/localDay';
import { useWorld, worldStore } from '@state/world';
import { Calendar } from './Calendar';
import { Icon } from './Icon';

const pad2 = (n: number) => String(n).padStart(2, '0');
const ZONES: string[] = Intl.supportedValuesOf('timeZone');

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
      <button className="btn-icon" onClick={() => addDays(-7)} title="Back one week" aria-label="Back one week">
        <Icon name="leftDouble" />
      </button>
      <button className="btn-icon" onClick={() => addDays(-1)} title="Back one day" aria-label="Back one day">
        <Icon name="left" />
      </button>
      <input type="date" value={iso} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date" />
      <Calendar />
      <button className="btn-icon" onClick={() => addDays(1)} title="Forward one day" aria-label="Forward one day">
        <Icon name="right" />
      </button>
      <button className="btn-icon" onClick={() => addDays(7)} title="Forward one week" aria-label="Forward one week">
        <Icon name="rightDouble" />
      </button>
      <input
        type="time"
        value={hm}
        onChange={(e) => {
          const [h, m] = e.target.value.split(':').map(Number);
          if (Number.isFinite(h) && Number.isFinite(m)) setTime(withLocalTime(new Date(worldStore.getState().time), h * 3600 + m * 60, tz).getTime());
        }}
        aria-label="Time"
        title={live ? 'Following real time' : 'Simulated time'}
      />
      <button
        className="tgl"
        aria-pressed={live}
        onClick={() => (live ? setTime(worldStore.getState().time) : setNow())}
        title={live ? 'Following real time; click to stop' : 'Jump to the current time and follow it'}
      >
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
