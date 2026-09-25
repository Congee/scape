import { useEffect, useState, type ReactNode } from 'react';
import type { LngLat } from '@core/geo/geodesy';
import { formatTime } from '@core/time/format';
import { fogReasons } from '@core/weather/fog';
import { ageText, pct } from '@core/weather/format';
import { modelInfo } from '@core/weather/models';
import { ATTRIBUTION, ATTRIBUTION_URL, hourValue, HourlyVar, POINT_VARS, roundCoord, valueAt, type PointSeries } from '@core/weather/openMeteo';
import { windyUrl } from '@core/weather/windy';
import { forecastPoints, ForecastStatus, type ForecastResult } from '@data/weather';
import { useDayData } from '@state/dayData';
import { useSettings } from '@state/settings';
import { PanelTab, uiStore } from '@state/ui';
import { useWeather } from '@state/weather';
import { useWorld, worldStore } from '@state/world';

const HOUR_MS = 3_600_000;

/** Forecasts for `points` over [startMs, endMs) under the picked model; asks once per change, never polls. */
export function useForecast(points: readonly (LngLat | null)[], startMs: number, endMs: number, vars: readonly HourlyVar[] = POINT_VARS) {
  const model = useWeather((s) => s.model);
  const [nonce, setNonce] = useState(0);
  const pts = points.map((p) => (p ? [roundCoord(p.lat), roundCoord(p.lng)] : null));
  const spec = JSON.stringify({ model, startMs, endMs, pts, vars, nonce });
  const [got, setGot] = useState<{ spec: string; results: (ForecastResult | null)[]; now: number } | null>(null);
  useEffect(() => {
    const s = JSON.parse(spec) as { model: string; startMs: number; endMs: number; pts: ([number, number] | null)[]; vars: HourlyVar[] };
    if (s.endMs <= s.startMs) return;
    let live = true;
    const ask = s.pts.flatMap((p) => (p ? [{ lat: p[0], lng: p[1] }] : []));
    void forecastPoints(ask, s.model, s.vars, s.startMs, s.endMs).then((r) => {
      let j = 0;
      if (live) setGot({ spec, results: s.pts.map((p) => (p ? r[j++] : null)), now: Date.now() });
    });
    return () => {
      live = false;
    };
  }, [spec]);
  const fresh = got?.spec === spec;
  // Ages are as of the last answer; no timer ticks them.
  return { model, loading: !fresh, results: fresh ? got.results : null, now: got?.now ?? 0, retry: () => setNonce((n) => n + 1) };
}

/** True when no variable has a value at `ms`: past the model's horizon or before its archive. */
export const noDataAt = (s: PointSeries, ms: number) => POINT_VARS.every((v) => Number.isNaN(valueAt(s, v, ms)));

export function fogAt(s: PointSeries, ms: number) {
  return fogReasons({
    code: hourValue(s, HourlyVar.Code, ms),
    visibilityM: valueAt(s, HourlyVar.Visibility, ms),
    tempC: valueAt(s, HourlyVar.Temp, ms),
    dewC: valueAt(s, HourlyVar.Dew, ms),
    lowCloud: valueAt(s, HourlyVar.CloudLow, ms)
  });
}

/** Why a result carries no usable forecast, or '' when it does. */
export function missingText(r: ForecastResult | null): string {
  if (!r) return 'no forecast';
  if (r.status === ForecastStatus.OutOfRange) return 'No forecast for this date';
  if (!r.series) return r.note === 'offline' ? 'Offline · no forecast cached' : `No forecast · ${r.note}`;
  return '';
}

/** "fetched 12 min ago", plus why a cached copy was kept. */
export const fetchedText = (r: ForecastResult, now: number) => `fetched ${ageText(now - r.fetchedAt)} ago${r.status === ForecastStatus.Cached ? ` · cached${r.note ? `, ${r.note}` : ''}` : ''}`;

export function WindyLink({ lat, lng, zoom }: { lat: number; lng: number; zoom?: number }) {
  return (
    <a className="wx-windy" href={windyUrl(lat, lng, zoom)} target="_blank" rel="noopener noreferrer">
      More on Windy ↗
    </a>
  );
}

export function Credit({ children }: { children?: ReactNode }) {
  return (
    <p className="wx-credit">
      <a href={ATTRIBUTION_URL} target="_blank" rel="noreferrer">
        {ATTRIBUTION}
      </a>{' '}
      (CC BY 4.0){children}
    </p>
  );
}

