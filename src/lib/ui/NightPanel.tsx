import { useEffect, useState, type ReactNode } from 'react';
import { makeObserver, siteHeightM, SkyBody } from '@core/astro/bodies';
import { dayEvents, EventKind, type DayEvent } from '@core/astro/dayEvents';
import { activeShowers, radiantHorizontal, upcomingPeaks, type ShowerStatus } from '@core/astro/meteors';
import { milkyWayStatus, MoonRule } from '@core/astro/milkyWay';
import { moonFreeWindow, nextMoonEvent, nightWindow, NightKind, panelNight, type PanelNight } from '@core/astro/night';
import { polarisAid } from '@core/astro/polaris';
import { moonInfo, position } from '@core/astro/positions';
import { apply, enuToEqj } from '@core/astro/skyFrame';
import { compass, degrees, percent } from '@core/format';
import { effectiveOptics } from '@core/optics/fov';
import { dirFromAzAlt } from '@core/optics/projection';
import { npfShutterS, pixelPitchUm, trailAngleDeg, trailLengthPx } from '@core/optics/startrails';
import { formatDateShort, formatTime } from '@core/time/format';
import { aimFor, compositionStore, useComposition } from '@state/composition';
import { useDayData } from '@state/dayData';
import { sensorById, useGear } from '@state/gear';
import { settingsStore, useSettings } from '@state/settings';
import { EYE_HEIGHT_M, horizonKeyFor, pinSiteHeightM, targetAngleFor, useTerrain } from '@state/terrain';
import { usePlanTime, useWorld, worldStore } from '@state/world';
import { NATURAL_SKY_MAG } from '@core/sky/brightness';
import { darkHoursUrl } from '@core/sky/darkhours';
import { domeText, glowTowardText, MOON_DARK_DMAG, moonCurve, SKY_TOOLTIP, skyReadout, type MoonSample } from '@core/sky/readout';
import { glowToward, SKYGLOW_PARAMS, skyglowFrom } from '@core/sky/skyglow';
import { horizonAngleAt, type HorizonProfile } from '@core/terrain/horizon';
import { GlowStatus, skyglowStore, useSkyglow, type GlowPoint } from '@state/skyglow';
import type { LngLat } from '@core/geo/geodesy';
import { ScrubCursor, useTimeScrub } from './chart/useTimeScrub';

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

// The panel re-renders on every clock tick; the searches only depend on the night, not the instant. Two slots: a morning looks at two nights.
const nightCache = new Map<string, DayEvent[]>();
function tonightFor(time: number, tz: string, pin: LngLat, groundM: number | null, eyeM: number, goldenAltitude: number): PanelNight {
  const g = groundM === null || Number.isNaN(groundM) ? null : Math.round(groundM);
  return panelNight(new Date(time), tz, (startMs, endMs) => {
    const key = [startMs, pin.lat.toFixed(4), pin.lng.toFixed(4), g, eyeM, goldenAltitude].join('|');
    let events = nightCache.get(key);
    if (!events) {
      events = dayEvents(makeObserver(pin, siteHeightM(g, eyeM)), startMs, endMs, { goldenAltitude, heightAboveGroundM: eyeM });
      if (nightCache.size >= 2) nightCache.delete(nightCache.keys().next().value!);
      nightCache.set(key, events);
    }
    return events;
  });
}

// Which groups are open survives tab switches but not a reload.
const openGroups = new Set<string>();

function Group({ id, summary, summaryClass, children }: { id: string; summary: ReactNode; summaryClass?: string; children: ReactNode }) {
  return (
    <details
      open={openGroups.has(id)}
      onToggle={(e) => {
        if (e.currentTarget.open) openGroups.add(id);
        else openGroups.delete(id);
      }}
    >
      <summary className={summaryClass}>{summary}</summary>
      {children}
    </details>
  );
}

/** Declination of the sky the camera points at; star trails run fastest at 0°. */
function aimDeclination(time: number, obs: ReturnType<typeof makeObserver>, azDeg: number, altDeg: number): number {
  const d = dirFromAzAlt(azDeg, altDeg);
  const out = new Float64Array(3);
  apply(enuToEqj(new Date(time), obs), d.x, d.y, d.z, out);
  return Math.asin(Math.max(-1, Math.min(1, out[2]))) * R2D;
}

