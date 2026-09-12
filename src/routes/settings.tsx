import { createFileRoute } from '@tanstack/react-router';
import type { Units } from '@core/format';
import type { CoordFormat } from '@core/geo/coords';
import { GearSettings } from '@ui/GearSettings';
import { DEFAULT_SETTINGS, settingsStore, useSettings } from '@state/settings';
import { useWorld, worldStore } from '@state/world';

export const Route = createFileRoute('/settings')({ component: SettingsPage });

function SettingsPage() {
  const s = useSettings();
  const pinHeightM = useWorld((w) => w.pinHeightM);
  const { update } = settingsStore.getState();
  return (
    <div className="page">
      <h1>Settings</h1>
      <section>
        <h2>Display</h2>
        <label className="field">
          <span>Units</span>
          <select value={s.units} onChange={(e) => update({ units: e.target.value as Units })}>
            <option value="metric">Metric</option>
            <option value="imperial">Imperial</option>
          </select>
        </label>
        <label className="field">
          <span>Time format</span>
          <select value={s.hour12 ? '12' : '24'} onChange={(e) => update({ hour12: e.target.value === '12' })}>
            <option value="12">12-hour</option>
            <option value="24">24-hour</option>
          </select>
        </label>
        <label className="field">
          <span>Coordinates</span>
          <select value={s.coordFormat} onChange={(e) => update({ coordFormat: e.target.value as CoordFormat })}>
            <option value="dd">Decimal degrees</option>
            <option value="dm">Degrees, minutes</option>
            <option value="dms">Degrees, minutes, seconds</option>
            <option value="signed">Signed decimal (40.71955, -74.14086)</option>
          </select>
        </label>
      </section>
      <section>
        <h2>Ephemeris</h2>
        <label className="field">
          <span>Golden hour ends at sun altitude (°)</span>
          <input type="number" min={0} max={15} step={0.5} value={s.goldenAltitude} onChange={(e) => update({ goldenAltitude: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span>Observer height above ground (m)</span>
          <input type="number" min={0} max={10000} step={1} value={pinHeightM} onChange={(e) => worldStore.getState().setPinHeight(Math.max(0, Number(e.target.value) || 0))} />
        </label>
        <p className="muted">Twilight bounds follow the standard −6°, −12° and −18° definitions.</p>
      </section>
      <section>
        <h2>Terrain</h2>
        <label className="field">
          <span>Fetch elevation data (Terrain Tiles)</span>
          <input type="checkbox" checked={s.terrain} onChange={(e) => update({ terrain: e.target.checked })} />
        </label>
        <p className="muted">Powers the elevation badge, the sightline profile and the terrain horizon. Water reads as depth in the data; sightlines treat it as sea level.</p>
      </section>
      <GearSettings />
      <section>
        <h2>Reset</h2>
        <button onClick={() => update({ ...DEFAULT_SETTINGS, customBasemaps: s.customBasemaps })}>Restore default settings</button>
      </section>
    </div>
  );
}
