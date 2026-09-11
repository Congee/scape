import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { formatLngLat } from '@core/geo/coords';
import { libraryStore, useLibrary } from '@state/library';
import { useSettings } from '@state/settings';
import { useWorld, worldStore } from '@state/world';

export const Route = createFileRoute('/library')({ component: LibraryPage });

function LibraryPage() {
  const locations = useLibrary((s) => s.locations);
  const loaded = useLibrary((s) => s.loaded);
  const pin = useWorld((s) => s.pin);
  const tz = useWorld((s) => s.tz);
  const format = useSettings((s) => s.coordFormat);
  const navigate = useNavigate();
  const [name, setName] = useState('');

  useEffect(() => {
    if (!loaded) void libraryStore.getState().load();
  }, [loaded]);

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

  return (
    <div className="page">
      <h1>Library</h1>
      <section>
        <h2>Save the current pin</h2>
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
              <button className="primary" onClick={() => go(l.lat, l.lng)} title="Move the pin here">
                <span className="name">{l.name}</span>
                <span className="detail">{formatLngLat(l, format)}</span>
              </button>
              <button className="link" onClick={() => worldStore.getState().setPin2({ lat: l.lat, lng: l.lng })} title="Use as the secondary pin for geodetics">
                pin 2
              </button>
              <button className="link" onClick={() => libraryStore.getState().remove(l.id)} title="Delete">
                delete
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