const MOON_STEP_MS = 30 * 60_000;

// K&S sampling costs ~25 moon positions; the panel re-renders every clock tick.
let moonCache: { key: string; curve: MoonSample[] } | null = null;
function moonCurveFor(obs: ReturnType<typeof makeObserver>, zenithMag: number, azDeg: number, altDeg: number, startMs: number, endMs: number): MoonSample[] {
  const key = [obs.latitude, obs.longitude, zenithMag.toFixed(2), azDeg.toFixed(0), altDeg.toFixed(0), startMs, endMs].join('|');
  if (!moonCache || moonCache.key !== key) {
    const curve = moonCurve(zenithMag, azDeg, altDeg, startMs, endMs, MOON_STEP_MS, (t) => {
      const d = new Date(t);
      const m = position(SkyBody.Moon, d, obs);
      return { altDeg: m.altitude, azDeg: m.azimuth, illumination: moonInfo(d).illumination };
    });
    moonCache = { key, curve };
  }
  return moonCache.curve;
}

function MoonChart({ curve, time, tz, hour12 }: { curve: MoonSample[]; time: number; tz: string; hour12: boolean }) {
  const t0 = curve[0].t;
  const t1 = curve.at(-1)!.t;
  const lo = Math.min(-1, ...curve.map((c) => c.deltaMag));
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * 300;
  const y = (d: number) => 4 + (d / lo) * 48;
  const pts = curve.map((c) => `${x(c.t).toFixed(1)},${y(c.deltaMag).toFixed(1)}`).join(' ');
  const scrub = useTimeScrub({ startMs: t0, endMs: t1, w: 300 });
  return (
    <figure className="moon-chart">
      <svg viewBox="0 0 300 56" preserveAspectRatio="none" role="img" aria-label="Moonlight brightening toward the aim through the night. Drag to set the time; arrow keys step an hour, Shift ten minutes." {...scrub}>
        <line x1={0} x2={300} y1={y(0)} y2={y(0)} className="axis" />
        <polyline points={pts} className="curve" vectorEffect="non-scaling-stroke" />
        <ScrubCursor time={time} startMs={t0} endMs={t1} w={300} h={56} />
      </svg>
      <figcaption className="muted">
        <span>{formatTime(t0, tz, hour12)}</span>
        <span>0 to {lo.toFixed(1)} mag</span>
        <span>{formatTime(t1, tz, hour12)}</span>
      </figcaption>
    </figure>
  );
}

function PointSky({ label, p, g, heightM, skyline, time, tz }: { label: string; p: LngLat; g: GlowPoint; heightM: number; skyline?: (az: number) => number; time: number; tz: string }) {
  const link = (
    <a className="darkhours" href={darkHoursUrl(p, new Date(time), tz)} target="_blank" rel="noopener noreferrer" title="DarkHours: nightly dark-sky forecast for this spot">
      More on DarkHours ↗
    </a>
  );
  if (g.status === GlowStatus.NoData)
    return (
      <>
        <span className="k">{label}</span>
        <b className="v sky-missing" data-sky={label}>
          no sky data here
          {g.missing.length > 0 && <span className="muted"> · {g.missing.join(', ')}</span>} · {link}
        </b>
      </>
    );
  if (g.status === GlowStatus.Loading)
    return (
      <>
        <span className="k">{label}</span>
        <b className="v sky-loading muted" data-sky={label}>
          loading VIIRS nightly…
        </b>
      </>
    );
  if (g.status === GlowStatus.Error)
    return (
      <>
        <span className="k">{label}</span>
        <b className="v sky-error" data-sky={label}>
          Sky model failed: {g.error}
        </b>
      </>
    );
  if (g.status !== GlowStatus.Ready || !g.bins || !g.source) return null;
  const sky = skyglowFrom(g.bins, heightM, SKYGLOW_PARAMS, skyline);
  return (
    <>
      <span className="k">{label}</span>
      <b className="v sky-readout" data-sky={label} title={SKY_TOOLTIP}>
        {skyReadout(sky, g.source)} · {link}
        {sky.domes.length > 0 && <span className="muted domes"> · {sky.domes.map(domeText).join('; ')}</span>}
        {g.missing.length > 0 && <span className="muted"> · without {g.missing.join(', ')}, reads too dark</span>}
      </b>
    </>
  );
}

