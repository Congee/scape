import { makeObserver, SkyBody } from '@core/astro/bodies';
import { moonInfo, position, type HorizontalPos } from '@core/astro/positions';
import { shadowLengthM } from '@core/astro/shadow';
import { compass, degrees, distance, percent, Units } from '@core/format';
import { useSettings } from '@state/settings';
import { usePinSiteHeightM } from '@state/terrain';
import { useWorld } from '@state/world';

/** Live azimuth/altitude of the bodies at the simulated time. Re-renders per tick; cheap by design. */
export function LiveReadout() {
  const time = useWorld((s) => s.time);
  const pin = useWorld((s) => s.pin);
  const siteM = usePinSiteHeightM();
  const showGc = useSettings((s) => s.showGc);
  const units = useSettings((s) => s.units);
  const shadowHeight = useSettings((s) => s.shadowObjectHeightM);
  const obs = makeObserver(pin, siteM);
  const date = new Date(time);
  const moon = moonInfo(date);
  const sun = position(SkyBody.Sun, date, obs);
  const shadow = shadowLengthM(shadowHeight, sun.altitude);
  // The object height is set in metres, so metric echoes it rather than rounding it to whole metres.
  const heightText = units === Units.Imperial ? distance(shadowHeight, units) : `${shadowHeight} m`;
  return (
    <div className="readout">
      <Row cls="sun" label="Sun" pos={sun} extra={shadow == null ? undefined : `shadow ×${(shadow / shadowHeight).toFixed(1)} · ${heightText} → ${distance(shadow, units)}`} />
      <Row cls="moon" label="Moon" pos={position(SkyBody.Moon, date, obs)} extra={`${moon.name} · ${percent(moon.illumination, moon.illumination < 0.1 ? 2 : 1)}`} />
      {showGc && <Row cls="gc" label="Galactic Centre" pos={position(SkyBody.Gc, date, obs)} />}
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
