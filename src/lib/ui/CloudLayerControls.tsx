import { formatTime } from '@core/time/format';
import { ageText } from '@core/weather/format';
import { CloudLayer, LAYER_TEXT, legendGradient } from '@core/weather/layer';
import { modelInfo } from '@core/weather/models';
import { useSettings } from '@state/settings';
import { useWeather, weatherStore } from '@state/weather';
import { useWorld } from '@state/world';
import { Credit, WindyLink } from './CloudChart';

const HOUR_MS = 3_600_000;

/** Windy uses 256 px tiles, MapLibre 512 px, so its zoom runs one higher. */
const WINDY_ZOOM_OFFSET = 1;

/** Weather-tab picker for the map cloud layer. */
export function CloudLayerControls() {
  const layer = useWeather((s) => s.layer);
  const opacity = useWeather((s) => s.opacity);
  const view = useWorld((s) => s.view);
  const w = weatherStore.getState();
  return (
    <section className="wx-card" data-card="map-layer">
      <h3>Map layer</h3>
      <div className="kv">
        <span className="k">Show</span>
        <b className="v">
          <select value={layer} onChange={(e) => w.setLayer(e.target.value as CloudLayer)} aria-label="Map cloud layer">
            {Object.values(CloudLayer).map((l) => (
              <option key={l} value={l}>
                {LAYER_TEXT[l]}
              </option>
            ))}
          </select>
        </b>
        {layer !== CloudLayer.Off && (
          <>
            <span className="k">Opacity</span>
            <b className="v">
              <input type="range" min={0.1} max={1} step={0.05} value={opacity} onChange={(e) => w.setOpacity(Number(e.target.value))} aria-label="Cloud layer opacity" />
              <span className="muted"> {Math.round(opacity * 100)}%</span>
            </b>
          </>
        )}
      </div>
      {layer !== CloudLayer.Off && <WindyLink lat={view.center.lat} lng={view.center.lng} zoom={view.zoom + WINDY_ZOOM_OFFSET} />}
    </section>
  );
}

/** Map-corner legend with the model, grid, hour and credit while the layer is on. */
export function CloudLegend() {
  const layer = useWeather((s) => s.layer);
  const model = useWeather((s) => s.model);
  const info = useWeather((s) => s.cloudInfo);
  const time = useWorld((s) => s.time);
  const tz = useWorld((s) => s.tz);
  const hour12 = useSettings((s) => s.hour12);
  if (layer === CloudLayer.Off) return null;
  const hour = Math.round(time / HOUR_MS) * HOUR_MS;
  return (
    <div className="cloud-legend" data-layer={layer}>
      <div className="row">
        <b>{LAYER_TEXT[layer]}</b> <span className="muted">· {formatTime(hour, tz, hour12)} forecast</span>
      </div>
      <div className="scale">
        <span>{layer === CloudLayer.Fog ? 'clear' : '0%'}</span>
        <i style={{ backgroundImage: legendGradient(layer) }} />
        <span>{layer === CloudLayer.Fog ? 'fog' : '100%'}</span>
        <i className="gap" />
        <span>no data</span>
      </div>
      <div className="muted" data-info>
        {modelInfo(model).label}
        {info ? ` · ${Math.round(info.stepKm)} km cells${info.unknown ? ` · ${info.unknown}/${info.cells} unknown` : ''}${info.fetchedAt ? ` · fetched ${ageText(info.at - info.fetchedAt)} ago` : ''}${info.note ? ` · ${info.note}` : ''}` : ' · loading…'}
      </div>
      <Credit />
    </div>
  );
}
