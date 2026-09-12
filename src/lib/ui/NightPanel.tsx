import { useState } from 'react';
import { makeObserver } from '@core/astro/bodies';
import { activeShowers, radiantHorizontal, upcomingPeaks, type ShowerStatus } from '@core/astro/meteors';
import { milkyWayStatus, MoonRule } from '@core/astro/milkyWay';
import { polarisAid } from '@core/astro/polaris';
import { apply, enuToEqj } from '@core/astro/skyFrame';
import { compass, degrees, percent } from '@core/format';
import { cropFactor, equivalentFocalMm } from '@core/optics/fov';
import { dirFromAzAlt } from '@core/optics/projection';
import { npfShutterS, pixelPitchUm, ruleOfN, trailAngleDeg, trailLengthPx } from '@core/optics/startrails';
import { formatDateShort, formatTime } from '@core/time/format';
import { aimFor, compositionStore, useComposition } from '@state/composition';
import { useDayData } from '@state/dayData';
import { sensorById, useGear } from '@state/gear';
import { settingsStore, useSettings } from '@state/settings';
import { horizonKeyFor, profileKeyFor, useTerrain } from '@state/terrain';
import { useWorld, worldStore } from '@state/world';

const DAY_MS = 86_400_000;
const R2D = 180 / Math.PI;

