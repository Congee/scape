import { formatTime } from '@core/time/format';
import { ageText } from '@core/weather/format';
import { FOG_VISIBILITY_M, MIST_VISIBILITY_M } from '@core/weather/fog';
import { CloudLayer, LAYER_TEXT, legendGradient } from '@core/weather/layer';
import { modelInfo } from '@core/weather/models';
import { useSettings } from '@state/settings';
import { useUi } from '@state/ui';
import { useWeather, weatherStore } from '@state/weather';
import { useWorld } from '@state/world';
import { Credit, WindyLink } from './CloudChart';
import { useMedia } from './useMedia';

const HOUR_MS = 3_600_000;

const PHONE = '(max-width: 900px)';

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
      {layer !== CloudLayer.Off && <WindyLink lat={view.center.lat} lng={view.center.lng} mapZoom={view.zoom} />}
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
  const phone = useMedia(PHONE);
  const open = useUi((s) => s.cloudLegendOpen);
  const setOpen = useUi((s) => s.setCloudLegendOpen);
  if (layer === CloudLayer.Off) return null;
  const hour = Math.round(time / HOUR_MS) * HOUR_MS;
  const title = (
    <>
      <b>{LAYER_TEXT[layer]}</b> <span className="muted">· {formatTime(hour, tz, hour12)} forecast</span>
    </>
  );
  if (phone && !open)
    return (
      <button className="cloud-legend folded" data-layer={layer} aria-expanded={false} onClick={() => setOpen(true)} title="Show the cloud legend">
        {title} <span aria-hidden="true">▸</span>
      </button>
    );
  return (
    <div className="cloud-legend" data-layer={layer}>
      <div className="row">
        {title}
        {phone && (
          <button className="link fold" aria-expanded={true} onClick={() => setOpen(false)} title="Fold the cloud legend">
            ▾
          </button>
        )}
      </div>
      <div className="scale">
        <span>{layer === CloudLayer.Fog ? `Mist ${FOG_VISIBILITY_M / 1000}–${MIST_VISIBILITY_M / 1000} km` : '0%'}</span>
        <i style={{ backgroundImage: legendGradient(layer) }} />
        <span>{layer === CloudLayer.Fog ? `Fog < ${FOG_VISIBILITY_M / 1000} km` : '100%'}</span>
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