const W = 300;
const BANDS = [HourlyVar.CloudHigh, HourlyVar.CloudMid, HourlyVar.CloudLow] as const;

/** The day's cloud per hour: high, mid and low stacked top to bottom, fog flagged under them, gaps hatched. */
export function CloudChart({ series, startMs, endMs, time, h = 40 }: { series: PointSeries; startMs: number; endMs: number; time: number; h?: number }) {
  const hours = Math.round((endMs - startMs) / HOUR_MS);
  const cw = W / hours;
  const bh = (h - 6) / 3;
  const x = (ms: number) => ((ms - startMs) / (endMs - startMs)) * W;
  const cols = Array.from({ length: hours }, (_, i) => {
    const t = startMs + (i + 0.5) * HOUR_MS;
    return { i, t, gap: noDataAt(series, t), fog: fogAt(series, t).length > 0, bands: BANDS.map((v) => valueAt(series, v, t)) };
  });
  return (
    <svg className="cloud-chart" viewBox={`0 0 ${W} ${h}`} role="img" aria-label="Forecast cloud per hour: high, mid and low; fog marked below">
      <defs>
        <pattern id="wx-gap" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="4" />
        </pattern>
      </defs>
      {cols.map((c) => (
        <g key={c.t} data-gap={c.gap || undefined} onClick={() => worldStore.getState().setTime(c.t - HOUR_MS / 2)}>
          {c.bands.map((v, b) =>
            Number.isNaN(v) ? (
              <rect key={BANDS[b]} className="gap" x={c.i * cw} y={b * bh} width={cw} height={bh} />
            ) : (
              <g key={BANDS[b]}>
                <rect className="sky" x={c.i * cw} y={b * bh} width={cw} height={bh} />
                <rect className="cloud" x={c.i * cw} y={b * bh} width={cw} height={bh} opacity={v / 100} />
              </g>
            )
          )}
          {c.fog && <rect className="fog" x={c.i * cw} y={h - 4} width={cw} height={4} />}
        </g>
      ))}
      {time >= startMs && time < endMs && <line className="now" x1={x(time)} x2={x(time)} y1={0} y2={h} />}
    </svg>
  );
}

/** Timeline row: the camera's cloud for the day under the picked model. */
export function CloudRow() {
  const pin = useWorld((s) => s.pin);
  const time = useWorld((s) => s.time);
  const tz = useWorld((s) => s.tz);
  const hour12 = useSettings((s) => s.hour12);
  const dayStart = useDayData((s) => s.dayStart);
  const dayEnd = useDayData((s) => s.dayEnd);
  const { model, loading, results, now } = useForecast([pin], dayStart, dayEnd);
  if (dayEnd <= dayStart) return null;
  const r = results?.[0] ?? null;
  const s = r?.series ?? null;
  const missing = loading ? '' : missingText(r);
  const empty = s ? noDataAt(s, time) : true;
  let fogFrom = -1;
  let fogTo = -1;
  if (s)
    for (let t = dayStart; t < dayEnd; t += HOUR_MS)
      if (fogAt(s, t + HOUR_MS / 2).length) {
        if (fogFrom < 0) fogFrom = t;
        fogTo = t + HOUR_MS;
      }
  return (
    <div className="cloud-row">
      <button onClick={() => uiStore.getState().setPanelTab(PanelTab.Weather)} title="Open the Weather tab">
        <span className="dot cloud" aria-hidden="true" />
        <span className="label">Cloud forecast</span>
        <span className="az">{s && !empty ? pct(valueAt(s, HourlyVar.Cloud, time)) : ''}</span>
        <span className="extra">
          {loading
            ? 'loading…'
            : missing ||
              [
                empty ? 'no forecast for this hour' : `low ${pct(valueAt(s!, HourlyVar.CloudLow, time))} · mid ${pct(valueAt(s!, HourlyVar.CloudMid, time))} · high ${pct(valueAt(s!, HourlyVar.CloudHigh, time))}`,
                fogFrom >= 0 ? `fog signs ${formatTime(fogFrom, tz, hour12)}–${formatTime(fogTo, tz, hour12)}` : '',
                modelInfo(model).label
              ]
                .filter(Boolean)
                .join(' · ')}
        </span>
      </button>
      {s && r?.status !== ForecastStatus.OutOfRange && <CloudChart series={s} startMs={dayStart} endMs={dayEnd} time={time} h={34} />}
      {s && <Credit>{` · ${fetchedText(r!, now)}`}</Credit>}
    </div>
  );
}
