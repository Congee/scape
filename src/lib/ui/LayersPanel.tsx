import { useState } from 'react';
import { LightMode } from '@core/astro/lightSource';
import { basemapGroup, BasemapGroup, BasemapKind, BUILTIN_BASEMAPS, offlineBasemaps, PmFlavor, type Basemap } from '@data/basemaps';
import { registerLocalPmtiles } from '@data/pmtiles';
import { useMapStatus } from '@state/mapStatus';
import { useOffline } from '@state/offline';
import { settingsStore, useSettings } from '@state/settings';
import { OrbitPivot, useUi } from '@state/ui';
import { CloudToggle, DayNightToggle, SettingLayer, TerrainTintToggles, type BoolKey } from './MapLayerToggles';

const FLAVORS: PmFlavor[] = Object.values(PmFlavor);
const LIGHT_LABEL: Record<LightMode, string> = { [LightMode.Auto]: 'Sun by day, moon by night', [LightMode.Sun]: 'Sun only', [LightMode.Moon]: 'Moon only' };
const ORBIT_LABEL: Record<OrbitPivot, string> = { [OrbitPivot.Off]: 'Off', [OrbitPivot.Target]: 'Around the target', [OrbitPivot.Camera]: 'Around the camera' };
const GROUPS: BasemapGroup[] = [BasemapGroup.Vector, BasemapGroup.Raster, BasemapGroup.Downloaded, BasemapGroup.Custom];

