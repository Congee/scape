import { useEffect, useState } from 'react';
import { Units } from '@core/format';
import { nearestStation } from '@core/tides/predict';
import { tideSite, tideStations, TideKind, type TideDay, type TideStationRef } from '@data/tides';
import { useWorld, worldStore } from '@state/world';

/** The pin's nearest tide station of either kind, from the lazily fetched tables. */
export function useNearestTide() {
  const pin = useWorld((s) => s.pin);
  const [stations, setStations] = useState<TideStationRef[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    tideStations().then(setStations, () => setFailed(true));
  }, []);

  const retry = () => {
    setFailed(false);
    tideStations().then(setStations, () => setFailed(true));
  };
  const hit = stations ? nearestStation(stations, pin) : null;
  return { loaded: stations !== null, failed, retry, distM: hit?.distM ?? 0, site: hit ? tideSite(hit.station) : null };
}

export const tideText = (m: number, units: Units) => (units === Units.Imperial ? `${(m / 0.3048).toFixed(1)} ft` : `${m.toFixed(2)} m`);

export const tideKindText = (kind: TideKind) => (kind === TideKind.Harmonic ? 'harmonic' : 'subordinate');

const W = 300;

/** The day's tide: the curve and its highs and lows, or the highs and lows alone for a subordinate station. */
export function TideChart({ day, startMs, endMs, time, h = 72 }: { day: TideDay; startMs: number; endMs: number; time: number; h?: number }) {
  const { curve, extremes } = day;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of curve ?? extremes.map((e) => e.heightM)) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  if (!Number.isFinite(lo)) [lo, hi] = [0, 0];
  const pad = (hi - lo) * 0.12 || 0.1;
  const x = (ms: number) => ((ms - startMs) / (endMs - startMs)) * W;
  const y = (m: number) => h - ((m - lo + pad) / (hi - lo + 2 * pad)) * h;
  const step = curve ? (endMs - startMs) / (curve.length - 1) : 0;
  const points = curve ? Array.from(curve, (v, i) => `${x(startMs + i * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ') : '';
  return (
    <svg className="tide-curve" viewBox={`0 0 ${W} ${h}`} role="img" aria-label={curve ? 'Tide height over the day' : 'High and low tides over the day'}>
      {lo < 0 && <line className="datum" x1={0} x2={W} y1={y(0)} y2={y(0)} />}
      {curve && <polyline points={points} />}
      {extremes.map((e) => (
        <g key={e.timeMs} onClick={() => worldStore.getState().setTime(e.timeMs)}>
          <circle className="hit" cx={x(e.timeMs)} cy={y(e.heightM)} r={10} />
          <circle className={e.high ? 'high' : 'low'} cx={x(e.timeMs)} cy={y(e.heightM)} r={curve ? 3 : 4} />
        </g>
      ))}
      {time >= startMs && time < endMs && <line className="now" x1={x(time)} x2={x(time)} y1={0} y2={h} />}
    </svg>
  );
}