function SkyGroup({ obs, skyline, aim, night, time, tz, hour12, heights }: { obs: ReturnType<typeof makeObserver>; skyline?: HorizonProfile; aim: { azimuthDeg: number; elevationDeg: number }; night: { startMs: number; endMs: number }; time: number; tz: string; hour12: boolean; heights: { camera: number; target: number } }) {
  const camera = useSkyglow((s) => s.camera);
  const target = useSkyglow((s) => s.target);
  const pin = useWorld((s) => s.pin);
  const pin2 = useWorld((s) => s.pin2);
  useEffect(() => skyglowStore.getState().want(), []);
  const sl = skyline ? (az: number) => horizonAngleAt(skyline, az) : undefined;
  const camSky = camera.status === GlowStatus.Ready && camera.bins ? skyglowFrom(camera.bins, heights.camera, SKYGLOW_PARAMS, sl) : null;
  const toward = camSky && pin2 ? glowToward(camSky, aim.azimuthDeg, aim.elevationDeg, sl) : null;
  const zenithMag = camSky?.mag ?? NATURAL_SKY_MAG;
  const curve = night.endMs > night.startMs ? moonCurveFor(obs, zenithMag, aim.azimuthDeg, aim.elevationDeg, night.startMs, night.endMs) : [];
  const worst = curve.reduce((m, c) => Math.min(m, c.deltaMag), 0);
  const now = curve.length ? curve.reduce((a, c) => (Math.abs(c.t - time) < Math.abs(a.t - time) ? c : a)) : null;
  const summary =
    camera.status === GlowStatus.Ready && camSky
      ? `Sky ≈ ${camSky.mag.toFixed(1)} mag/arcsec² · Bortle ≈ ${camSky.bortle.label}`
      : camera.status === GlowStatus.NoData
        ? 'Sky brightness · no data here'
        : camera.status === GlowStatus.Error
          ? 'Sky brightness · model failed'
          : camera.status === GlowStatus.Loading
            ? 'Sky brightness · loading…'
            : 'Sky brightness';
  return (
    <Group id="sky" summary={summary}>
      <div className="kv">
        <PointSky label="Camera" p={pin} g={camera} heightM={heights.camera} skyline={sl} time={time} tz={tz} />
        {pin2 && <PointSky label="Target" p={pin2} g={target} heightM={heights.target} time={time} tz={tz} />}
        {toward && (
          <>
            <span className="k">Toward aim</span>
            <b className="v sky-toward">{glowTowardText(toward, aim.azimuthDeg)}</b>
          </>
        )}
        <span className="k">Moonlight</span>
        <b className="v sky-moon" data-worst={worst.toFixed(2)}>
          {curve.length === 0
            ? 'no dark hours tonight'
            : worst > MOON_DARK_DMAG
              ? 'adds nothing toward the aim tonight'
              : `up to ${worst.toFixed(1)} mag toward the aim${now && now.deltaMag < MOON_DARK_DMAG ? ` · now ${now.deltaMag.toFixed(1)}` : ''}`}
          <span className="muted"> · Krisciunas &amp; Schaefer 1991</span>
        </b>
      </div>
      {curve.length > 1 && worst <= MOON_DARK_DMAG && <MoonChart curve={curve} time={time} tz={tz} hour12={hour12} />}
      <p className="muted hint">{SKY_TOOLTIP} Zenith from NASA GIBS VIIRS nightly radiance (median of 8 nights), or an imported VIIRS Black Marble (VNP46A4) year where present, through a Walker-law kernel calibrated to 23 SQM sites; domes follow DarkHours (MIT).</p>
    </Group>
  );
}

