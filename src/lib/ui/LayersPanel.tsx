import { useState } from 'react';
import { BUILTIN_BASEMAPS, type PmFlavor } from '@data/basemaps';
import { registerLocalPmtiles } from '@data/pmtiles';
import { useMapStatus } from '@state/mapStatus';
import { settingsStore, useSettings, type Settings } from '@state/settings';

const FLAVORS: PmFlavor[] = ['light', 'dark', 'white', 'grayscale', 'black'];

export function LayersPanel() {
  const basemapId = useSettings((s) => s.basemapId);
  const custom = useSettings((s) => s.customBasemaps);
  const { update, addBasemap, removeBasemap } = settingsStore.getState();
  const [url, setUrl] = useState('');
  const [flavor, setFlavor] = useState<PmFlavor>('light');
  const mapError = useMapStatus((s) => s.error);

  const addUrl = () => {
    const u = url.trim();
    if (!u) return;
    const name = u.split('/').pop()?.replace(/\.pmtiles$/i, '') || 'PMTiles';
    addBasemap({ id: `pm:${u}`, name, kind: 'pmtiles', url: u, flavor });
    setUrl('');
  };

  const addFile = (file: File | undefined) => {
    if (!file) return;
    const key = registerLocalPmtiles(file);
    addBasemap({ id: `file:${key}`, name: `${file.name} (this session)`, kind: 'pmtiles', url: key, flavor, local: true });
  };

  return (
    <div className="layers">
      <h3>Basemap</h3>
      {mapError && <p className="error">Basemap problem: {mapError}</p>}
      <ul className="radio-list">
        {[...BUILTIN_BASEMAPS, ...custom].map((b) => (
          <li key={b.id}>
            <label>
              <input type="radio" name="basemap" checked={b.id === basemapId} onChange={() => update({ basemapId: b.id })} />
              <span>{b.name}</span>
            </label>
            {!b.builtin && (
              <button className="link" onClick={() => removeBasemap(b.id)} title="Remove this basemap">
                remove
              </button>
            )}
          </li>
        ))}
      </ul>

      <h3>Add PMTiles</h3>
      <div className="field-row">
        <input type="url" placeholder="https://…/region.pmtiles" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addUrl()} />
        <select value={flavor} onChange={(e) => setFlavor(e.target.value as PmFlavor)} title="Protomaps style flavor">
          {FLAVORS.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
        <button onClick={addUrl}>Add</button>
      </div>
      <p className="muted hint">Remote archives must allow cross-origin range requests (CORS). Protomaps' planet builds do not; host your own extract or open a local file.</p>
      <label className="file">
        <input type="file" accept=".pmtiles" onChange={(e) => addFile(e.target.files?.[0])} />
        Open a local .pmtiles file (this session only; persistent storage arrives with the offline manager)
      </label>

      <h3>Overlays</h3>
      <Toggle k="showEventLines" label="Rise and set azimuth lines" />
      <Toggle k="showLiveLines" label="Live sun, moon and Galactic Centre lines" />
      <Toggle k="showShadow" label="Sun shadow direction" />
      <Toggle k="showGc" label="Galactic Centre" />
      <Toggle k="clickMovesPin" label="Clicking the map moves the pin" />
    </div>
  );
}

type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

function Toggle({ k, label }: { k: BoolKey; label: string }) {
  const on = useSettings((s) => s[k]);
  return (
    <label className="toggle">
      <input type="checkbox" checked={on} onChange={(e) => settingsStore.getState().update({ [k]: e.target.checked })} />
      <span>{label}</span>
    </label>
  );
}
