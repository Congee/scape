import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { makeObserver, siteHeightM } from '@core/astro/bodies';
import type { LngLat } from '@core/geo/geodesy';
import { glowDay, GlowKind, type GlowDay, type GlowWindow } from '@core/astro/alpenglow';
import { formatDateShort, formatTime } from '@core/time/format';
import { addLocalDays, dayBounds } from '@core/time/localDay';
import { binBearing, GLOW_KM, LOW_CONFIDENCE_DAY, pathOffset, scoreGlow, seaOfClouds, type GlowScore } from '@core/weather/alpenglow';
import { ageText } from '@core/weather/format';
import { modelInfo } from '@core/weather/models';
import { forecastWindow } from '@core/weather/openMeteo';
import { glowForecast, GlowStatus, type GlowForecast } from '@data/alpenglow';
import type { GlowEntry } from '@data/weather';
import { useSettings } from '@state/settings';
import { EYE_HEIGHT_M, horizonKeyFor, useTerrain } from '@state/terrain';
import { useWeather } from '@state/weather';
import { useWorld, worldStore } from '@state/world';
import type { HorizonResult } from '@workers/terrain.protocol';
import { Credit } from './CloudChart';

const DAYS = 7;
const NAME: Record<GlowKind, string> = { Sunrise: 'Sunrise', Sunset: 'Sunset' };
const angleGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

interface Row {
  day: number;
  kind: GlowKind;
  dayStartMs: number;
  w: GlowWindow | null;
}

function rowsOf(days: GlowDay[], now: number): Row[] {
  return days.flatMap((d, day) =>
    [GlowKind.Sunrise, GlowKind.Sunset].flatMap((kind) => {
      const w = kind === GlowKind.Sunrise ? d.sunrise : d.sunset;
      return (w ? w.endMs : d.endMs) > now ? [{ day, kind, dayStartMs: d.startMs, w }] : [];
    })
  );
}

function scoreRow(e: GlowEntry, groundM: number, eyeM: number, w: GlowWindow): GlowScore & { sea: boolean } {
  const b = binBearing(w.azimuthDeg);
  let i = 0;
  e.bearings.forEach((c, j) => angleGap(b, c) < angleGap(b, e.bearings[i]) && (i = j));
  const at = pathOffset(i);
  const x = { groundM, eyeM, sunAltDeg: w.altitudeDeg, ms: w.midMs, point: e.series[0], path: e.series.slice(at, at + GLOW_KM.length) };
  return { ...scoreGlow(x), sea: seaOfClouds(x) };
}

interface Loaded {
  rows: Row[];
  fc: GlowForecast | null;
  now: number;
}

/** Weather-tab section for the camera pin; the forecast is fetched only once it is opened. */
export function AlpenglowSection() {
  const [open, setOpen] = useState(false);
  return (
    <details className="wx-card wx-glow" data-card="alpenglow" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary data-glow-toggle>
        <h3>Alpenglow</h3>
      </summary>
      {open && <PinAlpenglow />}
    </details>
  );
}

function PinAlpenglow() {
  const pin = useWorld((s) => s.pin);
  const pinHeightM = useWorld((s) => s.pinHeightM);
  const horizon = useTerrain((s) => s.horizon);
  const horizonKey = useTerrain((s) => s.horizonKey);
  const terrain = useSettings((s) => s.terrain);
  const terrainHorizon = useSettings((s) => s.terrainHorizon);
  const horizonRangeKm = useSettings((s) => s.horizonRangeKm);
  const hk = horizonKeyFor({ pin, pinHeightM, pin2: null, pin2HeightM: 0 }, { terrain, terrainHorizon, horizonRangeKm });
  if (!hk)
    return (
      <p className="wx-missing" data-glow="noterrain">
        Needs the skyline: switch on elevation data and the terrain horizon in <Link to="/settings">Settings</Link>.
      </p>
    );
  return <AlpenglowForecast point={pin} horizon={horizon && horizonKey === hk ? horizon : null} aboveGroundM={pinHeightM + EYE_HEIGHT_M} />;
}