export function LayersPanel() {
  const basemapId = useSettings((s) => s.basemapId);
  const custom = useSettings((s) => s.customBasemaps);
  const offlineFlavor = useSettings((s) => s.offlineFlavor);
  const archives = useOffline((s) => s.archives);
  const { update, addBasemap, removeBasemap } = settingsStore.getState();
  const [url, setUrl] = useState('');
  const [flavor, setFlavor] = useState<PmFlavor>(PmFlavor.Light);
  const mapError = useMapStatus((s) => s.error);
  const terrain = useSettings((s) => s.terrain);
  const rangeKm = useSettings((s) => s.horizonRangeKm);
  const shadowHeight = useSettings((s) => s.shadowObjectHeightM);
  const lightSource = useSettings((s) => s.lightSource);
  const orbit = useUi((s) => s.orbit);
  const orbitSpin = useUi((s) => s.orbitSpin);
  const setOrbit = useUi((s) => s.setOrbit);

  const addUrl = () => {
    const u = url.trim();
    if (!u) return;
    const name = u.split('/').pop()?.replace(/\.pmtiles$/i, '') || 'PMTiles';
    addBasemap({ id: `pm:${u}`, name, kind: BasemapKind.Pmtiles, url: u, flavor });
    setUrl('');
  };

  const addFile = (file: File | undefined) => {
    if (!file) return;
    const key = registerLocalPmtiles(file);
    addBasemap({ id: `file:${key}`, name: `${file.name} (this session)`, kind: BasemapKind.Pmtiles, url: key, flavor, local: true });
  };

  const offline = offlineBasemaps(archives, offlineFlavor);
  const all = [...BUILTIN_BASEMAPS, ...offline, ...custom];
  const current = all.find((b) => b.id === basemapId);

  return (
    <div className="layers">
      <h3>Map type · {current?.name ?? 'none'}</h3>
      {mapError && <p className="error">Basemap problem: {mapError}</p>}
      <div className="tree">
        {GROUPS.map((g) => {
          const items = all.filter((b) => basemapGroup(b) === g);
          if (!items.length) return null;
          return (
            <details key={g}>
              <summary>
                {g}
                {items.some((b) => b.id === basemapId) && <span className="dot active" aria-hidden="true" />}
              </summary>
              {g === BasemapGroup.Downloaded && items.some((b) => b.kind === BasemapKind.Pmtiles) && (
                <label className="toggle">
                  <span>Style</span>
                  <select value={offlineFlavor} onChange={(e) => update({ offlineFlavor: e.target.value as PmFlavor })} title="Protomaps style flavor for downloaded archives">
                    {FLAVORS.map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                  </select>
                </label>
              )}
              <ul className="radio-list">
                {items.map((b) => (
                  <li key={b.id}>
                    <label>
                      <input type="radio" name="basemap" checked={b.id === basemapId} onChange={() => update({ basemapId: b.id })} />
                      <span>{shortName(b, g)}</span>
                    </label>
                    {g === BasemapGroup.Custom && (
                      <button className="link" onClick={() => removeBasemap(b.id)} title="Remove this basemap">
                        remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
        <details>
          <summary>Add a basemap…</summary>
          <div className="field-row">
            <input type="url" placeholder="https://…/region.pmtiles" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addUrl()} />
            <select value={flavor} onChange={(e) => setFlavor(e.target.value as PmFlavor)} title="Protomaps style flavor">
              {FLAVORS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
            <button onClick={addUrl}>Add</button>
          </div>
          <p className="muted hint">Remote archives must allow cross-origin range requests; Protomaps' daily builds do only for local development origins.</p>
          <label className="file">
            <input type="file" accept=".pmtiles" onChange={(e) => addFile(e.target.files?.[0])} />
            Open a local .pmtiles file (this session only)
          </label>
          <p className="muted hint">Regions for offline use are downloaded and imported in the Offline tab.</p>
        </details>
      </div>

      <h3>Map layers</h3>
      {!terrain && <p className="muted hint">Elevation data is switched off in Settings.</p>}
      <DayNightToggle />
      <CloudToggle />
      <TerrainTintToggles />
      <SettingLayer k="showHillshade" label="Hillshade" />
      <SettingLayer k="terrain3d" label="3D terrain (right-drag or Ctrl-drag to tilt)">
        <label className="toggle">
          <span>Orbit</span>
          <select aria-label="Orbit the 3D map" value={orbit} onChange={(e) => setOrbit(e.target.value as OrbitPivot, true)}>
            {Object.values(OrbitPivot).map((o) => (
              <option key={o} value={o}>
                {ORBIT_LABEL[o]}
              </option>
            ))}
          </select>
        </label>
        {orbit !== OrbitPivot.Off && (
          <label className="toggle">
            <input type="checkbox" checked={orbitSpin} onChange={(e) => setOrbit(orbit, e.target.checked)} />
            <span>Turn slowly (stops when you grab the map)</span>
          </label>
        )}
      </SettingLayer>
      <SettingLayer k="showBuildings" label="3D buildings (Overture, in place of the basemap's own)">
        <p className="muted hint">Buildings appear from zoom 14.</p>
      </SettingLayer>
      <SettingLayer k="showSunShadows" label="Shadows on the ground (terrain and buildings)">
        <label className="toggle">
          <span>Light from</span>
          <select value={lightSource} onChange={(e) => update({ lightSource: e.target.value as LightMode })} aria-label="Light source for shadows" title="The moon takes over once it is up and the sun is 6° below the horizon; the viewfinder follows too">
            {Object.values(LightMode).map((m) => (
              <option key={m} value={m}>
                {LIGHT_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        <p className="muted hint">Shadows follow the timeline time; buildings cast them once their layer is on. Shade cast by the moon is drawn a darker neutral grey.</p>
      </SettingLayer>
      <SettingLayer k="showLightPollution" label="Night lights (NASA VIIRS Black Marble): brighter means more light pollution" />
      <SettingLayer k="showEventLines" label="Rise and set azimuth lines" />
      <SettingLayer k="showLiveLines" label="Live sun, moon and Galactic Centre lines" />
      <SettingLayer k="showShadow" label="Sun shadow (direction and length)">
        <label className="toggle">
          <span>Object height</span>
          <input
            type="number"
            className="num"
            min={0.1}
            step={0.1}
            value={shadowHeight}
            onChange={(e) => Number(e.target.value) > 0 && update({ shadowObjectHeightM: Number(e.target.value) })}
            title="Height of the object casting the shadow, metres"
          />
          <span className="muted">m</span>
        </label>
      </SettingLayer>
      <SettingLayer k="showGc" label="Galactic Centre" />

      <h3>Terrain horizon</h3>
      <Toggle k="terrainHorizon" label="Skyline on the chart, rise and set behind terrain" />
      <label className="toggle">
        <span>Horizon range</span>
        <select value={rangeKm} onChange={(e) => update({ horizonRangeKm: Number(e.target.value) })} title="How far the skyline sweep looks">
          {[50, 100, 150, 200].map((km) => (
            <option key={km} value={km}>
              {km} km
            </option>
          ))}
        </select>
      </label>
      <p className="muted hint">Elevation from Terrain Tiles (Mapzen, AWS Open Data), fetched per tile as needed and cached by the browser.</p>
    </div>
  );
}

/** The group name already says the family, so the entries drop it. */
function shortName(b: Basemap, g: BasemapGroup): string {
  if (g === BasemapGroup.Vector) return b.name.replace(/^OpenFreeMap /, '');
  if (g === BasemapGroup.Raster) return b.name.replace(/ \(raster\)$/, '');
  return b.name;
}

function Toggle({ k, label }: { k: BoolKey; label: string }) {
  const on = useSettings((s) => s[k]);
  return (
    <label className="toggle">
      <input type="checkbox" checked={on} onChange={(e) => settingsStore.getState().update({ [k]: e.target.checked })} />
      <span>{label}</span>
    </label>
  );
}
