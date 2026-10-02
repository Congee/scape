import { SkyBody } from '@core/astro/bodies';
import { EventKind, type DayEvent } from '@core/astro/dayEvents';
import { azimuth } from '@core/format';
import { formatTime } from '@core/time/format';
import { pct } from '@core/weather/format';
import { CLOUD_VARS } from '@core/weather/openMeteo';
import { CLOUD_HEIGHT_M, reachM, SIGHT_KM, sightPoints, sightSamples, SightVerdict, summarise, type Sightline } from '@core/weather/sightline';
import { useDayData } from '@state/dayData';
import { useSettings } from '@state/settings';
import { useWorld, worldStore } from '@state/world';
import { missingText, useForecast } from './CloudChart';
import { Dial } from './Dial';

const NAMES: Partial<Record<SkyBody, Partial<Record<EventKind, string>>>> = {
  Sun: { Rise: 'Sunrise', Set: 'Sunset' },
  Moon: { Rise: 'Moonrise', Set: 'Moonset' }
};

export const VERDICT_TEXT: Record<SightVerdict, string> = {
  Clear: 'horizon likely clear',
  Partial: 'horizon partly clouded',
  Blocked: 'horizon likely blocked',
  Unknown: 'horizon unknown'
};

export const sightKey = (e: DayEvent) => `${e.body}-${e.kind}-${e.time}`;

/** Cloud along each sun/moon rise/set azimuth of the day, in one batched request. */
export function useSightlines() {
  const events = useDayData((s) => s.events);
  const dayStart = useDayData((s) => s.dayStart);
  const dayEnd = useDayData((s) => s.dayEnd);
  const pin = useWorld((s) => s.pin);
  const evs = events.filter((e) => NAMES[e.body]?.[e.kind]);
  const points = evs.flatMap((e) => sightPoints(pin, e.azimuth));
  const { loading, results, retry } = useForecast(points, dayStart, dayEnd, CLOUD_VARS);
  const lines = new Map<string, Sightline>();
  if (results) evs.forEach((e, i) => lines.set(sightKey(e), summarise(sightSamples(results.slice(i * SIGHT_KM.length, (i + 1) * SIGHT_KM.length).map((r) => r?.series ?? null), e.time))));
  const missing = results?.[0] ? missingText(results[0]) : '';
  return { events: evs, lines, loading, missing, retry };
}

/** Weather-tab list of the day's rise/set sightlines with per-distance numbers on demand. */
export function Sightlines() {
  const tz = useWorld((s) => s.tz);
  const hour12 = useSettings((s) => s.hour12);
  const { events, lines, loading, missing, retry } = useSightlines();
  if (!events.length) return null;
  return (
    <section className="wx-card wx-sight" data-card="sightlines">
      <h3>Rise &amp; set sightlines</h3>
      <p className="muted wx-caveat">
        Horizon: low cloud to {Math.round(reachM(CLOUD_HEIGHT_M.low) / 1000)} km, mid to {Math.round(reachM(CLOUD_HEIGHT_M.mid) / 1000)} km along the azimuth. Canvas: mid/high overhead.
      </p>
      {loading && <p className="muted">Loading forecast…</p>}
      {missing && (
        <p className="wx-missing">
          {missing}
          <button className="link" onClick={retry}>
            Retry
          </button>
        </p>
      )}
      {!loading &&
        !missing &&
        events.map((e) => {
          const l = lines.get(sightKey(e));
          if (!l) return null;
          return (
            <details key={sightKey(e)} data-event={`${e.body}-${e.kind}`.toLowerCase()} data-verdict={l.verdict}>
              <summary className="brow">
                <Dial az={e.azimuth} ink={`${e.body.toLowerCase()} ${e.kind === EventKind.Rise ? 'rise' : 'set'}`} />
                <span className="label">
                  <button className="link" onClick={() => worldStore.getState().setTime(e.time)} title="Set the clock to this moment">
                    {NAMES[e.body]?.[e.kind]}
                  </button>{' '}
                  <b className={`verdict ${l.verdict.toLowerCase()}`}>{VERDICT_TEXT[l.verdict]}</b>
                </span>
                <span className="time">{formatTime(e.time, tz, hour12)}</span>
                <span className="az">
                  {azimuth(e.azimuth)}
                </span>
                <span className="note">
                  low {pct(l.blockLow)} · mid {pct(l.blockMid)} · canvas mid {pct(l.canvasMid)} · high {pct(l.canvasHigh)}
                </span>
              </summary>
              <table className="wx-dist">
                <thead>
                  <tr>
                    <th>km</th>
                    <th>low</th>
                    <th>mid</th>
                    <th>high</th>
                  </tr>
                </thead>
                <tbody>
                  {l.samples.map((s) => (
                    <tr key={s.km}>
                      <td>{s.km === 0 ? 'overhead' : s.km}</td>
                      <td>{pct(s.low)}</td>
                      <td>{pct(s.mid)}</td>
                      <td>{pct(s.high)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          );
        })}
    </section>
  );
}
