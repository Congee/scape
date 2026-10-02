import { useEffect, useState, type ReactNode } from 'react';
import { compass, degrees, distance } from '@core/format';
import { atPixel, formatLngLat } from '@core/geo/coords';
import { bearingDeg, distanceM, type LngLat } from '@core/geo/geodesy';
import { markersToGeoJson, markersToGpx, markersToKml } from '@core/io/points';
import { MarkerCategory, MarkerShape, type SavedMarker } from '@core/plan';
import { parsePointsText } from '@data/importPoints';
import { markersStore, useMarkers } from '@state/markers';
import { useSettings } from '@state/settings';
import { MarkersView, useUi } from '@state/ui';
import { useWorld, worldStore } from '@state/world';
import { Dial } from './Dial';
import { downloadText } from './download';
import { CATEGORY_COLORS } from './map/overlays';
import { ModelsPanel } from './ModelsPanel';
import { useOnMap } from './panelPage';
import { Section } from './Section';
import { Segmented } from './Segmented';

const CATEGORIES = Object.values(MarkerCategory);
const SHAPES = Object.values(MarkerShape);

export function MarkersPanel() {
  const view = useUi((s) => s.markersView);
  const setView = useUi((s) => s.setMarkersView);
  const head = (
    <Segmented label="Show" className="markers-switch" value={view} options={Object.values(MarkersView).map((v) => ({ value: v, label: v }))} onChange={setView} />
  );
  return view === MarkersView.Models ? <ModelsPanel head={head} /> : <MarkerList head={head} />;
}

function MarkerList({ head }: { head: ReactNode }) {
  const markers = useMarkers((s) => s.markers);
  const loaded = useMarkers((s) => s.loaded);
  const selectedId = useMarkers((s) => s.selectedId);
  const placing = useMarkers((s) => s.placing);
  const pin = useWorld((s) => s.pin);
  const pin2 = useWorld((s) => s.pin2);
  const units = useSettings((s) => s.units);
  const onMap = useOnMap();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!loaded) void markersStore.getState().load();
  }, [loaded]);

  const ms = markersStore.getState();
  const selected = markers.find((m) => m.id === selectedId) ?? null;
  const sorted = markers.map((m) => ({ m, d: distanceM(pin, m) })).toSorted((a, b) => a.d - b.d);

  const addAt = (p: LngLat) => void ms.save(p).then((m) => ms.select(m.id));
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
    <>
      <Section className="markers">
        {head}
        <div className="actions">
          {onMap && (
            <>
              <button className={placing ? 'on' : ''} aria-pressed={placing} onClick={() => ms.setPlacing(!placing)} title="Then click the map where the marker goes (or Alt-click the map any time)">
                {placing ? 'Click the map…' : 'Add by clicking the map'}
              </button>
              <button onClick={() => addAt(atPixel(worldStore.getState().view.center, worldStore.getState().view.zoom))}>Add at map centre</button>
            </>
          )}
          {pin2 && <button onClick={() => addAt(pin2)}>Add at target</button>}
        </div>
        {selected && <MarkerEditor m={selected} />}
      </Section>
      <Section title={`${markers.length} marker${markers.length === 1 ? '' : 's'}`} className="markers">
        {loaded && markers.length === 0 && <p className="muted hint">No markers yet</p>}
        <ul className="list marker-list">
          {sorted.map(({ m, d }) => (
            <li key={m.id} className={m.id === selectedId ? 'selected' : ''}>
              <button className="marker-row" aria-pressed={m.id === selectedId} onClick={() => ms.select(m.id === selectedId ? null : m.id)}>
                {d > 0 ? <Dial az={bearingDeg(pin, m)} ink="marker" color={CATEGORY_COLORS[m.category]} /> : <span className="cat" style={{ background: CATEGORY_COLORS[m.category] }} aria-hidden="true" />}
                <span className="name">
                  {m.name}
                  {m.rating > 0 && <span className="muted"> {'★'.repeat(m.rating)}</span>}
                </span>
                <span className="time">{distance(d, units)}</span>
                <span className="az">{d > 0 ? `${degrees(bearingDeg(pin, m), 0)} ${compass(bearingDeg(pin, m))}` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Import & export" className="markers">
        <label className="button file-pick">
          Import GeoJSON, KML or GPX
          <input type="file" accept=".geojson,.json,.kml,.gpx" onChange={(e) => void importFile(e.target.files?.[0])} />
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
      </Section>
    </>
  );
}

function MarkerEditor({ m }: { m: SavedMarker }) {
  const units = useSettings((s) => s.units);
  const coordFormat = useSettings((s) => s.coordFormat);
  const ms = markersStore.getState();
  const patch = (p: Partial<SavedMarker>) => void ms.save({ ...m, ...p });
  const shape = m.shape ?? MarkerShape.Bar;
  const onMap = useOnMap();
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
      <b className="v stars" role="group" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((r) => (
          <button key={r} className={m.rating >= r ? 'on' : ''} aria-pressed={m.rating === r} onClick={() => patch({ rating: m.rating === r ? 0 : r })} aria-label={`${r} star${r === 1 ? '' : 's'}`}>
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
        <button onClick={() => worldStore.getState().setPin2({ lat: m.lat, lng: m.lng, digits: m.digits })} title="Make this marker the target location">
          Use as target
        </button>
        <button onClick={() => worldStore.getState().setPin({ lat: m.lat, lng: m.lng, digits: m.digits })} title="Move the camera to this marker">
          Camera here
        </button>
        {onMap && <button onClick={() => worldStore.getState().flyTo(m, Math.max(worldStore.getState().view.zoom, 13))}>Show on map</button>}
        <button className="link" onClick={() => void ms.remove(m.id)}>
          Delete
        </button>
      </b>
      <span className="k">Position</span>
      <b className="v muted">
        {formatLngLat(m, coordFormat)} · {distance(distanceM(worldStore.getState().pin, m), units)} at {degrees(bearingDeg(worldStore.getState().pin, m), 1)}
      </b>
    </div>
  );
}
