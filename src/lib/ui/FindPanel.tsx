import { SkyBody } from '@core/astro/bodies';
import { SkyFilter } from '@core/astro/finder';
import { azimuth, compass, degrees, distance, percent } from '@core/format';
import { formatDate, formatDateTime, formatTime } from '@core/time/format';
import { formatLngLat } from '@core/geo/coords';
import { useAlign, alignStore } from '@state/align';
import { finderStore, useFinder } from '@state/finder';
import { searchesStore } from '@state/searches';
import { useSettings } from '@state/settings';
import { useWorld, worldStore } from '@state/world';
import { HeatMode } from '@workers/align.protocol';
import { Dial } from './Dial';
import { downloadText } from './download';
import { useOnMap } from './panelPage';
import { Disclosure } from './Section';
import { Segmented } from './Segmented';

const BODY_LABEL: Record<SkyBody, string> = { Sun: 'Sun', Moon: 'Moon', Gc: 'Galactic Centre' };

const SKY_LABEL: Record<SkyFilter, string> = {
  Any: 'Any',
  Daylight: 'Daylight',
  GoldenHour: 'Golden hour',
  BlueHour: 'Blue hour',
  SunDown: 'Sun down',
  CivilDark: 'Civil dark',
  NauticalDark: 'Nautical dark',
  AstroDark: 'Astronomical dark'
};

const MODE_LABEL: Record<HeatMode, string> = { Off: 'Off', Viewshed: 'Viewshed', Visible: 'Visible', Align: 'Align', Time: 'Time' };

const MODE_HELP: Record<HeatMode, string> = {
  Off: 'No heat layer on the map.',
  Viewshed: 'Ground that can be seen from the camera location.',
  Visible: 'Where the body stands above the terrain at this moment.',
  Align: 'Where the camera would put the body behind the target location.',
  Time: 'The same, coloured by when the alignment happens.'
};

const DAYS = [30, 90, 180, 365];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const BODIES: SkyBody[] = [SkyBody.Sun, SkyBody.Moon, SkyBody.Gc];
const MODES: HeatMode[] = [HeatMode.Off, HeatMode.Viewshed, HeatMode.Visible, HeatMode.Align, HeatMode.Time];
const BODY_OPTIONS = BODIES.map((b) => ({ value: b, label: BODY_LABEL[b] }));
const MODE_OPTIONS = MODES.map((m) => ({ value: m, label: MODE_LABEL[m] }));

const signed = (deg: number, digits = 1) => `${deg >= 0 ? '+' : ''}${degrees(deg, digits)}`;
const num = (v: string, fallback: number) => (v.trim() === '' || Number.isNaN(Number(v)) ? fallback : Number(v));

