import { createContext, useContext, useState, type ReactNode } from 'react';
import { makeObserver, SkyBody } from '@core/astro/bodies';
import { depressionForHeightDeg, lastLightMs, litHeightM } from '@core/astro/earthShadow';
import { lunarEclipseLight } from '@core/astro/eclipse';
import { moonInfo, position } from '@core/astro/positions';
import { rainbowTop, SECONDARY_DEG } from '@core/astro/rainbow';
import { azimuth, bytes, degrees, distance, height, Units } from '@core/format';
import { cloudAngleDeg, cloudDistanceM, cloudHeightM } from '@core/geo/clouds';
import {
  APERTURE_THIRDS,
  apertureFor,
  ev100,
  evAtIso,
  formatShutter,
  ISO_THIRDS,
  isoFor,
  ND_FILTERS,
  ndFactor,
  ndOpticalDensity,
  ndShutter,
  ndStops,
  ndStopsFromDensity,
  nearestNominal,
  parseShutter,
  sceneExposure,
  SHUTTER_THIRDS_S,
  shutterFor
} from '@core/optics/exposure';
import { effectiveOptics, sensorPixels } from '@core/optics/fov';
import { rawBytesPerShot, timelapse, TimelapseSolve } from '@core/optics/timelapse';
import { formatTime } from '@core/time/format';
import { dayBounds } from '@core/time/localDay';
import { NEAREST_STATION_MAX_M } from '@core/tides/predict';
import { tideDay, TideKind, tideNow } from '@data/tides';
import { compositionStore, useComposition } from '@state/composition';
import { sensorById, useGear } from '@state/gear';
import { useSettings } from '@state/settings';
import { usePinSiteHeightM } from '@state/terrain';
import { Dial } from './Dial';
import { useOnMap } from './panelPage';
import { Disclosure } from './Section';
import { LightPointSummary, LightPointTools, MoonSummary, MoonTools } from './LightTools';
import { tideKindText, tideText, useNearestTide } from './TideChart';
import { timelapseStore, useTimelapse } from '@state/timelapse';
import { usePlanTime, useWorld, worldStore } from '@state/world';
import type { LngLat } from '@core/geo/geodesy';

const ExposureSolve = { Ev: 'Ev', Aperture: 'Aperture', Shutter: 'Shutter', Iso: 'Iso' } as const;
type ExposureSolve = (typeof ExposureSolve)[keyof typeof ExposureSolve];

const CloudSolve = { Distance: 'Distance', Height: 'Height', Angle: 'Angle' } as const;
type CloudSolve = (typeof CloudSolve)[keyof typeof CloudSolve];

const FT = 0.3048;
const MI = 1609.344;

