import { useEffect, useState } from 'react';
import { compass, degrees, distance } from '@core/format';
import { bearingDeg, distanceM } from '@core/geo/geodesy';
import { markersToGeoJson, markersToGpx, markersToKml } from '@core/io/points';
import { MarkerCategory, MarkerShape, type SavedMarker } from '@core/plan';
import { parsePointsText } from '@data/importPoints';
import { markersStore, useMarkers } from '@state/markers';
import { useSettings } from '@state/settings';
import { useWorld, worldStore } from '@state/world';
import { downloadText } from './download';
import { CATEGORY_COLORS } from './map/overlays';

const CATEGORIES = Object.values(MarkerCategory);
const SHAPES = Object.values(MarkerShape);

export function MarkersPanel() {
  const markers = useMarkers((s) => s.markers);
  const loaded = useMarkers((s) => s.loaded);
  const selectedId = useMarkers((s) => s.selectedId);
  const placing = useMarkers((s) => s.placing);
  const pin = useWorld((s) => s.pin);
  const pin2 = useWorld((s) => s.pin2);
  const units = useSettings((s) => s.units);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!loaded) void markersStore.getState().load();
  }, [loaded]);

  const ms = markersStore.getState();
  const selected = markers.find((m) => m.id === selectedId) ?? null;
  const sorted = markers.map((m) => ({ m, d: distanceM(pin, m) })).toSorted((a, b) => a.d - b.d);

  const addAt = (p: { lat: number; lng: number }) => void ms.save(p).then((m) => ms.select(m.id));
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const n = await ms.importPoints(parsePointsText(await file.text(), file.name));
      setStatus({ ok: true, text: `Imported ${n} point${n === 1 ? '' : 's'} from ${file.name}.` });
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };
  const exportAs = (fmt: 'geojson' | 'kml' | 'gpx') => {
    if (fmt === 'geojson') downloadText('scape-markers.geojson', JSON.stringify(markersToGeoJson(markers), null, 2), 'application/geo+json');
    else if (fmt === 'kml') downloadText('scape-markers.kml', markersToKml(markers), 'application/vnd.google-earth.kml+xml');
    else downloadText('scape-markers.gpx', markersToGpx(markers), 'application/gpx+xml');
  };

  return (
    <div className="markers">
      <div className="actions">
        <button className={placing ? 'on' : ''} onClick={() => ms.setPlacing(!placing)} title="Then click the map where the marker goes (or Alt-click the map any time)">
          {placing ? 'Click the map…' : 'Add by clicking the map'}
        </button>
        <button onClick={() => addAt(worldStore.getState().view.center)}>Add at map centre</button>
        {pin2 && <button onClick={() => addAt(pin2)}>Add at target</button>}
      </div>
      {selected && <MarkerEditor m={selected} />}
      <h3>
        {markers.length} marker{markers.length === 1 ? '' : 's'}
      </h3>
      {loaded && markers.length === 0 && <p className="muted hint">Markers are landmarks you want to see in the viewfinder: peaks, buildings, trees. Import a KML, GPX or GeoJSON file or drop them on the map.</p>}
      <ul className="list marker-list">
        {sorted.map(({ m, d }) => (
          <li key={m.id} className={m.id === selectedId ? 'selected' : ''} onClick={() => ms.select(m.id === selectedId ? null : m.id)}>
            <span className="cat" style={{ background: CATEGORY_COLORS[m.category] }} aria-hidden="true" />
            <span className="name">
              {m.name}
              {m.rating > 0 && <span className="muted"> {'★'.repeat(m.rating)}</span>}
            </span>
            <span className="where">
              {distance(d, units)} {compass(bearingDeg(pin, m))}
            </span>
          </li>
        ))}
      </ul>
      <h3>Import &amp; export</h3>
      <label className="file">
        <input type="file" accept=".geojson,.json,.kml,.gpx" onChange={(e) => void importFile(e.target.files?.[0])} />
        Import points from GeoJSON, KML or GPX
      </label>
      <div className="actions">
        <button onClick={() => exportAs('geojson')} disabled={!markers.length}>
          Export GeoJSON
        </button>
        <button onClick={() => exportAs('kml')} disabled={!markers.length}>
          Export KML
        </button>
        <button onClick={() => exportAs('gpx')} disabled={!markers.length}>
          Export GPX
        </button>
      </div>
      {status && <p className={status.ok ? 'muted hint ok' : 'error'}>{status.text}</p>}
    </div>
  );
}

