import { useEffect, useState } from 'react';
import type { LngLat } from '@core/geo/geodesy';
import { formatDateTime, formatTime } from '@core/time/format';
import { FOG_TEXT } from '@core/weather/fog';
import { ageText, pct, rainText, tempText, visText, windText } from '@core/weather/format';
import { MODELS, modelInfo, type WeatherModel } from '@core/weather/models';
import { hourValue, HourlyVar, lacks, valueAt, type PointSeries } from '@core/weather/openMeteo';
import { ForecastStatus, modelRun, type ForecastResult } from '@data/weather';
import { useDayData } from '@state/dayData';
import { useSettings } from '@state/settings';
import { useWeather, weatherStore } from '@state/weather';
import { useWorld } from '@state/world';
import { Sightlines } from './Sightlines';
import { Credit, fetchedText, WindyLink, fogAt, missingText, noDataAt, useForecast } from './CloudChart';

/** Latest run start of a single-domain model; blends report none. */
function useModelRun(model: WeatherModel): { ms: number | null; now: number } | undefined {
  const metaId = modelInfo(model).metaId;
  const [run, setRun] = useState<{ id: string; ms: number | null; now: number } | null>(null);
  useEffect(() => {
    if (!metaId) return;
    let live = true;
    void modelRun(metaId).then((ms) => live && setRun({ id: metaId, ms, now: Date.now() }));
    return () => {
      live = false;
    };
  }, [metaId]);
  if (!metaId) return undefined;
  return run?.id === metaId ? run : { ms: null, now: 0 };
}

export function WeatherPanel() {
  const pin = useWorld((s) => s.pin);
  const pin2 = useWorld((s) => s.pin2);
  const time = useWorld((s) => s.time);
  const tz = useWorld((s) => s.tz);
  const hour12 = useSettings((s) => s.hour12);
  const dayStart = useDayData((s) => s.dayStart);
  const dayEnd = useDayData((s) => s.dayEnd);
  const model = useWeather((s) => s.model);
  const info = modelInfo(model);
  const run = useModelRun(model);
  const { loading, results, retry, now } = useForecast([pin, pin2], dayStart, dayEnd);

  return (
    <div className="weather">
      <label className="toggle">
        <span>Model</span>
        <select value={model} onChange={(e) => weatherStore.getState().setModel(e.target.value as WeatherModel)} aria-label="Forecast model">
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <p className="muted wx-model">
        Grid {info.grid} ·{' '}
        {run === undefined ? 'run not reported (blend)' : run.ms === null ? 'run time unknown' : `run ${formatDateTime(run.ms, tz, hour12)}, ${ageText(run.now - run.ms)} old`}
      </p>
      <p className="muted wx-caveat">Model forecasts for {formatTime(time, tz, hour12)}: guidance, not observations.</p>
      <Card title="Camera" at={pin} result={loading ? undefined : (results?.[0] ?? null)} time={time} now={now} onRetry={retry} />
      {pin2 && <Card title="Target" at={pin2} result={loading ? undefined : (results?.[1] ?? null)} time={time} now={now} onRetry={retry} />}
      <Sightlines />
      <Credit />
    </div>
  );
}

function Card({ title, at, result, time, now, onRetry }: { title: string; at: LngLat; result: ForecastResult | null | undefined; time: number; now: number; onRetry(): void }) {
  const units = useSettings((s) => s.units);
  const s = result?.series ?? null;
  const missing = result === undefined ? '' : missingText(result);
  return (
    <section className="wx-card" data-card={title.toLowerCase()}>
      <h3>
        {title}
        {result && result.series && <span className="muted"> · {fetchedText(result, now)}</span>}
      </h3>
      {result === undefined && <p className="muted">Loading forecast…</p>}
      {missing && (
        <p className="wx-missing">
          {missing}
          {result?.status !== ForecastStatus.OutOfRange && (
            <button className="link" onClick={onRetry}>
              Retry
            </button>
          )}
        </p>
      )}
      {s && (noDataAt(s, time) ? <p className="wx-missing">No forecast for this hour: outside the model's range.</p> : <Values s={s} time={time} units={units} />)}
      {s && result?.status === ForecastStatus.Cached && (
        <button className="link" onClick={onRetry}>
          Refresh
        </button>
      )}
      <WindyLink lat={at.lat} lng={at.lng} />
    </section>
  );
}

function Values({ s, time, units }: { s: PointSeries; time: number; units: Parameters<typeof tempText>[1] }) {
  const v = (k: HourlyVar) => (lacks(s, k) ? NaN : valueAt(s, k, time));
  const fog = fogAt(s, time);
  const code = hourValue(s, HourlyVar.Code, time);
  return (
    <div className="kv">
      <span className="k">Cloud</span>
      <b className="v" data-v="cloud">
        {pct(v(HourlyVar.Cloud))} <span className="muted">· low {pct(v(HourlyVar.CloudLow))} · mid {pct(v(HourlyVar.CloudMid))} · high {pct(v(HourlyVar.CloudHigh))}</span>
      </b>
      <span className="k">Fog</span>
      <b className="v" data-v="fog">
        {fog.length ? `possible: ${fog.map((r) => FOG_TEXT[r]).join(', ')}` : Number.isNaN(code) && Number.isNaN(v(HourlyVar.Visibility)) ? 'n/a' : 'no signs'}
      </b>
      <span className="k">Visibility</span>
      <b className="v">{visText(v(HourlyVar.Visibility), units)}</b>
      <span className="k">Precipitation</span>
      <b className="v">
        {rainText(v(HourlyVar.Precip), units)} <span className="muted">· chance {pct(v(HourlyVar.PrecipProb))}</span>
      </b>
      <span className="k">Temperature</span>
      <b className="v">
        {tempText(v(HourlyVar.Temp), units)} <span className="muted">· dew point {tempText(v(HourlyVar.Dew), units)} · RH {pct(v(HourlyVar.Humidity))}</span>
      </b>
      <span className="k">Wind</span>
      <b className="v">
        {windText(v(HourlyVar.Wind), units)} <span className="muted">· gusts {windText(v(HourlyVar.Gust), units)}</span>
      </b>
    </div>
  );
}
