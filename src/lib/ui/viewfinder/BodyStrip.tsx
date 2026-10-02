import { makeObserver, SkyBody } from '@core/astro/bodies';
import { moonInfo, position } from '@core/astro/positions';
import { azimuth, degrees, moonPhase } from '@core/format';
import { useSettings } from '@state/settings';
import { usePinSiteHeightM } from '@state/terrain';
import { useWorld } from '@state/world';

const altAz = (p: { altitude: number; azimuth: number }) => `${p.altitude >= 0 ? '+' : ''}${degrees(p.altitude, 1)} · ${azimuth(p.azimuth)}`;

/** Sun, moon and Galactic Centre readout for the composed moment, PlanIt's viewfinder header. */
export function BodyStrip() {
  const siteM = usePinSiteHeightM();
  const showGc = useSettings((s) => s.showGc);
  // String selectors, so a clock tick re-renders the strip only when a shown digit changes.
  const sun = useWorld((s) => altAz(position(SkyBody.Sun, new Date(s.time), makeObserver(s.pin, siteM))));
  const moon = useWorld((s) => {
    const m = moonInfo(new Date(s.time));
    return `${altAz(position(SkyBody.Moon, new Date(s.time), makeObserver(s.pin, siteM)))} · ${moonPhase(m.name, m.illumination)}`;
  });
  const gc = useWorld((s) => (showGc ? altAz(position(SkyBody.Gc, new Date(s.time), makeObserver(s.pin, siteM))) : ''));
  return (
    <div className="vf-bodies" aria-label="Sun and moon position">
      <span>
        <b>Sun</b> {sun}
      </span>
      <span>
        <b>Moon</b> {moon}
      </span>
      {showGc && (
        <span>
          <b>Galactic Centre</b> {gc}
        </span>
      )}
    </div>
  );
}