/** Up to a week of sunrise and sunset glow at a point, against its skyline. */
function AlpenglowForecast({ point, horizon, aboveGroundM }: { point: LngLat; horizon: HorizonResult | null; aboveGroundM: number }) {
  const tz = useWorld((s) => s.tz);
  const hour12 = useSettings((s) => s.hour12);
  const lowDeg = useSettings((s) => s.goldenAltitude);
  const on = useSettings((s) => s.weather);
  const model = useWeather((s) => s.model);
  const [nonce, setNonce] = useState(0);
  const [got, setGot] = useState<{ key: string; asked: string; v: Loaded } | null>(null);
  const key = JSON.stringify([point, aboveGroundM, tz, lowDeg, model]);
  const asked = `${key}#${nonce}`;

  useEffect(() => {
    if (!horizon || !on) return;
    let live = true;
    const now = Date.now();
    const obs = makeObserver(point, siteHeightM(horizon.groundM, aboveGroundM));
    const days = Array.from({ length: DAYS }, (_, i) => {
      const b = dayBounds(addLocalDays(new Date(now), i, tz), tz);
      return glowDay(obs, horizon.profile, b.start.getTime(), b.end.getTime(), lowDeg);
    });
    const rows = rowsOf(days, now);
    const wins = rows.flatMap((r) => (r.w ? [r.w] : []));
    const range = wins.length ? forecastWindow(Math.min(...wins.map((w) => w.startMs)), Math.max(...wins.map((w) => w.endMs)), now) : null;
    const done = (fc: GlowForecast | null) => live && setGot({ key, asked, v: { rows, fc, now: Date.now() } });
    if (!range) done(null);
    else void glowForecast(point, model, [...new Set(wins.map((w) => binBearing(w.azimuthDeg)))].toSorted((a, b) => a - b), range).then(done);
    return () => {
      live = false;
    };
  }, [point, aboveGroundM, horizon, tz, lowDeg, on, model, key, asked]);

  // A refined skyline or a retry keeps the old rows up until the new ones land.
  const v = got?.key === key ? got.v : null;
  if (!horizon || !v)
    return (
      <p className="muted" data-glow="loading">
        Loading alpenglow forecast…
      </p>
    );

  const { fc, now } = v;
  const e = fc?.entry ?? null;
  const groundM = horizon.groundM;
  const at = (ms: number) => formatTime(ms, tz, hour12);
  return (
    <div className="glow" data-glow={fc?.status ?? 'NoWindow'}>
      {fc && fc.status !== GlowStatus.Ok && (
        <p className={fc.note === 'offline' ? 'wx-missing' : 'error'} data-glow-note>
          {fc.note === 'offline' ? 'Offline' : `Alpenglow forecast failed: ${fc.note}`}
          {e ? ` · showing the copy fetched ${ageText(now - e.fetchedAt)} ago` : ' · no alpenglow forecast downloaded for this point'}
          <button className="link" onClick={() => setNonce((n) => n + 1)}>
            Retry
          </button>
        </p>
      )}
      {e && (
        <p className="muted wx-model" data-glow-age>
          {modelInfo(model).label} · fetched {ageText(now - e.fetchedAt)} ago
        </p>
      )}
      <ul className="glow-list">
        {v.rows.map((r) => {
          const s = r.w && e ? scoreRow(e, groundM, aboveGroundM, r.w) : null;
          return (
            <li key={`${r.day}${r.kind}`} data-glow-event={r.kind.toLowerCase()} data-day={r.day} data-score={s?.score ?? ''} className={r.day >= LOW_CONFIDENCE_DAY ? 'shaky' : undefined}>
              <span className="glow-when">
                {formatDateShort(r.dayStartMs + 43_200_000, tz)}{' '}
                {r.w ? (
                  <button className="link" onClick={() => worldStore.getState().setTime(r.w!.startMs)}>
                    {NAME[r.kind]} {at(r.w.startMs)}–{at(r.w.endMs)}
                  </button>
                ) : (
                  <span className="muted">{NAME[r.kind]}</span>
                )}
              </span>
              <b className="glow-score">{s?.score ?? '—'}</b>
              <span className="glow-why muted">
                {s?.sea && (
                  <span className="glow-sea" data-glow-sea title="Low cloud below the summit, left out of the score">
                    sea of clouds
                  </span>
                )}
                {r.w ? (s?.reason ?? (e ? '' : 'no forecast')) : 'no direct sun while the Sun is low'}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="muted hint">
        Score 0–100 for direct sun on the point while the Sun is under {lowDeg}°, with low and mid cloud toward the Sun at 25–300 km and cloud or fog at the point. Confidence falls after 2–3 days (greyed).
      </p>
      <Credit />
    </div>
  );
}