const duration = (ms: number) => {
  const m = Math.round(ms / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
};
const clock = (c: number) => {
  const h = Math.floor(c) === 0 ? 12 : Math.floor(c);
  return `${h}:${String(Math.round((c - Math.floor(c)) * 60)).padStart(2, '0')}`;
};
const signed = (deg: number, digits = 1) => `${deg >= 0 ? '+' : ''}${degrees(deg, digits)}`;

// Peak searches are slow enough to keep per day, not per render.
let showerCache: { day: number; active: ShowerStatus[]; upcoming: ShowerStatus[] } | null = null;
function showersFor(time: number) {
  const day = Math.floor(time / DAY_MS);
  if (!showerCache || showerCache.day !== day) {
    const active = activeShowers(time);
    showerCache = { day, active, upcoming: upcomingPeaks(time, 120).filter((u) => !active.some((a) => a.shower.code === u.shower.code)) };
  }
  return showerCache;
}

/** Declination of the sky the camera points at; star trails run fastest at 0°. */
function aimDeclination(time: number, obs: ReturnType<typeof makeObserver>, azDeg: number, altDeg: number): number {
  const d = dirFromAzAlt(azDeg, altDeg);
  const out = new Float64Array(3);
  apply(enuToEqj(new Date(time), obs), d.x, d.y, d.z, out);
  return Math.asin(Math.max(-1, Math.min(1, out[2]))) * R2D;
}

export function NightPanel() {
  const time = useWorld((s) => s.time);
  const tz = useWorld((s) => s.tz);
  const pin = useWorld((s) => s.pin);
  const pin2 = useWorld((s) => s.pin2);
  const pinHeightM = useWorld((s) => s.pinHeightM);
  const s = useSettings();
  const windows = useDayData((d) => d.milkyWay);
  const c = useComposition();
  const cameras = useGear((g) => g.cameras);
  const profile = useTerrain((t) => t.profile);
  const profileKey = useTerrain((t) => t.profileKey);
  const horizon = useTerrain((t) => t.horizon);
  const horizonKey = useTerrain((t) => t.horizonKey);
  const [pxText, setPxText] = useState('');

  const obs = makeObserver(pin, pinHeightM);
  const opts = { sunMaxAltDeg: s.mwSunMaxAlt, gcMinAltDeg: s.mwGcMinAlt, moonRule: s.mwMoonRule, moonMaxIllumination: s.mwMoonMaxIllum };
  const hk = horizonKeyFor(worldStore.getState(), settingsStore.getState());
  const skyline = hk && horizon && horizonKey === hk ? horizon.profile : undefined;
  const mw = milkyWayStatus(obs, time, opts, skyline);
  const sensor = sensorById(c.sensorId, cameras);
  const pixels = sensor.pixelsWide ?? (Number(pxText) > 0 ? Number(pxText) : null);
  const pitch = pixels ? pixelPitchUm(sensor.widthMm, pixels) : null;
  const fresh = profile && profileKey === profileKeyFor(worldStore.getState(), settingsStore.getState()) ? profile : null;
  const aim = aimFor(c, { pin, pin2 }, fresh?.los.targetAngleDeg ?? null);
  const dec = aimDeclination(time, obs, aim.azimuthDeg, aim.elevationDeg);
  const r500 = ruleOfN(c.focalMm, cropFactor(sensor));
  const npf = pitch ? npfShutterS(c.fNumber, c.focalMm, pitch, dec) : null;
  const trailS = c.trailMinutes * 60;
  const { active, upcoming } = showersFor(time);
  const polaris = polarisAid(new Date(time), obs);
  const update = settingsStore.getState().update;
  const setTime = worldStore.getState().setTime;
  const comp = compositionStore.getState().update;

  const reasons = [!mw.dark && `sun at ${signed(mw.sunAltDeg)}`, !mw.coreUp && `core needs ${signed(mw.floorDeg)}`, !mw.moonOk && `moon up, ${percent(mw.moonIllumination, 0)} lit`].filter(Boolean);

  return (
    <div className="frame night">
      <h3>Milky Way core</h3>
      <p className={`verdict${mw.visible ? '' : ' off'}`}>
        {mw.visible ? 'Core visible now' : 'Core not visible now'} · {signed(mw.altitudeDeg)} at {degrees(mw.azimuthDeg, 0)} {compass(mw.azimuthDeg)}
        {reasons.length > 0 && <span className="why"> · {reasons.join(', ')}</span>}
      </p>
      {windows.length === 0 && <p className="muted hint">No core window on this day under the rules below.</p>}
      <ul className="list">
        {windows.map((w) => (
          <li key={w.startMs}>
            <button className="primary" onClick={() => setTime(w.peakMs)} title="Set the clock to the best moment">
              <span className="name">
                {w.clippedStart ? '…' : formatTime(w.startMs, tz, s.hour12)} – {w.clippedEnd ? '…' : formatTime(w.endMs, tz, s.hour12)}
              </span>
              <span className="detail">
                {duration(w.endMs - w.startMs)} · peak {signed(w.peakAltDeg, 0)} at {formatTime(w.peakMs, tz, s.hour12)} · {degrees(w.azStartDeg, 0)} → {degrees(w.azEndDeg, 0)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="kv">
        <span className="k">Core above</span>
        <b className="v">
          <input type="number" min={0} max={60} step={1} value={s.mwGcMinAlt} onChange={(e) => update({ mwGcMinAlt: Math.min(60, Math.max(0, Number(e.target.value) || 0)) })} aria-label="Minimum core altitude, degrees" />
          <span className="muted">°</span>
        </b>
        <span className="k">Dark sky</span>
        <b className="v">
          <select value={s.mwSunMaxAlt} onChange={(e) => update({ mwSunMaxAlt: Number(e.target.value) })} aria-label="Sun altitude that counts as dark">
            <option value={-18}>Sun below −18° (astronomical)</option>
            <option value={-15}>Sun below −15°</option>
            <option value={-12}>Sun below −12° (nautical)</option>
          </select>
        </b>
        <span className="k">Moon</span>
        <b className="v">
          <select value={s.mwMoonRule} onChange={(e) => update({ mwMoonRule: e.target.value as MoonRule })} aria-label="Moon rule">
            <option value={MoonRule.Down}>Must be below the horizon</option>
            <option value={MoonRule.Dim}>May be up if thin</option>
            <option value={MoonRule.Ignore}>Ignored</option>
          </select>
          {s.mwMoonRule === MoonRule.Dim && (
            <>
              {' '}
              <input type="number" min={0} max={100} step={5} value={Math.round(s.mwMoonMaxIllum * 100)} onChange={(e) => update({ mwMoonMaxIllum: Math.min(1, Math.max(0, Number(e.target.value) / 100)) })} aria-label="Maximum moon illumination, percent" />
              <span className="muted">% lit</span>
            </>
          )}
        </b>
      </div>

      <h3>Exposure</h3>
      <div className="kv">
        <span className="k">Pixels</span>
        <b className="v">
          {pitch ? (
            <>
              {pitch.toFixed(2)} µm pitch <span className="muted">· {pixels} px across {sensor.widthMm} mm</span>
            </>
          ) : (
            <>
              <input type="number" min={100} step={1} placeholder="6000" value={pxText} onChange={(e) => setPxText(e.target.value)} aria-label="Image width in pixels" />
              <span className="muted">px wide (or pick the camera in Frame)</span>
            </>
          )}
        </b>
        <span className="k">500 rule</span>
        <b className="v">
          {r500.toFixed(1)} s <span className="muted">· {equivalentFocalMm(sensor, c.focalMm).toFixed(0)} mm equivalent</span>
        </b>
        <span className="k">NPF rule</span>
        <b className="v">{npf ? `${npf.toFixed(1)} s` : 'needs the pixel count'} <span className="muted">· f/{c.fNumber}, {c.focalMm} mm, declination {signed(dec, 0)}</span></b>
      </div>
      <label className="toggle">
        <input type="checkbox" checked={c.showTrails} onChange={(e) => comp({ showTrails: e.target.checked })} />
        <span>Star trails in the viewfinder over</span>
        <input type="number" min={1} max={720} step={5} value={c.trailMinutes} onChange={(e) => comp({ trailMinutes: Math.min(720, Math.max(1, Number(e.target.value) || 1)) })} aria-label="Trail duration, minutes" style={{ width: 64 }} />
        <span>min</span>
      </label>
      <p className="muted hint">
        In {c.trailMinutes} min a star at that declination moves {trailAngleDeg(trailS, dec).toFixed(2)}°{pitch ? `, about ${Math.round(trailLengthPx(trailS, c.focalMm, pitch, dec))} px on this sensor` : ''}.
      </p>

      <h3>Meteor showers</h3>
      {active.length === 0 && <p className="muted hint">No shower active on this date.</p>}
      <ul className="list">
        {active.map((st) => {
          const h = radiantHorizontal(st, time, obs);
          return (
            <li key={st.shower.code}>
              <button className="primary" onClick={() => setTime(st.peakMs)} title="Set the clock to the maximum">
                <span className="name">
                  {st.shower.name} <span className="meta">ZHR {st.shower.zhr ?? 'variable'}</span>
                </span>
                <span className="detail">
                  radiant {h.altitudeDeg >= 0 ? `${signed(h.altitudeDeg, 0)} at ${degrees(h.azimuthDeg, 0)} ${compass(h.azimuthDeg)}` : 'below the horizon'} · peak {formatDateShort(st.peakMs, tz)}
                  {Math.abs(st.daysFromPeak) < 1 ? ' (now)' : st.daysFromPeak < 0 ? ` in ${Math.round(-st.daysFromPeak)} d` : ` ${Math.round(st.daysFromPeak)} d ago`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {upcoming.length > 0 && (
        <>
          <p className="muted hint">Next maxima</p>
          <ul className="list">
            {upcoming.map((st) => (
              <li key={st.shower.code}>
                <button className="primary" onClick={() => setTime(st.peakMs)} title="Jump to the maximum">
                  <span className="name">{st.shower.name}</span>
                  <span className="detail">
                    {formatDateShort(st.peakMs, tz)} · ZHR {st.shower.zhr ?? 'variable'} · {st.shower.vKmS} km/s
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>Polar alignment</h3>
      <div className="kv">
        <span className="k">Pole</span>
        <b className="v">
          {signed(polaris.poleAltDeg, 1)} due {polaris.northern ? 'north' : 'south'}
        </b>
        {polaris.northern && (
          <>
            <span className="k">Polaris</span>
            <b className="v">
              {signed(polaris.polarisAltDeg)} at {degrees(polaris.polarisAzDeg)} <span className="muted">· {polaris.separationDeg.toFixed(2)}° from the pole</span>
            </b>
            <span className="k">Clock</span>
            <b className="v">
              {clock(polaris.clockSky)} in the sky <span className="muted">· {clock(polaris.clockScope)} in a polar scope</span>
            </b>
          </>
        )}
      </div>
      <p className="muted hint">Stars, constellation figures, the Milky Way, trails and meteor radiants are drawn in the viewfinder; its layer chips switch them on and off.</p>
    </div>
  );
}
