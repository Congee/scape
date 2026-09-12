import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { formatLngLat } from '@core/geo/coords';
import { formatDateTime } from '@core/time/format';
import { exportAll, importAll, ImportMode, isScapeExport } from '@data/db';
import { libraryStore, useLibrary } from '@state/library';
import { markersStore, useMarkers } from '@state/markers';
import { applyPlan, capturePlan, plansStore, usePlans } from '@state/plans';
import { useSettings } from '@state/settings';
import { useWorld, worldStore } from '@state/world';
import { downloadText } from '@ui/download';

export const Route = createFileRoute('/library')({ component: LibraryPage });

async function exportEverything() {
  const data = await exportAll();
  downloadText(`scape-${new Date().toISOString().slice(0, 10)}.scape.json`, JSON.stringify(data, null, 2), 'application/json');
}

function LibraryPage() {
  const locations = useLibrary((s) => s.locations);
  const loaded = useLibrary((s) => s.loaded);
  const plans = usePlans((s) => s.plans);
  const plansLoaded = usePlans((s) => s.loaded);
  const markers = useMarkers((s) => s.markers);
  const pin = useWorld((s) => s.pin);
  const tz = useWorld((s) => s.tz);
  const format = useSettings((s) => s.coordFormat);
  const hour12 = useSettings((s) => s.hour12);
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [planName, setPlanName] = useState('');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!loaded) void libraryStore.getState().load();
    if (!plansLoaded) void plansStore.getState().load();
  }, [loaded, plansLoaded]);

  const save = async () => {
    const n = name.trim();
    if (!n) return;
    await libraryStore.getState().save({ name: n, lat: pin.lat, lng: pin.lng, tz });
    setName('');
  };

  const go = (lat: number, lng: number) => {
    const w = worldStore.getState();
    w.setPin({ lat, lng });
    w.flyTo({ lat, lng }, Math.max(w.view.zoom, 11), false);
    void navigate({ to: '/' });
  };

  const savePlan = async () => {
    if (!planName.trim()) return;
    await plansStore.getState().save(capturePlan(planName));
    setPlanName('');
  };

  const openPlan = (id: string) => {
    const p = plans.find((x) => x.id === id);
    if (!p) return;
    applyPlan(p);
    void navigate({ to: '/' });
  };

  const importEverything = async (file: File | undefined, mode: ImportMode) => {
    if (!file) return;
    try {
      const data: unknown = JSON.parse(await file.text());
      if (!isScapeExport(data)) throw new Error('Not a Scape export file');
      await importAll(data, mode);
      await Promise.all([libraryStore.getState().load(), plansStore.getState().load(), markersStore.getState().load()]);
      setStatus({ ok: true, text: `Imported ${data.locations.length} locations, ${data.plans.length} plans and ${data.markers.length} markers.` });
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="page">
      <h1>Library</h1>
      <section>
        <h2>Save the camera location</h2>
        <div className="field-row">
          <input placeholder={`Name for ${formatLngLat(pin, format)}`} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
          <button onClick={save} disabled={!name.trim()}>
            Save
          </button>
        </div>
      </section>
      <section>
        <h2>Locations</h2>
        {loaded && locations.length === 0 && <p className="muted">Nothing saved yet.</p>}
        <ul className="list">
          {locations.map((l) => (
            <li key={l.id}>
              <button className="primary" onClick={() => go(l.lat, l.lng)} title="Move the camera here">
                <span className="name">{l.name}</span>
                <span className="detail">{formatLngLat(l, format)}</span>
              </button>
              <button className="link" onClick={() => worldStore.getState().setPin2({ lat: l.lat, lng: l.lng })} title="Use as the target location">
                target
              </button>
              <button className="link" onClick={() => libraryStore.getState().remove(l.id)} title="Delete">
                delete
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Plans</h2>
        <p className="muted">A plan stores the camera and target locations, the moment, and the composition (sensor, focal length, aperture, aim).</p>
        <div className="field-row">
          <input placeholder="Save the current set-up as…" value={planName} onChange={(e) => setPlanName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && savePlan()} />
          <button onClick={savePlan} disabled={!planName.trim()}>
            Save plan
          </button>
        </div>
        {plansLoaded && plans.length === 0 && <p className="muted">No plans yet.</p>}
        <ul className="list">
          {plans.map((p) => (
            <li key={p.id}>
              <button className="primary" onClick={() => openPlan(p.id)} title="Load this plan">
                <span className="name">{p.name}</span>
                <span className="detail">
                  {formatDateTime(p.time, p.tz, hour12)} · {p.composition.focalMm} mm f/{p.composition.fNumber}
                  {p.target ? ' · with target' : ''}
                </span>
              </button>
              <button className="link" onClick={() => void plansStore.getState().save(capturePlan(p.name, p))} title="Overwrite with the current set-up">
                update
              </button>
              <button className="link" onClick={() => void plansStore.getState().remove(p.id)} title="Delete">
                delete
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Markers</h2>
        <p className="muted">
          {markers.length} marker{markers.length === 1 ? '' : 's'}. Add, edit, import and export them in the Markers tab next to the map.
        </p>
      </section>
      <section>
        <h2>Backup</h2>
        <div className="actions" style={{ padding: 0 }}>
          <button onClick={exportEverything}>Export everything (.scape.json)</button>
        </div>
        <label className="file">
          <input type="file" accept=".json" onChange={(e) => void importEverything(e.target.files?.[0], ImportMode.Merge)} />
          Import a Scape export, keeping what is already here
        </label>
        <label className="file">
          <input type="file" accept=".json" onChange={(e) => void importEverything(e.target.files?.[0], ImportMode.Replace)} />
          Import a Scape export, replacing locations, plans and markers
        </label>
        {status && <p className={status.ok ? 'muted ok' : 'error'}>{status.text}</p>}
      </section>
    </div>
  );
}
