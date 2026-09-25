import { settingsStore, useSettings, type Settings } from '@state/settings';

type Pair = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];
type Num = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings];

/** A layer's switch, and its opacity once it is on. */
function LayerToggle({ k, opacity, label, disabled }: { k: Pair; opacity: Num; label: string; disabled?: string }) {
  const on = useSettings((s) => s[k]);
  const o = useSettings((s) => s[opacity]);
  const { update } = settingsStore.getState();
  return (
    <>
      <label className="toggle">
        <input type="checkbox" checked={on} onChange={(e) => update({ [k]: e.target.checked })} />
        <span>{label}</span>
      </label>
      {on && (
        <label className="toggle">
          <span>Opacity</span>
          <input type="range" min={0.1} max={1} step={0.05} value={o} onChange={(e) => update({ [opacity]: Number(e.target.value) })} aria-label={`${label} opacity`} />
          <span className="muted">{Math.round(o * 100)}%</span>
        </label>
      )}
      {on && disabled && <p className="muted hint">{disabled}</p>}
    </>
  );
}

export function DayNightToggle() {
  return <LayerToggle k="showDayNight" opacity="dayNightOpacity" label="Day and night, with civil, nautical and astronomical twilight" />;
}

export function TerrainTintToggles() {
  const t3d = useSettings((s) => s.terrain3d);
  const flatOnly = t3d ? 'Shown on the flat map only; switch 3D terrain off to see it.' : undefined;
  return (
    <>
      <LayerToggle k="showElevation" opacity="elevationOpacity" label="Elevation tint" />
      <LayerToggle k="showSlope" opacity="slopeOpacity" label="Slope angle" disabled={flatOnly} />
      <LayerToggle k="showAspect" opacity="aspectOpacity" label="Aspect (which way slopes face)" disabled={flatOnly} />
    </>
  );
}
