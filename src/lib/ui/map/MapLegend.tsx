import { useSettings } from '@state/settings';
import { ASPECT_SATURATION, ASPECT_VALUE, ELEVATION_STOPS, ELEVATION_TICKS, NIGHT_COLOR, RISE_LINE_COLOR, SLOPE_LEGEND } from './layerRamps';

const lo = ELEVATION_STOPS[0][0];
const hi = ELEVATION_STOPS[ELEVATION_STOPS.length - 1][0];
const pct = (m: number) => ((m - lo) / (hi - lo)) * 100;
const ELEV_GRADIENT = `linear-gradient(to right, ${ELEVATION_STOPS.map(([m, c]) => `${c} ${pct(m).toFixed(2)}%`).join(', ')})`;

/** HSV to CSS, matching the aspect shader. */
function hsv(h: number) {
  const k = [0, 4, 2].map((o) => Math.min(1, Math.max(0, Math.abs(((h * 6 + o) % 6) - 3) - 1)));
  return `rgb(${k.map((x) => Math.round(255 * ASPECT_VALUE * (1 - ASPECT_SATURATION + ASPECT_SATURATION * x))).join(' ')})`;
}
const ASPECT_WHEEL = `conic-gradient(${Array.from({ length: 13 }, (_, i) => `${hsv((i % 12) / 12)} ${i * 30}deg`).join(', ')})`;
const NIGHT_KEY = ['Day', 'Civil', 'Nautical', 'Astronomical', 'Night'].map((label, i) => ({ label, alpha: i / 4 }));

export function MapLegend() {
  const terrain = useSettings((s) => s.terrain);
  const t3d = useSettings((s) => s.terrain3d);
  const night = useSettings((s) => s.showDayNight);
  const elev = useSettings((s) => s.showElevation) && terrain;
  const slope = useSettings((s) => s.showSlope) && terrain && !t3d;
  const aspect = useSettings((s) => s.showAspect) && terrain && !t3d;
  if (!night && !elev && !slope && !aspect) return null;
  return (
    <div className="map-legend" aria-label="Map legend">
      {night && (
        <div className="legend-row">
          <span className="legend-line" style={{ background: RISE_LINE_COLOR }} title="Sunrise and sunset line" />
          {NIGHT_KEY.map((b) => (
            <span key={b.label} className="legend-chip">
              <i style={{ background: NIGHT_COLOR, opacity: Math.max(0.08, b.alpha) }} />
              {b.label}
            </span>
          ))}
        </div>
      )}
      {elev && (
        <div className="legend-elev">
          <div className="legend-bar" style={{ background: ELEV_GRADIENT }} />
          <div className="legend-ticks">
            {ELEVATION_TICKS.map((m) => (
              <span key={m} style={{ left: `${pct(m)}%` }}>
                {m.toLocaleString()}
              </span>
            ))}
          </div>
          <span className="muted">m</span>
        </div>
      )}
      {slope && (
        <div className="legend-row">
          {SLOPE_LEGEND.map((b) => (
            <span key={b.label} className="legend-chip">
              <i style={{ background: b.color, borderColor: b.color === 'transparent' ? 'var(--fg-3)' : b.color }} />
              {b.label}
            </span>
          ))}
        </div>
      )}
      {aspect && (
        <div className="legend-row">
          <span className="legend-wheel" style={{ background: ASPECT_WHEEL }}>
            <b>N</b>
          </span>
          <span className="muted">Facing (downslope): N red, E yellow-green, S cyan, W violet; flat left clear</span>
        </div>
      )}
    </div>
  );
}