const num = (text: string): number | null => {
  const v = Number(text);
  return text.trim() !== '' && Number.isFinite(v) ? v : null;
};
const ok = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v) && v > 0;
const signed = (deg: number, digits = 1) => `${deg >= 0 ? '+' : ''}${degrees(deg, digits)}`;
const evText = (ev: number) => (Math.abs(ev - Math.round(ev)) < 0.05 ? ev.toFixed(0) : ev.toFixed(1));
/** The nominal third-stop value, when the exact one is off it by more than 1%. */
const snapped = (v: number, table: readonly number[]) => {
  const s = nearestNominal(v, table);
  return s !== null && Math.abs(s - v) / v > 0.01 ? s : null;
};
const clipText = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${s.toFixed(1)} s`);

/** Which panel tab hosts a slice of the calculators. */
export const ToolsPart = { Frame: 'Frame', Weather: 'Weather', Sky: 'Sky' } as const;
export type ToolsPart = (typeof ToolsPart)[keyof typeof ToolsPart];
const PART_GROUPS: Record<ToolsPart, readonly string[]> = {
  Frame: ['exposure', 'nd', 'timelapse'],
  Weather: ['rainbow', 'clouds', 'tides'],
  Sky: ['moon', 'light-point']
};
const PartContext = createContext<ToolsPart>(ToolsPart.Frame);

function Group({ id, summary, children }: { id: string; summary: ReactNode; children: ReactNode }) {
  const part = useContext(PartContext);
  if (!PART_GROUPS[part].includes(id)) return null;
  return (
    <Disclosure id={`tools-${id}`} summary={summary}>
      {children}
    </Disclosure>
  );
}

// The shadow search is a root find; the panel re-renders every clock tick.
let lightCache: { key: string; ms: number | null } | null = null;
/** Readout row: dial, label, altitude, azimuth. */
function AltAzRow({ label, ink, alt, az }: { label: string; ink: string; alt: number; az: number }) {
  return (
    <div className="readout-row">
      <Dial az={az} ink={ink} />
      <span className="label">{label}</span>
      <span className="val" title="Altitude">
        {signed(alt)}
      </span>
      <span className="val" title="Azimuth">
        {azimuth(az)}
      </span>
    </div>
  );
}

function lastLightFor(pin: LngLat, siteM: number, time: number, heightM: number): number | null {
  const key = [Math.floor(time / 60_000), pin.lat.toFixed(4), pin.lng.toFixed(4), siteM, heightM].join('|');
  if (!lightCache || lightCache.key !== key) lightCache = { key, ms: lastLightMs(makeObserver(pin, siteM), time, heightM) };
  return lightCache.ms;
}

function TidesGroup() {
  const time = usePlanTime();
  const tz = useWorld((s) => s.tz);
  const units = useSettings((s) => s.units);
  const hour12 = useSettings((s) => s.hour12);
  const { loaded, failed, retry, site, distM } = useNearestTide();

  const day = dayBounds(new Date(time), tz);
  const [startMs, endMs] = [day.start.getTime(), day.end.getTime()];
  const today = site ? tideDay(site, startMs, endMs) : null;
  const next = today?.extremes.find((e) => e.timeMs > time);
  const now = site && today ? tideNow(site, today, time) : null;
  const st = site?.station;
  const summary = failed
    ? 'Tides · station data unavailable'
    : !loaded
      ? 'Tides · loading stations'
      : !st
        ? `Tides · no station within ${distance(NEAREST_STATION_MAX_M, units)}`
        : `Tides · ${st.name}${next ? ` · next ${next.high ? 'high' : 'low'} ${formatTime(next.timeMs, tz, hour12)} ${tideText(next.heightM, units)}` : ''}`;

  return (
    <Group id="tides" summary={summary}>
      {failed ? (
        <div className="tl-sim">
          <button onClick={retry}>Retry</button>
          <span className="muted">The bundled station table did not load.</span>
        </div>
      ) : !loaded ? null : !site || !today || !now ? (
        <p className="muted hint">No tide station within {distance(NEAREST_STATION_MAX_M, units)} of the camera.</p>
      ) : (
        <>
          <div className="kv">
            <span className="k">Station</span>
            <b className="v">
              {site.station.name}{' '}
              <span className="muted">
                · {site.station.id} · {tideKindText(site)} · {distance(distM, units)} away
              </span>
            </b>
            <span className="k">Now</span>
            <b className="v">
              {tideText(now.heightM, units)} <span className="muted">{now.rising ? 'rising' : 'falling'}</span>
            </b>
          </div>
          <div className="tide-extremes">
            {today.extremes.map((e) => (
              <button key={e.timeMs} className={`brow${e === next ? ' next' : ''}`} onClick={() => worldStore.getState().setTime(e.timeMs)} title="Set the clock to this moment">
                <span className="dot tide" aria-hidden="true" />
                <span className="label">{e.high ? 'High' : 'Low'}</span>
                <span className="time">{formatTime(e.timeMs, tz, hour12)}</span>
                <span className="az">{tideText(e.heightM, units)}</span>
              </button>
            ))}
          </div>
          <p className="muted hint">
            {site.kind === TideKind.Harmonic
              ? `Heights above MLLW from NOAA CO-OPS harmonic constants, at the nearest station within ${distance(NEAREST_STATION_MAX_M, units)}.`
              : `Highs and lows above MLLW from NOAA CO-OPS offsets on ${site.ref.name}'s harmonic prediction, at the nearest station within ${distance(NEAREST_STATION_MAX_M, units)}. Between them, NOAA's cosine curve (Tide Tables, Table 3), dashed.`}
          </p>
        </>
      )}
    </Group>
  );
}

export function ToolsPanel({ part }: { part: ToolsPart }) {
  const time = usePlanTime();
  const tz = useWorld((s) => s.tz);
  const pin = useWorld((s) => s.pin);
  const onMap = useOnMap();
  const siteM = usePinSiteHeightM();
  const units = useSettings((s) => s.units);
  const hour12 = useSettings((s) => s.hour12);
  const c = useComposition();
  const cameras = useGear((g) => g.cameras);
  const sim = useTimelapse();

  const [solve, setSolve] = useState<ExposureSolve>(ExposureSolve.Shutter);
  const [apText, setApText] = useState('');
  const [shText, setShText] = useState('1/125');
  const [isoText, setIsoText] = useState('100');
  const [evIn, setEvIn] = useState('15');

  const [ndText, setNdText] = useState('10');
  const [ndBase, setNdBase] = useState('1/30');

  const [tlSolve, setTlSolve] = useState<TimelapseSolve>(TimelapseSolve.Clip);
  const [tlInterval, setTlInterval] = useState('5');
  const [tlClip, setTlClip] = useState('20');
  const [tlEvent, setTlEvent] = useState('60');
  const [tlFps, setTlFps] = useState('25');
  const [tlMb, setTlMb] = useState('');

  const [cloudSolve, setCloudSolve] = useState<CloudSolve>(CloudSolve.Distance);
  const [cloudH, setCloudH] = useState(units === Units.Imperial ? '6500' : '2000');
  const [cloudA, setCloudA] = useState('5');
  const [cloudD, setCloudD] = useState(units === Units.Imperial ? '15' : '25');

  const obs = makeObserver(pin, siteM);
  const date = new Date(time);
  const sun = position(SkyBody.Sun, date, obs);
  const moon = position(SkyBody.Moon, date, obs);
  const moonLit = moonInfo(date).illumination;
  const opt = effectiveOptics(c);
  const sensor = sensorById(c.sensorId, cameras);
  const comp = compositionStore.getState().update;

  // Exposure: three inputs determine the fourth.
  const n = num(apText) ?? opt.fNumber;
  const t = parseShutter(shText);
  const iso = num(isoText);
  const evGiven = num(evIn);
  const solved =
    solve === ExposureSolve.Ev
      ? ok(n) && ok(t) && ok(iso) ? ev100(n, t, iso) : null
      : evGiven === null
        ? null
        : solve === ExposureSolve.Aperture
          ? ok(t) && ok(iso) ? apertureFor(evGiven, t, iso) : null
          : solve === ExposureSolve.Shutter
            ? ok(n) && ok(iso) ? shutterFor(evGiven, n, iso) : null
            : ok(n) && ok(t) ? isoFor(evGiven, n, t) : null;
  const solvedText = (() => {
    if (solved === null || !Number.isFinite(solved)) return '—';
    if (solve === ExposureSolve.Ev) return `EV ${solved.toFixed(1)}`;
    if (solve === ExposureSolve.Aperture) {
      const s = snapped(solved, APERTURE_THIRDS);
      return `f/${solved.toFixed(1)}${s ? ` ≈ f/${s}` : ''}`;
    }
    if (solve === ExposureSolve.Shutter) {
      const s = snapped(solved, SHUTTER_THIRDS_S);
      return `${formatShutter(solved)}${s ? ` ≈ ${formatShutter(s)}` : ''}`;
    }
    const s = snapped(solved, ISO_THIRDS);
    return `ISO ${Math.round(solved)}${s ? ` ≈ ${s}` : ''}`;
  })();
  const scenes = sceneExposure({ sunAltDeg: sun.altitude, moonAltDeg: moon.altitude, moonIllumination: moonLit, moonEclipse: lunarEclipseLight(date) });
  const field = (which: ExposureSolve, input: ReactNode) => (solve === which ? <b className="v">{solvedText}</b> : <b className="v">{input}</b>);

  // ND: one stops value drives the factor and density fields.
  const ndStopsV = num(ndText);
  const setStops = (s: number) => setNdText(String(Math.round(s * 100) / 100));
  const base = parseShutter(ndBase);

  // Time-lapse.
  const tl = timelapse({ intervalS: num(tlInterval) ?? 0, clipS: num(tlClip) ?? 0, eventS: (num(tlEvent) ?? 0) * 60, fps: num(tlFps) ?? 0 }, tlSolve);
  const tlOk = ok(tl.intervalS) && ok(tl.clipS) && ok(tl.eventS) && ok(tl.fps);
  const pixels = sensorPixels(sensor);
  const perShot = num(tlMb) !== null ? (num(tlMb) as number) * 1e6 : pixels ? rawBytesPerShot(pixels) : null;

  // Rainbow.
  const bow = rainbowTop(sun.azimuth, sun.altitude);
  const bow2 = rainbowTop(sun.azimuth, sun.altitude, SECONDARY_DEG);
  const bowSummary = bow.possible ? 'Rainbow possible' : sun.altitude <= 0 ? 'No rainbow · sun below the horizon' : 'No rainbow · sun above 42°';

  // Clouds, in display units.
  const hUnit = units === Units.Imperial ? FT : 1;
  const dUnit = units === Units.Imperial ? MI : 1000;
  const hM = (num(cloudH) ?? NaN) * hUnit;
  const dM = (num(cloudD) ?? NaN) * dUnit;
  const aDeg = num(cloudA) ?? NaN;
  const cloudOut =
    cloudSolve === CloudSolve.Distance
      ? (() => {
          const d = Number.isFinite(hM) && Number.isFinite(aDeg) ? cloudDistanceM(hM, aDeg, 0) : null;
          return d === null ? 'not in view at that angle' : distance(d, units);
        })()
      : cloudSolve === CloudSolve.Height
        ? Number.isFinite(dM) && Number.isFinite(aDeg) ? height(cloudHeightM(dM, aDeg, 0), units) : '—'
        : Number.isFinite(hM) && Number.isFinite(dM) ? signed(cloudAngleDeg(hM, dM, 0), 2) : '—';
  const litNow = litHeightM(sun.altitude);
  const lightH = cloudSolve === CloudSolve.Height ? (Number.isFinite(dM) && Number.isFinite(aDeg) ? cloudHeightM(dM, aDeg, 0) : NaN) : hM;
  const lastLight = Number.isFinite(lightH) && lightH > 0 ? lastLightFor(pin, siteM, time, lightH) : null;
  const lastLightAz = lastLight !== null ? position(SkyBody.Sun, new Date(lastLight), obs).azimuth : 0;

  return (
    <PartContext value={part}>
      <div className="frame night tools">
        <Group id="exposure" summary={`Exposure · ${solve === ExposureSolve.Ev ? solvedText : `EV ${evIn || '—'}`}${scenes[0] ? ` · now EV ${evText(scenes[0].ev)}` : ''}`}>
          <div className="kv">
            <span className="k">Solve for</span>
            <b className="v">
              <select value={solve} onChange={(e) => setSolve(e.target.value as ExposureSolve)} aria-label="Exposure term to solve for">
                <option value={ExposureSolve.Ev}>Exposure value</option>
                <option value={ExposureSolve.Aperture}>Aperture</option>
                <option value={ExposureSolve.Shutter}>Shutter</option>
                <option value={ExposureSolve.Iso}>ISO</option>
              </select>
            </b>
            <span className="k">Aperture</span>
            {field(
              ExposureSolve.Aperture,
              <>
                <span className="muted">f/</span>
                <input type="number" min={0.7} step={0.1} placeholder={String(opt.fNumber)} value={apText} onChange={(e) => setApText(e.target.value)} aria-label="Aperture, f-number" />
                {apText === '' && <span className="muted">from the lens</span>}
              </>
            )}
            <span className="k">Shutter</span>
            {field(ExposureSolve.Shutter, <input type="text" value={shText} onChange={(e) => setShText(e.target.value)} aria-label="Shutter time, like 1/250 or 30s" />)}
            <span className="k">ISO</span>
            {field(ExposureSolve.Iso, <input type="number" min={1} step={1} value={isoText} onChange={(e) => setIsoText(e.target.value)} aria-label="ISO" />)}
            <span className="k">EV100</span>
            {field(ExposureSolve.Ev, <input type="number" step={0.5} value={evIn} onChange={(e) => setEvIn(e.target.value)} aria-label="Exposure value at ISO 100" />)}
          </div>
          <p className="muted hint">Light now, by sun {signed(sun.altitude)} and moon {signed(moon.altitude)} · pick a row to use its EV.</p>
          <ul className="list">
            {scenes.map((r) => (
              <li key={r.label}>
                <button
                  className="primary"
                  onClick={() => {
                    setEvIn(evText(r.ev));
                    if (solve === ExposureSolve.Ev) setSolve(ExposureSolve.Shutter);
                  }}
                >
                  <span className="name">{r.label}</span>
                  <span className="detail">
                    EV100 {r.lo === r.hi ? evText(r.lo) : `${evText(r.lo)} to ${evText(r.hi)}`}
                    {r.estimate ? ' (estimate)' : ''}
                    {ok(iso) && iso !== 100 ? ` · EV ${evText(evAtIso(r.ev, iso))} at ISO ${iso}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Group>

        <Group id="nd" summary={`ND filter · ${ndStopsV !== null ? `${ndStopsV} stops` : '—'} · ${ok(base) && ndStopsV !== null ? `${formatShutter(base)} → ${formatShutter(ndShutter(base, ndStopsV))}` : ''}`}>
          <div className="kv">
            <span className="k">Stops</span>
            <b className="v">
              <input type="number" min={0} max={30} step={1 / 3} value={ndText} onChange={(e) => setNdText(e.target.value)} aria-label="Filter strength, stops" />
            </b>
            <span className="k">ND number</span>
            <b className="v">
              <span className="muted">ND</span>
              <input type="number" min={1} step={1} value={ndStopsV !== null ? Math.round(ndFactor(ndStopsV)) : ''} onChange={(e) => ok(num(e.target.value)) && setStops(ndStops(num(e.target.value) as number))} aria-label="Filter factor, ND number" />
            </b>
            <span className="k">Optical density</span>
            <b className="v">
              <input type="number" min={0} step={0.3} value={ndStopsV !== null ? ndOpticalDensity(ndStopsV).toFixed(1) : ''} onChange={(e) => num(e.target.value) !== null && setStops(ndStopsFromDensity(num(e.target.value) as number))} aria-label="Optical density" />
            </b>
            <span className="k">Base shutter</span>
            <b className="v">
              <input type="text" value={ndBase} onChange={(e) => setNdBase(e.target.value)} aria-label="Shutter without the filter" />
            </b>
            <span className="k">With filter</span>
            <b className="v">{ok(base) && ndStopsV !== null ? formatShutter(ndShutter(base, ndStopsV)) : '—'}</b>
          </div>
          <table className="nd-table">
            <thead>
              <tr>
                <th>Filter</th>
                <th>OD</th>
                <th>Stops</th>
                <th>{ok(base) ? formatShutter(base) : 'Base'} →</th>
              </tr>
            </thead>
            <tbody>
              {ND_FILTERS.map((f) => {
                const s = ndStops(f.factor);
                const on = ndStopsV !== null && Math.abs(s - ndStopsV) < 0.05;
                return (
                  <tr key={f.name} className={on ? 'on' : ''} onClick={() => setStops(s)}>
                    <td>
                      {/* Its click bubbles to the row's. */}
                      <button className="nd-pick" aria-pressed={on}>
                        {f.name}
                      </button>
                    </td>
                    <td>{ndOpticalDensity(s).toFixed(1)}</td>
                    <td>{s.toFixed(s % 1 ? 1 : 0)}</td>
                    <td>{ok(base) ? formatShutter(ndShutter(base, s)) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Group>

        <Group id="timelapse" summary={`Time-lapse · ${tlOk ? `${tl.shots} shots, ${tl.intervalS.toFixed(1)} s apart, ${clipText(tl.clipS)} clip` : '—'}`}>
          <div className="kv">
            <span className="k">Solve for</span>
            <b className="v">
              <select value={tlSolve} onChange={(e) => setTlSolve(e.target.value as TimelapseSolve)} aria-label="Time-lapse term to solve for">
                <option value={TimelapseSolve.Interval}>Interval</option>
                <option value={TimelapseSolve.Clip}>Clip length</option>
                <option value={TimelapseSolve.Event}>Event duration</option>
              </select>
            </b>
            <span className="k">Interval</span>
            <b className="v">
              {tlSolve === TimelapseSolve.Interval ? (
                `${tl.intervalS.toFixed(2)} s`
              ) : (
                <>
                  <input type="number" min={0.1} step={0.5} value={tlInterval} onChange={(e) => setTlInterval(e.target.value)} aria-label="Interval, seconds" />
                  <span className="muted">s</span>
                </>
              )}
            </b>
            <span className="k">Clip length</span>
            <b className="v">
              {tlSolve === TimelapseSolve.Clip ? (
                clipText(tl.clipS)
              ) : (
                <>
                  <input type="number" min={1} step={1} value={tlClip} onChange={(e) => setTlClip(e.target.value)} aria-label="Clip length, seconds" />
                  <span className="muted">s</span>
                </>
              )}
            </b>
            <span className="k">Event</span>
            <b className="v">
              {tlSolve === TimelapseSolve.Event ? (
                `${(tl.eventS / 60).toFixed(1)} min`
              ) : (
                <>
                  <input type="number" min={1} step={5} value={tlEvent} onChange={(e) => setTlEvent(e.target.value)} aria-label="Event duration, minutes" />
                  <span className="muted">min</span>
                </>
              )}
            </b>
            <span className="k">Frame rate</span>
            <b className="v">
              <input type="number" min={1} max={120} step={1} value={tlFps} onChange={(e) => setTlFps(e.target.value)} aria-label="Frames per second" />
              <span className="muted">fps</span>
            </b>
            <span className="k">Shots</span>
            <b className="v">{tlOk ? `${tl.shots} · ${Math.round(tl.speedup)}× speed-up` : '—'}</b>
            <span className="k">Per shot</span>
            <b className="v">
              <input type="number" min={0.1} step={1} placeholder={pixels ? (rawBytesPerShot(pixels) / 1e6).toFixed(0) : 'MB'} value={tlMb} onChange={(e) => setTlMb(e.target.value)} aria-label="Megabytes per shot" />
              <span className="muted">MB{tlMb === '' && pixels ? `, 14-bit raw of ${(pixels / 1e6).toFixed(1)} MP` : tlMb === '' ? ' (pick the camera above)' : ''}</span>
            </b>
            <span className="k">Card space</span>
            <b className="v">{tlOk && perShot ? bytes(perShot * tl.shots) : '—'}</b>
          </div>
          <div className="tl-sim">
            <button disabled={!tlOk} onClick={() => (sim.playing ? timelapseStore.getState().pause() : timelapseStore.getState().play(tl.intervalS, tl.shots, tl.fps))} aria-label={sim.playing ? 'Pause the simulation' : 'Play the simulation'}>
              {sim.playing ? 'Pause' : 'Play'}
            </button>
            <button disabled={sim.startMs === null} onClick={() => timelapseStore.getState().reset()}>
              Reset
            </button>
            <span className="muted">{sim.startMs !== null ? `Shot ${(sim.k % Math.max(1, tl.shots)) + 1} of ${tl.shots} · ${formatTime(time, tz, hour12, true)}` : 'Steps the clock by the interval from now'}</span>
          </div>
        </Group>

        <Group id="rainbow" summary={bowSummary}>
          <AltAzRow label="Sun" ink="sun mid" alt={sun.altitude} az={sun.azimuth} />
          {bow.possible && <AltAzRow label="Primary top" ink="rainbow" alt={bow.altitudeDeg} az={bow.azimuthDeg} />}
          <div className="kv">
            <span className="k">Feet</span>
            <b className="v">{bow.possible ? `${degrees(bow.halfSpanDeg, 0)} either side of the top` : '—'}</b>
            <span className="k">Secondary top</span>
            <b className="v">{bow2.possible ? `${signed(bow2.altitudeDeg)}, 51° from the antisolar point` : '—'}</b>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={c.showRainbow} onChange={(e) => comp({ showRainbow: e.target.checked })} />
            <span>Rainbow arcs in the viewfinder</span>
          </label>
          <p className="muted hint">A bow needs rain in front of you and sun behind, below 42° (51° for the secondary).</p>
        </Group>

        <Group id="clouds" summary={`Clouds · ${cloudSolve === CloudSolve.Distance ? 'distance' : cloudSolve === CloudSolve.Height ? 'height' : 'angle'} ${cloudOut} · ${sun.altitude < 0 ? Number.isFinite(litNow) ? `lit above ${distance(litNow, units)}` : 'unlit' : 'sun up'}`}>
          <div className="kv">
            <span className="k">Solve for</span>
            <b className="v">
              <select value={cloudSolve} onChange={(e) => setCloudSolve(e.target.value as CloudSolve)} aria-label="Cloud term to solve for">
                <option value={CloudSolve.Distance}>Distance</option>
                <option value={CloudSolve.Height}>Height</option>
                <option value={CloudSolve.Angle}>Angle</option>
              </select>
            </b>
            <span className="k">Cloud base</span>
            <b className="v">
              {cloudSolve === CloudSolve.Height ? (
                cloudOut
              ) : (
                <>
                  <input type="number" min={0} step={100} value={cloudH} onChange={(e) => setCloudH(e.target.value)} aria-label="Cloud base above the ground" />
                  <span className="muted">{units === Units.Imperial ? 'ft' : 'm'} above the ground</span>
                </>
              )}
            </b>
            <span className="k">Angle up</span>
            <b className="v">
              {cloudSolve === CloudSolve.Angle ? (
                cloudOut
              ) : (
                <>
                  <input type="number" min={-10} max={90} step={0.5} value={cloudA} onChange={(e) => setCloudA(e.target.value)} aria-label="Angle up to the cloud, degrees" />
                  <span className="muted">°</span>
                </>
              )}
            </b>
            <span className="k">Distance</span>
            <b className="v">
              {cloudSolve === CloudSolve.Distance ? (
                cloudOut
              ) : (
                <>
                  <input type="number" min={0} step={1} value={cloudD} onChange={(e) => setCloudD(e.target.value)} aria-label="Ground distance to the cloud" />
                  <span className="muted">{units === Units.Imperial ? 'mi' : 'km'}</span>
                </>
              )}
            </b>
          </div>
          <h3>Sunlit clouds</h3>
          <div className="kv">
            <span className="k">Sunlit now above</span>
            <b className="v">{sun.altitude >= 0 ? 'every height · sun up' : Number.isFinite(litNow) ? distance(litNow, units) : '—'}</b>
            <span className="k">Stays lit until</span>
            <b className="v">{Number.isFinite(lightH) && lightH > 0 ? `sun ${signed(-depressionForHeightDeg(lightH))}` : '—'}</b>
          </div>
          {lastLight !== null && (
            <button className="brow" onClick={() => worldStore.getState().setTime(lastLight)} title="Set the clock to this moment">
              <Dial az={lastLightAz} ink="sun set" />
              <span className="label">Last light on the cloud</span>
              <span className="time">{formatTime(lastLight, tz, hour12)}</span>
              <span className="az">
                {azimuth(lastLightAz)}
              </span>
            </button>
          )}
          <p className="muted hint">For a cloud overhead; clouds toward the sunset stay lit a little longer. Geometric, without refraction.</p>
        </Group>

        {part === ToolsPart.Weather && <TidesGroup />}
        <Group id="moon" summary={<MoonSummary />}>
          <MoonTools />
        </Group>
        {onMap && (
          <Group id="light-point" summary={<LightPointSummary />}>
            <LightPointTools />
          </Group>
        )}
      </div>
    </PartContext>
  );
}