function MarkerEditor({ m }: { m: SavedMarker }) {
  const units = useSettings((s) => s.units);
  const ms = markersStore.getState();
  const patch = (p: Partial<SavedMarker>) => void ms.save({ ...m, ...p });
  const shape = m.shape ?? MarkerShape.Bar;
  return (
    <div className="kv">
      <span className="k">Name</span>
      <b className="v">
        <input type="text" value={m.name} onChange={(e) => patch({ name: e.target.value })} aria-label="Marker name" />
      </b>
      <span className="k">Category</span>
      <b className="v">
        <select value={m.category} onChange={(e) => patch({ category: e.target.value as MarkerCategory })} aria-label="Category">
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </b>
      <span className="k">Height</span>
      <b className="v">
        <input type="number" min={0} step={1} value={m.heightM} onChange={(e) => patch({ heightM: Math.max(0, Number(e.target.value) || 0) })} aria-label="Height above ground, metres" />
        <span className="muted">m above ground</span>
      </b>
      <span className="k">Width</span>
      <b className="v">
        <input type="number" min={0} step={1} value={m.widthM} onChange={(e) => patch({ widthM: Math.max(0, Number(e.target.value) || 0) })} aria-label="Width, metres" />
        <span className="muted">m</span>
      </b>
      <span className="k">Shape</span>
      <b className="v">
        <select value={shape} onChange={(e) => patch({ shape: e.target.value as MarkerShape })} aria-label="Viewfinder shape" title="Bar is a flat outline; the others draw a shaded 3D solid">
          {SHAPES.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </b>
      {shape === MarkerShape.Box && (
        <>
          <span className="k">Depth</span>
          <b className="v">
            <input type="number" min={0} step={1} value={m.depthM ?? m.widthM} onChange={(e) => patch({ depthM: Math.max(0, Number(e.target.value) || 0) })} aria-label="Depth, metres" />
            <span className="muted">m</span>
          </b>
        </>
      )}
      {shape !== MarkerShape.Bar && (
        <>
          <span className="k">Rotation</span>
          <b className="v">
            <input type="number" step={1} value={m.rotationDeg ?? 0} onChange={(e) => patch({ rotationDeg: Number(e.target.value) || 0 })} aria-label="Footprint rotation, degrees clockwise from north" />
            <span className="muted">° from north</span>
          </b>
        </>
      )}
      <span className="k">Rating</span>
      <b className="v stars">
        {[1, 2, 3, 4, 5].map((r) => (
          <button key={r} className={m.rating >= r ? 'on' : ''} onClick={() => patch({ rating: m.rating === r ? 0 : r })} aria-label={`${r} star${r === 1 ? '' : 's'}`}>
            ★
          </button>
        ))}
      </b>
      <span className="k">Notes</span>
      <b className="v wide">
        <textarea value={m.notes} onChange={(e) => patch({ notes: e.target.value })} aria-label="Notes" />
      </b>
      <b className="v wide">
        <label className="toggle">
          <input type="checkbox" checked={m.showInViewfinder} onChange={(e) => patch({ showInViewfinder: e.target.checked })} />
          <span>Show in the viewfinder</span>
        </label>
      </b>
      <b className="v wide actions">
        <button onClick={() => worldStore.getState().setPin2({ lat: m.lat, lng: m.lng })} title="Make this marker the target location">
          Use as target
        </button>
        <button onClick={() => worldStore.getState().setPin({ lat: m.lat, lng: m.lng })} title="Move the camera to this marker">
          Camera here
        </button>
        <button onClick={() => worldStore.getState().flyTo(m, Math.max(worldStore.getState().view.zoom, 13))}>Show on map</button>
        <button className="link" onClick={() => void ms.remove(m.id)}>
          Delete
        </button>
      </b>
      <span className="k">Position</span>
      <b className="v muted">
        {m.lat.toFixed(5)}, {m.lng.toFixed(5)} · {distance(distanceM(worldStore.getState().pin, m), units)} at {degrees(bearingDeg(worldStore.getState().pin, m), 1)}
      </b>
    </div>
  );
}