export function NightPanel() {
  const time = usePlanTime();
  const tz = useWorld((s) => s.tz);
  const pin = useWorld((s) => s.pin);
  const pin2 = useWorld((s) => s.pin2);
  const pinHeightM = useWorld((s) => s.pinHeightM);
  const pin2HeightM = useWorld((s) => s.pin2HeightM);
  const s = useSettings();
  const windows = useDayData((d) => d.milkyWay);
  const c = useComposition();
  const cameras = useGear((g) => g.cameras);
  const profile = useTerrain((t) => t.profile);
  const profileKey = useTerrain((t) => t.profileKey);
  const horizon = useTerrain((t) => t.horizon);
  const horizonKey = useTerrain((t) => t.horizonKey);
  const pinGroundM = useTerrain((t) => t.pinGroundM);
  const pin2GroundM = useTerrain((t) => t.pin2GroundM);
  const [pxText, setPxText] = useState('');

  const obs = makeObserver(pin, pinSiteHeightM({ pinHeightM }, { pinGroundM }));
  const opts = { sunMaxAltDeg: s.mwSunMaxAlt, gcMinAltDeg: s.mwGcMinAlt, moonRule: s.mwMoonRule, moonMaxIllumination: s.mwMoonMaxIllum };
  const hk = horizonKeyFor(worldStore.getState(), settingsStore.getState());
  const skyline = hk && horizon && horizonKey === hk ? horizon.profile : undefined;
  const mw = milkyWayStatus(obs, time, opts, skyline);
  const sensor = sensorById(c.sensorId, cameras);
  const pixels = sensor.pixelsWide ?? (Number(pxText) > 0 ? Number(pxText) : null);
  const pitch = pixels ? pixelPitchUm(sensor.widthMm, pixels) : null;
  const targetAngleDeg = targetAngleFor(worldStore.getState(), settingsStore.getState(), { profile, profileKey, pinGroundM, pin2GroundM });
  const aim = aimFor(c, { pin, pin2 }, targetAngleDeg);
  const dec = aimDeclination(time, obs, aim.azimuthDeg, aim.elevationDeg);
  const opt = effectiveOptics(c);
  const npf = pitch ? npfShutterS(opt.fNumber, opt.focalMm, pitch, dec) : null;
  const trailS = c.trailMinutes * 60;
  const { active, upcoming } = showersFor(time);
  const polaris = polarisAid(new Date(time), obs);
  const update = settingsStore.getState().update;
  const setTime = worldStore.getState().setTime;
  const comp = compositionStore.getState().update;

  const tonight = tonightFor(time, tz, pin, pinGroundM, pinHeightM + EYE_HEIGHT_M, s.goldenAltitude);
  const night = nightWindow(tonight.events, time);
  const hasNight = night.endMs > night.startMs;
  const at = (body: SkyBody, kind: EventKind) => {
    const ev = tonight.events.find((e) => e.body === body && e.kind === kind);
    return ev ? formatTime(ev.time, tz, s.hour12) : '—';
  };
  const nightSummary =
    night.kind === NightKind.None
      ? 'No darkness tonight'
      : night.kind === NightKind.AllDark
        ? 'Dark all day'
        : `${night.kind === NightKind.Nautical ? 'Nautical night' : 'Night'} ${formatTime(night.startMs, tz, s.hour12)} – ${formatTime(night.endMs, tz, s.hour12)} · ${duration(night.endMs - night.startMs)}`;

  const moon = moonInfo(new Date(time));
  const nextMoon = nextMoonEvent(tonight.events, time);
  const moonUpAtNightfall = hasNight && position(SkyBody.Moon, new Date(night.startMs), obs).altitude > 0;
  const moonFree = moonFreeWindow(night, tonight.events, moonUpAtNightfall);
  const moonSummary = `${moon.name} ${percent(moon.illumination, 0)}${nextMoon ? ` · ${nextMoon.kind === EventKind.Rise ? 'rises' : 'sets'} ${formatTime(nextMoon.time, tz, s.hour12)}` : ''}`;

  const starsSummary = `${npf ? `NPF ${npf.toFixed(1)} s at ${opt.focalMm} mm` : 'NPF needs the camera or pixel count'}${polaris.northern ? ` · Polaris ${signed(polaris.polarisAltDeg)}` : ''}`;
  const meteorSummary = active[0]
    ? `${active[0].shower.name} active · peak ${formatDateShort(active[0].peakMs, tz)}`
    : upcoming[0]
      ? `No shower active · next ${upcoming[0].shower.name} ${formatDateShort(upcoming[0].peakMs, tz)}`
      : 'No shower active';

  const reasons = [!mw.dark && `sun at ${signed(mw.sunAltDeg)}`, !mw.coreUp && `core needs ${signed(mw.floorDeg)}`, !mw.moonOk && `moon up, ${percent(mw.moonIllumination, 0)} lit`].filter(Boolean);

  return (
    <div className="frame night">
      <Group id="sun" summary={nightSummary}>
        <div className="kv">
          <span className="k">Civil dusk</span>
          <b className="v">{at(SkyBody.Sun, EventKind.CivilDusk)}</b>
          <span className="k">Nautical dusk</span>
          <b className="v">{at(SkyBody.Sun, EventKind.NauticalDusk)}</b>
          <span className="k">Astronomical dusk</span>
          <b className="v">{at(SkyBody.Sun, EventKind.AstroDusk)}</b>
          <span className="k">Astronomical dawn</span>
          <b className="v">{at(SkyBody.Sun, EventKind.AstroDawn)}</b>
          <span className="k">Nautical dawn</span>
          <b className="v">{at(SkyBody.Sun, EventKind.NauticalDawn)}</b>
          <span className="k">Civil dawn</span>
          <b className="v">{at(SkyBody.Sun, EventKind.CivilDawn)}</b>
        </div>
      </Group>

      <Group id="moon" summary={moonSummary}>
        <div className="kv">
          <span className="k">Moonrise</span>
          <b className="v">{at(SkyBody.Moon, EventKind.Rise)}</b>
          <span className="k">Transit</span>
          <b className="v">{at(SkyBody.Moon, EventKind.Transit)}</b>
          <span className="k">Moonset</span>
          <b className="v">{at(SkyBody.Moon, EventKind.Set)}</b>
          <span className="k">Illumination</span>
          <b className="v">
            {percent(moon.illumination, 0)} <span className="muted">· {moon.name}</span>
          </b>
          <span className="k">Moon-free dark</span>
          <b className="v">
            {moonFree ? (
              <>
                {formatTime(moonFree.startMs, tz, s.hour12)} – {formatTime(moonFree.endMs, tz, s.hour12)} <span className="muted">· {duration(moonFree.endMs - moonFree.startMs)}</span>
              </>
            ) : hasNight ? (
              'none — moon up all night'
            ) : (
              '—'
            )}
          </b>
        </div>
      </Group>

      <SkyGroup
        obs={obs}
        skyline={skyline}
        aim={aim}
        night={night.kind === NightKind.AllDark ? tonight : night}
        time={time}
        tz={tz}
        hour12={s.hour12}
        heights={{ camera: pinSiteHeightM({ pinHeightM }, { pinGroundM }), target: siteHeightM(pin2GroundM, pin2HeightM + EYE_HEIGHT_M) }}
      />

      <Group
        id="milkyway"
        summaryClass={`verdict${mw.visible ? '' : ' off'}`}
        summary={
          <>
            {mw.visible ? 'Core visible now' : 'Core not visible now'} · {signed(mw.altitudeDeg)} at {degrees(mw.azimuthDeg, 0)} {compass(mw.azimuthDeg)}
            {reasons.length > 0 && <span className="why"> · {reasons.join(', ')}</span>}
          </>
        }
      >
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
      </Group>

      <Group id="stars" summary={starsSummary}>
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
          <span className="k">NPF rule</span>
          <b className="v">{npf ? `${npf.toFixed(1)} s` : 'needs the pixel count'} <span className="muted">· f/{opt.fNumber}, {opt.focalMm} mm, declination {signed(dec, 0)}</span></b>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={c.showTrails} onChange={(e) => comp({ showTrails: e.target.checked })} />
          <span>Star trails in the viewfinder over</span>
          <input type="number" min={1} max={720} step={5} value={c.trailMinutes} onChange={(e) => comp({ trailMinutes: Math.min(720, Math.max(1, Number(e.target.value) || 1)) })} aria-label="Trail duration, minutes" style={{ width: 64 }} />
          <span>min</span>
        </label>
        <p className="muted hint">
          In {c.trailMinutes} min a star at that declination moves {trailAngleDeg(trailS, dec).toFixed(2)}°{pitch ? `, about ${Math.round(trailLengthPx(trailS, opt.focalMm, pitch, dec))} px on this sensor` : ''}.
        </p>

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
      </Group>

      <Group id="meteors" summary={meteorSummary}>
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
      </Group>

      <p className="muted hint">Stars, constellation figures, the Milky Way, trails and meteor radiants are drawn in the viewfinder; its layer chips switch them on and off.</p>
    </div>
  );
}
