import { createFileRoute } from '@tanstack/react-router';
import type { Units } from '@core/format';
import type { CoordFormat } from '@core/geo/coords';
import { Confirm } from '@ui/Confirm';
import { GearSettings } from '@ui/GearSettings';
import { Icon } from '@ui/Icon';
import { OfflinePanel } from '@ui/OfflinePanel';
import { Segmented } from '@ui/Segmented';
import { DEFAULT_SETTINGS, settingsStore, useSettings } from '@state/settings';
import { useWorld, worldStore } from '@state/world';

const UNITS = [
  { value: 'metric', label: 'Metric' },
  { value: 'imperial', label: 'Imperial' }
] as const satisfies readonly { value: Units; label: string }[];
const CLOCKS = [
  { value: '12', label: '12-hour' },
  { value: '24', label: '24-hour' }
] as const;

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
        <div className="field">
          <span>Units</span>
          <Segmented<Units> label="Units" value={s.units} options={UNITS} onChange={(units) => update({ units })} />
        </div>
        <div className="field">
          <span>Time format</span>
          <Segmented label="Time format" value={s.hour12 ? '12' : '24'} options={CLOCKS} onChange={(v) => update({ hour12: v === '12' })} />
        </div>
        <label className="field">
          <span>Coordinates</span>
          <select value={s.coordFormat} onChange={(e) => update({ coordFormat: e.target.value as CoordFormat })}>
            <option value="signed">Signed decimal (44.4703,-72.7404)</option>
            <option value="dd">Decimal degrees</option>
            <option value="dm">Degrees, minutes</option>
            <option value="dms">Degrees, minutes, seconds</option>
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
        <div className="field">
          <span>Elevation</span>
          <button className="tgl" aria-pressed={s.terrain} aria-label="Fetch elevation data" onClick={() => update({ terrain: !s.terrain })}>
            Fetch (Terrain Tiles)
          </button>
        </div>
        <p className="muted">Powers the elevation badge, the sightline profile and the terrain horizon. Water reads as depth in the data; sightlines treat it as sea level.</p>
      </section>
      <section>
        <h2>Weather</h2>
        <div className="field">
          <span>Forecasts</span>
          <button className="tgl" aria-pressed={s.weather} aria-label="Fetch weather forecasts" onClick={() => update({ weather: !s.weather })}>
            Fetch (Open-Meteo)
          </button>
        </div>
        <p className="muted">Sends the camera, target and map-view locations to Open-Meteo. Off, no weather is fetched and the forecasts read "off for privacy".</p>
      </section>
      <GearSettings />
      <section id="offline">
        <h2>Offline</h2>
        <OfflinePanel />
      </section>
      <section>
        <h2>Reset</h2>
        <Confirm className="btn danger" question="Restore every setting to its default?" confirm="Restore" onConfirm={() => update({ ...DEFAULT_SETTINGS, customBasemaps: s.customBasemaps })}>
          <Icon name="alert" />
          Restore default settings
        </Confirm>
      </section>
    </div>
  );
}
