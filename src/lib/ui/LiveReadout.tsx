import { makeObserver } from '@core/astro/bodies';
import { moonInfo, position, type HorizontalPos } from '@core/astro/positions';
import { compass, degrees, percent } from '@core/format';
import { useSettings } from '@state/settings';
import { useWorld } from '@state/world';

/** Live azimuth/altitude of the bodies at the simulated time. Re-renders per tick; cheap by design. */
export function LiveReadout() {
  const time = useWorld((s) => s.time);
  const pin = useWorld((s) => s.pin);
  const agl = useWorld((s) => s.pinHeightM);
  const showGc = useSettings((s) => s.showGc);
  const obs = makeObserver(pin, agl);
  const date = new Date(time);
  const moon = moonInfo(date);
  return (
    <div className="readout">
      <Row cls="sun" label="Sun" pos={position('sun', date, obs)} />
      <Row cls="moon" label="Moon" pos={position('moon', date, obs)} extra={`${moon.name} · ${percent(moon.illumination, moon.illumination < 0.1 ? 2 : 1)}`} />
      {showGc && <Row cls="gc" label="Galactic Centre" pos={position('gc', date, obs)} />}
    </div>
  );
}

function Row({ cls, label, pos, extra }: { cls: string; label: string; pos: HorizontalPos; extra?: string }) {
  const up = pos.altitude > 0;
  return (
    <div className={`readout-row${up ? '' : ' below'}`}>
      <span className={`dot ${cls} mid`} aria-hidden="true" />
      <span className="label">{label}</span>
      <span className="val" title="Azimuth">
        {degrees(pos.azimuth)} {compass(pos.azimuth)}
      </span>
      <span className="val" title="Altitude">
        {pos.altitude >= 0 ? '+' : ''}
        {degrees(pos.altitude)}
      </span>
      {extra && <span className="extra">{extra}</span>}
    </div>
  );
}
