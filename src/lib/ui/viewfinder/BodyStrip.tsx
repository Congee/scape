import { makeObserver, SkyBody } from '@core/astro/bodies';
import { moonInfo, position } from '@core/astro/positions';
import { compass, degrees, percent } from '@core/format';
import { useSettings } from '@state/settings';
import { usePinSiteHeightM } from '@state/terrain';
import { useWorld } from '@state/world';

const altAz = (p: { altitude: number; azimuth: number }) => `${p.altitude >= 0 ? '+' : ''}${degrees(p.altitude, 1)} · ${degrees(p.azimuth, 1)} ${compass(p.azimuth)}`;

/** Sun, moon and Galactic Centre readout for the composed moment, PlanIt's viewfinder header. */
export function BodyStrip() {
  const time = useWorld((s) => s.time);
  const pin = useWorld((s) => s.pin);
  const siteM = usePinSiteHeightM();
  const showGc = useSettings((s) => s.showGc);
  const date = new Date(time);
  const obs = makeObserver(pin, siteM);
  const moon = moonInfo(date);
  return (
    <div className="vf-bodies" aria-label="Sun and moon position">
      <span>
        <b>Sun</b> {altAz(position(SkyBody.Sun, date, obs))}
      </span>
      <span>
        <b>Moon</b> {altAz(position(SkyBody.Moon, date, obs))} · {percent(moon.illumination, 0)} {moon.name}
      </span>
      {showGc && (
        <span>
          <b>Galactic Centre</b> {altAz(position(SkyBody.Gc, date, obs))}
        </span>
      )}
    </div>
  );
}