/** Signed minutes and seconds, "+3:20". */
function offsetMs(ms: number): string {
  const s = Math.round(Math.abs(ms) / 1000);
  return `${ms < 0 ? '−' : '+'}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const LEGEND: Record<HeatMode, { color: string; label: string }[]> = {
  Off: [],
  Viewshed: [{ color: 'rgb(56 193 114 / 0.7)', label: 'In sight of the camera' }],
  Visible: [{ color: 'rgb(27 42 74 / 0.85)', label: 'Body hidden by terrain' }],
  Align: [
    { color: '#ffe14d', label: 'Within the tolerance' },
    { color: '#ff8a1a', label: 'Near' },
    { color: '#4c1d95', label: 'Far' }
  ],
  Time: [
    { color: '#3b82f6', label: 'Earlier than the set time' },
    { color: '#ffffff', label: 'At the set time' },
    { color: '#ef4444', label: 'Later' }
  ]
};

export function FindPanel() {
  const f = useFinder((s) => s.settings);
  const running = useFinder((s) => s.running);
  const progress = useFinder((s) => s.progress);
  const hits = useFinder((s) => s.hits);
  const total = useFinder((s) => s.total);
  const elapsedMs = useFinder((s) => s.elapsedMs);
  const error = useFinder((s) => s.error);
  const resultPin = useFinder((s) => s.pin);
  const a = useAlign();
  const onMap = useOnMap();
  const pin = useWorld((s) => s.pin);
  const pin2 = useWorld((s) => s.pin2);
  const tz = useWorld((s) => s.tz);
  const s = useSettings();

  const update = finderStore.getState().update;
  const align = alignStore.getState();
  const terrainOff = !s.terrain || !s.terrainHorizon;
  const stale = !!resultPin && (resultPin.lat !== pin.lat || resultPin.lng !== pin.lng);
  const needsTarget = a.mode === HeatMode.Align || a.mode === HeatMode.Time;
  const c = a.candidate;
  const offset = useWorld((w) => (c ? offsetMs(c.bestMs - w.time) : ''));

  const setWeekday = (d: number) => {
    const on = f.weekdays ?? [];
    const next = on.includes(d) ? on.filter((x) => x !== d) : [...on, d].toSorted();
    update({ weekdays: next.length === 0 || next.length === 7 ? null : next });
  };

  const filters = [SKY_LABEL[f.sky], `moon ${Math.round(f.moonIllumMin * 100)}–${Math.round(f.moonIllumMax * 100)}%`, f.moonDown && f.body !== SkyBody.Moon && 'moon down', f.weekdays && f.weekdays.map((d) => WEEKDAYS[d]).join(' '), f.aboveTerrain && !terrainOff && 'above skyline'];
  const filtersSummary = `Filters · ${filters.filter(Boolean).join(' · ')}`;

  const saveSearch = (withPin: boolean) => {
    const name = window.prompt('Name for this search', `${BODY_LABEL[f.body]} ${Math.round(f.azFromDeg)}–${Math.round(f.azToDeg)}°`);
    if (!name) return;
    void searchesStore.getState().save(name, withPin ? pin : null);
  };

  return (
    <div className="frame find">
      <Segmented label="Body" value={f.body} options={BODY_OPTIONS} onChange={(body) => update({ body })} />
      <div className="kv">
        <span className="k">Azimuth</span>
        <b className="v">
          <span className="unit">
            <input type="number" step={0.1} value={f.azFromDeg} onChange={(e) => update({ azFromDeg: num(e.target.value, 0) })} aria-label="Azimuth from, degrees" />
            <span className="muted">°</span>
          </span>
          <span className="muted"> to </span>
          <span className="unit">
            <input type="number" step={0.1} value={f.azToDeg} onChange={(e) => update({ azToDeg: num(e.target.value, 0) })} aria-label="Azimuth to, degrees" />
            <span className="muted">°</span>
          </span>
        </b>
        <span className="k">Altitude</span>
        <b className="v">
          <span className="unit">
            <input type="number" step={0.1} value={f.altMinDeg} onChange={(e) => update({ altMinDeg: num(e.target.value, 0) })} aria-label="Minimum altitude, degrees" />
            <span className="muted">°</span>
          </span>
          <span className="muted"> to </span>
          <span className="unit">
            <input type="number" step={0.1} value={f.altMaxDeg} onChange={(e) => update({ altMaxDeg: num(e.target.value, 0) })} aria-label="Maximum altitude, degrees" />
            <span className="muted">°</span>
          </span>
        </b>
        <span className="k">From</span>
        <b className="v">
          <input type="date" value={f.startIso} onChange={(e) => update({ startIso: e.target.value })} aria-label="First day of the search" style={{ width: 'auto' }} />
        </b>
        <span className="k">For</span>
        <b className="v">
          <select value={f.days} onChange={(e) => update({ days: Number(e.target.value) })} aria-label="Days to search">
            {DAYS.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </b>
      </div>
      <div className="actions">
        <button onClick={() => finderStore.getState().fromTarget()} disabled={!pin2} title={pin2 ? 'Window around the direction to the target location' : 'Place a target location first'}>
          From target ± tol
        </button>
        <button onClick={() => finderStore.getState().fromFrame()} title="Window matching the current frame">
          From frame
        </button>
        <span className="unit">
          <input type="number" step={0.1} min={0.1} max={45} value={f.toleranceDeg} onChange={(e) => update({ toleranceDeg: num(e.target.value, 2) })} aria-label="Tolerance, degrees" style={{ width: 60 }} />
          <span className="muted">° tolerance</span>
        </span>
      </div>
      <Disclosure id="find-filters" summary={filtersSummary}>
        <div className="kv">
          <span className="k">Sky</span>
          <b className="v">
            <select value={f.sky} onChange={(e) => update({ sky: e.target.value as SkyFilter })} aria-label="Sky condition">
              {Object.values(SkyFilter).map((k) => (
                <option key={k} value={k}>
                  {SKY_LABEL[k]}
                </option>
              ))}
            </select>
          </b>
          <span className="k">Moon lit</span>
          <b className="v">
            <input type="number" min={0} max={100} step={5} value={Math.round(f.moonIllumMin * 100)} onChange={(e) => update({ moonIllumMin: Math.min(1, Math.max(0, num(e.target.value, 0) / 100)) })} aria-label="Minimum moon illumination, percent" />
            <span className="muted">% to </span>
            <input type="number" min={0} max={100} step={5} value={Math.round(f.moonIllumMax * 100)} onChange={(e) => update({ moonIllumMax: Math.min(1, Math.max(0, num(e.target.value, 100) / 100)) })} aria-label="Maximum moon illumination, percent" />
            <span className="muted">%</span>
          </b>
        </div>
        <div className="chips one">
          <button onClick={() => update({ moonIllumMin: 0.9, moonIllumMax: 1 })}>Full moon</button>
          <button onClick={() => update({ moonIllumMin: 0, moonIllumMax: 0.2 })}>Dark sky</button>
          <button onClick={() => update({ moonIllumMin: 0, moonIllumMax: 1 })}>Any</button>
        </div>
        {f.body !== SkyBody.Moon && (
          <label className="toggle">
            <input type="checkbox" checked={f.moonDown} onChange={(e) => update({ moonDown: e.target.checked })} />
            <span>Moon below the horizon</span>
          </label>
        )}
        <div className="chips weekdays" role="group" aria-label="Weekdays">
          {WEEKDAYS.map((w, i) => (
            <button key={w} className={f.weekdays?.includes(i) ? 'on' : ''} aria-pressed={!!f.weekdays?.includes(i)} aria-label={WEEKDAY_NAMES[i]} onClick={() => setWeekday(i)}>
              {w}
            </button>
          ))}
        </div>
        <label className="toggle">
          <input type="checkbox" checked={f.aboveTerrain} disabled={terrainOff} onChange={(e) => update({ aboveTerrain: e.target.checked })} />
          <span>Above the terrain skyline</span>
        </label>
        {terrainOff && <p className="muted hint">Switch on elevation data and the terrain horizon in Settings to use the skyline.</p>}
      </Disclosure>
      <div className="actions">
        {running ? <button onClick={() => finderStore.getState().cancel()}>Cancel</button> : <button className="on" onClick={() => finderStore.getState().run()}>Search</button>}
      </div>
      {(running || progress > 0) && (
        <>
          <div className="progress" role="progressbar" aria-valuenow={Math.round(progress * 100)}>
            <i style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <p className="muted hint">
            {hits.length} moment{hits.length === 1 ? '' : 's'} · {total} pass{total === 1 ? '' : 'es'} · {running ? `${Math.round(progress * 100)}%` : `${(elapsedMs / 1000).toFixed(1)} s`}
          </p>
        </>
      )}
      {error && <p className="error">{error}</p>}
      {stale && <p className="muted hint">Results are for another camera location{resultPin ? ` (${formatLngLat(resultPin, s.coordFormat)})` : ''}.</p>}
      <ul className="list">
        {hits.map((h) => (
          <li key={h.bestMs}>
            <button className="primary brow" onClick={() => worldStore.getState().setTime(h.bestMs)} title="Set the clock to this moment">
              <Dial az={h.azDeg} ink={`${f.body.toLowerCase()} mid`} />
              <span className="label">
                {formatDate(h.bestMs, tz)}
                {(h.clippedStart || h.clippedEnd) && <span className="meta">{h.clippedStart ? '⇤' : ''}{h.clippedEnd ? '⇥' : ''}</span>}
              </span>
              <span className="time">{formatTime(h.bestMs, tz, s.hour12)}</span>
              <span className="az">
                {azimuth(h.azDeg)}
              </span>
              <span className="note">
                alt {signed(h.altDeg)} · sun {signed(h.sunAltDeg, 0)} · moon {percent(h.moonIllumination, 0)} {h.moonPhase.toLowerCase()}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {!running && hits.length === 0 && progress > 0 && <p className="muted hint">Nothing matched; widen the window, the date range or the sky filter.</p>}
      <Disclosure id="find-export" summary={`Export & save · ${hits.length} moment${hits.length === 1 ? '' : 's'}`}>
        <div className="actions">
          <button onClick={() => downloadText('scape-search.csv', finderStore.getState().toCsv(s.units), 'text/csv')} disabled={hits.length === 0}>
            Export CSV
          </button>
          <button onClick={() => saveSearch(true)}>Save search</button>
          <button className="link" onClick={() => saveSearch(false)} title="Save the settings without a camera location">
            save for any location
          </button>
        </div>
      </Disclosure>

      {onMap && (
        <Disclosure id="find-heat" summary={`Visibility & alignment · ${MODE_LABEL[a.mode]}`}>
          <Segmented label="Heat mode" value={a.mode} options={MODE_OPTIONS} onChange={(mode) => align.update({ mode })} />
          <p className="muted hint">{MODE_HELP[a.mode]}</p>
          {a.mode !== HeatMode.Off && (
            <>
              {a.mode !== HeatMode.Viewshed && (
                <Segmented label="Body for the heat layer" value={a.body} options={BODY_OPTIONS} onChange={(body) => align.update({ body })} />
              )}
              <div className="kv">
                {needsTarget && (
                  <>
                    <span className="k">Tolerance</span>
                    <b className="v">
                      <input type="number" min={0.05} max={20} step={0.05} value={a.toleranceDeg} onChange={(e) => align.update({ toleranceDeg: num(e.target.value, 1) })} aria-label="Angular tolerance, degrees" />
                      <span className="muted">°</span>
                    </b>
                    <span className="k">Window</span>
                    <b className="v">
                      <input type="number" min={1} max={240} step={1} value={a.windowMin} onChange={(e) => align.update({ windowMin: num(e.target.value, 20) })} aria-label="Time window, minutes" />
                      <span className="muted">± min around the clock</span>
                    </b>
                  </>
                )}
                {a.mode === HeatMode.Visible && (
                  <>
                    <span className="k">Clearance</span>
                    <b className="v">
                      <input type="number" min={0} max={45} step={0.5} value={a.minAltAboveTerrainDeg} onChange={(e) => align.update({ minAltAboveTerrainDeg: num(e.target.value, 0) })} aria-label="Minimum altitude above the terrain, degrees" />
                      <span className="muted">° above the skyline</span>
                    </b>
                  </>
                )}
                <span className="k">Range</span>
                <b className="v">
                  <input type="range" min={5} max={50} step={5} value={a.rangeKm} onChange={(e) => align.update({ rangeKm: Number(e.target.value) })} aria-label="Range, kilometres" />
                  <span className="muted"> {a.rangeKm} km</span>
                </b>
                <span className="k">Cells</span>
                <b className="v">
                  <select value={a.cells} onChange={(e) => align.update({ cells: Number(e.target.value) })} aria-label="Grid cells">
                    {[32, 64, 96].map((n) => (
                      <option key={n} value={n}>
                        {n} × {n}
                      </option>
                    ))}
                  </select>
                </b>
                <span className="k">Opacity</span>
                <b className="v">
                  <input type="range" min={0.1} max={1} step={0.05} value={a.opacity} onChange={(e) => align.update({ opacity: Number(e.target.value) })} aria-label="Heat layer opacity" />
                  <span className="muted"> {Math.round(a.opacity * 100)}%</span>
                </b>
              </div>
              {needsTarget && (
                <details className="offset">
                  <summary>Offset from the target</summary>
                  <div className="kv">
                    <span className="k">Right</span>
                    <b className="v">
                      <input type="number" step={0.1} value={a.offsetAzDeg} onChange={(e) => align.update({ offsetAzDeg: num(e.target.value, 0) })} aria-label="Offset right, degrees" />
                      <span className="muted">°</span>
                    </b>
                    <span className="k">Up</span>
                    <b className="v">
                      <input type="number" step={0.1} value={a.offsetAltDeg} onChange={(e) => align.update({ offsetAltDeg: num(e.target.value, 0) })} aria-label="Offset up, degrees" />
                      <span className="muted">°</span>
                    </b>
                  </div>
                </details>
              )}
              <p className="muted hint">
                {!s.terrain
                  ? 'Elevation data is switched off in Settings.'
                  : needsTarget && !pin2
                    ? 'Place a target location to align.'
                    : a.computing
                      ? 'Computing…'
                      : a.result
                        ? `${a.result.grid.n} × ${a.result.grid.n} cells in ${(a.result.elapsedMs / 1000).toFixed(1)} s · click the map to inspect a point`
                        : 'No heat layer yet.'}
              </p>
              {a.error && <p className="error">{a.error}</p>}
              {c && (
                <div className="candidate">
                  <div className="kv">
                    <span className="k">From here</span>
                    <b className="v">
                      {distance(c.distM, s.units)} at {degrees(c.bearingDeg, 0)} {compass(c.bearingDeg)}
                    </b>
                    <span className="k">Ground</span>
                    <b className="v">
                      {Math.round(c.groundM)} m <span className="muted">· target {signed(c.landmarkAngleDeg)} up</span>
                    </b>
                    <span className="k">Separation</span>
                    <b className="v">{Number.isFinite(c.sepDeg) ? degrees(c.sepDeg) : '—'}</b>
                    <span className="k">Moment</span>
                    <b className="v">
                      {formatDateTime(c.bestMs, tz, s.hour12)} <span className="muted">· {offset}</span>
                    </b>
                  </div>
                  {c.blocked && <p className="error">The target is behind terrain from here.</p>}
                  <div className="actions">
                    <button className="on" onClick={() => align.applyCandidate()}>
                      Move camera here
                    </button>
                    <button onClick={() => align.clearCandidate()}>Clear</button>
                  </div>
                </div>
              )}
              <ul className="legend">
                {LEGEND[a.mode].map((l) => (
                  <li key={l.label}>
                    <i style={{ background: l.color }} />
                    {l.label}
                  </li>
                ))}
              </ul>
              <p className="muted hint">Terrain data is ~30 m; confirm the framing in the viewfinder.</p>
            </>
          )}
        </Disclosure>
      )}
    </div>
  );
}
