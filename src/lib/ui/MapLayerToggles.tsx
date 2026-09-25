import type { ReactNode } from 'react';
import { CloudLayer, LAYER_TEXT } from '@core/weather/layer';
import { settingsStore, useSettings, type Settings } from '@state/settings';
import { useWeather, weatherStore } from '@state/weather';

export type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];
type Num = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings];

/** One map layer: its switch, and its options folded under it while on. */
export function LayerRow({ on, onChange, label, layer, children }: { on: boolean; onChange(on: boolean): void; label: string; layer: string; children?: ReactNode }) {
  return (
    <div className="layer-row" data-layer={layer}>
      <label className="toggle">
        <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
        <span>{label}</span>
      </label>
      {on && children && <div className="layer-opts">{children}</div>}
    </div>
  );
}

/** A layer backed by one boolean setting. */
export function SettingLayer({ k, label, children }: { k: BoolKey; label: string; children?: ReactNode }) {
  const on = useSettings((s) => s[k]);
  return (
    <LayerRow on={on} onChange={(v) => settingsStore.getState().update({ [k]: v })} label={label} layer={k}>
      {children}
    </LayerRow>
  );
}

function Opacity({ value, onChange, label }: { value: number; onChange(v: number): void; label: string }) {
  return (
    <label className="toggle">
      <span>Opacity</span>
      <input type="range" min={0.1} max={1} step={0.05} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={`${label} opacity`} />
      <span className="muted">{Math.round(value * 100)}%</span>
    </label>
  );
}

/** A tint layer with its opacity. */
function TintLayer({ k, opacity, label, disabled }: { k: BoolKey; opacity: Num; label: string; disabled?: string }) {
  const o = useSettings((s) => s[opacity]);
  return (
    <SettingLayer k={k} label={label}>
      <Opacity value={o} onChange={(v) => settingsStore.getState().update({ [opacity]: v })} label={label} />
      {disabled && <p className="muted hint">{disabled}</p>}
    </SettingLayer>
  );
}

export function DayNightToggle() {
  return <TintLayer k="showDayNight" opacity="dayNightOpacity" label="Day and night, with civil, nautical and astronomical twilight" />;
}

export function TerrainTintToggles() {
  const t3d = useSettings((s) => s.terrain3d);
  const flatOnly = t3d ? 'Shown on the flat map only; switch 3D terrain off to see it.' : undefined;
  return (
    <>
      <TintLayer k="showElevation" opacity="elevationOpacity" label="Elevation tint" />
      <TintLayer k="showSlope" opacity="slopeOpacity" label="Slope angle" disabled={flatOnly} />
      <TintLayer k="showAspect" opacity="aspectOpacity" label="Aspect (which way slopes face)" disabled={flatOnly} />
    </>
  );
}

const KINDS = Object.values(CloudLayer).filter((l) => l !== CloudLayer.Off);

/** The forecast cloud and fog layer; the same state as the Weather tab's picker. */
export function CloudToggle() {
  const layer = useWeather((s) => s.layer);
  const opacity = useWeather((s) => s.opacity);
  const weather = useSettings((s) => s.weather);
  const w = weatherStore.getState();
  return (
    <LayerRow on={layer !== CloudLayer.Off} onChange={w.setShown} label="Cloud and fog forecast" layer="cloud">
      <label className="toggle">
        <span>Show</span>
        <select value={layer} onChange={(e) => w.setLayer(e.target.value as CloudLayer)} aria-label="Cloud layer kind">
          {KINDS.map((l) => (
            <option key={l} value={l}>
              {LAYER_TEXT[l]}
            </option>
          ))}
        </select>
      </label>
      <Opacity value={opacity} onChange={w.setOpacity} label="Cloud layer" />
      {!weather && <p className="muted hint">Weather is switched off in Settings.</p>}
    </LayerRow>
  );
}
