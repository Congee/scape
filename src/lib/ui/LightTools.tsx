import { makeObserver } from '@core/astro/bodies';
import { moonView, type MoonView } from '@core/astro/moonSim';
import { degrees, moonPhase } from '@core/format';
import { formatTime } from '@core/time/format';
import { useLightProbe } from '@state/lightProbe';
import { useSettings } from '@state/settings';
import { usePinSiteHeightM } from '@state/terrain';
import { usePlanTime, useWorld } from '@state/world';
import { useOnMap } from './panelPage';

const wrap360 = (d: number) => ((d % 360) + 360) % 360;
const signed = (deg: number) => `${deg >= 0 ? '+' : ''}${degrees(deg, 2)}`;
const hours = (ms: number) => `${Math.floor(ms / 3_600_000)} h ${Math.round((ms % 3_600_000) / 60_000)} min`;

function phaseName(v: MoonView): string {
  const f = v.illumination;
  if (f < 0.03) return 'New';
  if (f > 0.97) return 'Full';
  const kind = f < 0.45 ? 'crescent' : f > 0.55 ? 'gibbous' : 'quarter';
  if (kind === 'quarter') return v.waxing ? 'First quarter' : 'Last quarter';
  return `${v.waxing ? 'Waxing' : 'Waning'} ${kind}`;
}

function useMoon(): MoonView {
  const time = usePlanTime();
  const pin = useWorld((s) => s.pin);
  const siteM = usePinSiteHeightM();
  return moonView(new Date(time), makeObserver(pin, siteM));
}

export function MoonSummary() {
  const v = useMoon();
  return `Moon · ${moonPhase(phaseName(v), v.illumination)} · ${(v.semidiameterDeg * 120).toFixed(1)}′`;
}

export function MoonTools() {
  const v = useMoon();
  return (
    <>
      <div className="kv">
        <span className="k">Phase</span>
        <b className="v">
          {moonPhase(phaseName(v), v.illumination)}
        </b>
        <span className="k">Libration</span>
        <b className="v">
          {signed(v.librationLonDeg)} lon · {signed(v.librationLatDeg)} lat
        </b>
        <span className="k">Bright limb</span>
        <b className="v">
          {degrees(v.brightLimbPaDeg, 1)} PA · {degrees(wrap360(v.brightLimbPaDeg - v.parallacticDeg), 0)} from up
        </b>
        <span className="k">North pole</span>
        <b className="v">
          {degrees(v.axisPaDeg, 1)} PA · {degrees(wrap360(v.axisPaDeg - v.parallacticDeg), 0)} from up
        </b>
        <span className="k">Parallactic</span>
        <b className="v">{degrees(wrap360(v.parallacticDeg + 180) - 180, 1)}</b>
        <span className="k">Size</span>
        <b className="v">
          {(v.semidiameterDeg * 120).toFixed(2)}′ across · {Math.round(v.distanceKm).toLocaleString()} km
        </b>
        <span className="k">Earthshine</span>
        <b className="v">{v.earthshine ? 'Dark side glows' : 'Too faint'}</b>
      </div>
      <p className="muted hint">Position angles run from north through east; “from up” measures them the same way, counter-clockwise from the zenith side of the disc as it hangs in the viewfinder.</p>
    </>
  );
}

export function LightPointSummary() {
  const p = useLightProbe();
  const tz = useWorld((s) => s.tz);
  const hour12 = useSettings((s) => s.hour12);
  if (!p.point) return 'Light at a point · pick one';
  if (!p.light) return `Light at a point · ${p.error ? 'failed' : 'sweeping…'}`;
  const l = p.light;
  return `Light at a point · ${l.first !== null ? formatTime(l.first, tz, hour12) : '—'} to ${l.last !== null ? formatTime(l.last, tz, hour12) : '—'}`;
}

export function LightPointTools() {
  const p = useLightProbe();
  const tz = useWorld((s) => s.tz);
  const pin2 = useWorld((s) => s.pin2);
  const hour12 = useSettings((s) => s.hour12);
  const l = p.light;
  const onMap = useOnMap();
  const at = (ms: number | null) => (ms !== null ? formatTime(ms, tz, hour12) : '—');
  return (
    <>
      <div className="tool-row">
        {onMap && (
          <button onClick={() => p.setPicking(!p.picking)} aria-pressed={p.picking}>
            {p.picking ? 'Click the map…' : 'Pick on map'}
          </button>
        )}
        <button disabled={!pin2} onClick={() => pin2 && p.setPoint(pin2)}>
          Use target
        </button>
        <button disabled={!p.point} onClick={() => p.setPoint(null)}>
          Clear
        </button>
      </div>
      <div className="kv">
        <span className="k">Point</span>
        <b className="v">{p.point ? `${p.point.lat.toFixed(4)}, ${p.point.lng.toFixed(4)}` : '—'}</b>
        <span className="k">First light</span>
        <b className="v" data-probe="first">
          {l ? at(l.first) : p.busy ? '…' : '—'}
        </b>
        <span className="k">Last light</span>
        <b className="v" data-probe="last">
          {l ? at(l.last) : p.busy ? '…' : '—'}
        </b>
        <span className="k">Direct sun</span>
        <b className="v">{l ? hours(l.litMs) : '—'}</b>
        <span className="k">Now</span>
        <b className="v">{l ? (l.litNow ? 'In sun' : 'In shade') : '—'}</b>
      </div>
      {p.error && <p className="error">{p.error}</p>}
      <p className="muted hint">When the sun's upper limb clears and leaves the point's own skyline, from the terrain model. Buildings are left out.</p>
    </>
  );
}
