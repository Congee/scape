import { useState } from 'react';
import { SENSORS } from '@core/optics/fov';
import { DEFAULT_FOCALS, gearStore, lensById, useGear } from '@state/gear';

/** Custom sensor formats and the focal-length quick picks. */
export function GearSettings() {
  const cameras = useGear((s) => s.cameras);
  const lenses = useGear((s) => s.lenses);
  const focals = useGear((s) => s.focalPresets);
  const kits = useGear((s) => s.kits);
  const [name, setName] = useState('');
  const [w, setW] = useState('');
  const [h, setH] = useState('');
  const [focalText, setFocalText] = useState(focals.join(', '));

  const add = () => {
    const wi = Number(w);
    const he = Number(h);
    if (!name.trim() || !(wi > 0) || !(he > 0)) return;
    gearStore.getState().addCamera({ name: name.trim(), widthMm: Math.max(wi, he), heightMm: Math.min(wi, he) });
    setName('');
    setW('');
    setH('');
  };
  const applyFocals = () => {
    const list = focalText
      .split(/[,\s]+/)
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0);
    gearStore.getState().setFocalPresets(list.length ? list : DEFAULT_FOCALS);
    setFocalText((list.length ? [...new Set(list)].toSorted((a, b) => a - b) : DEFAULT_FOCALS).join(', '));
  };

  return (
    <section>
      <h2>Gear</h2>
      <p className="muted">
        Built in: {SENSORS.map((s) => s.name).join(' · ')}. Search the camera and lens catalogue in the Frame tab, or add a sensor size by hand below.
      </p>
      <ul className="list">
        {cameras.map((c) => (
          <li key={c.id}>
            <span>
              {c.name}{' '}
              <span className="meta">
                {c.widthMm} × {c.heightMm} mm{c.pixelsWide ? ` · ${c.pixelsWide} px wide` : ''}
              </span>
            </span>
            <button className="link" onClick={() => gearStore.getState().removeCamera(c.id)}>
              remove
            </button>
          </li>
        ))}
      </ul>
      <div className="field-row">
        <input placeholder="Camera name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Camera name" />
        <input type="number" placeholder="width mm" value={w} onChange={(e) => setW(e.target.value)} aria-label="Sensor width, millimetres" style={{ flex: '0 0 90px' }} />
        <input type="number" placeholder="height mm" value={h} onChange={(e) => setH(e.target.value)} aria-label="Sensor height, millimetres" style={{ flex: '0 0 90px' }} />
        <button onClick={add} disabled={!name.trim() || !(Number(w) > 0) || !(Number(h) > 0)}>
          Add
        </button>
      </div>
      <h3>Lenses</h3>
      {lenses.length === 0 && <p className="muted">No lenses yet; pick them from the search in the Frame tab.</p>}
      <ul className="list">
        {lenses.map((l) => (
          <li key={l.id}>
            <span>
              {l.name}{' '}
              <span className="meta">
                {l.minMm === l.maxMm ? `${l.minMm} mm` : `${l.minMm}–${l.maxMm} mm`} f/{l.maxAperture} · {l.mount}
              </span>
            </span>
            <button className="link" onClick={() => gearStore.getState().removeLens(l.id)}>
              remove
            </button>
          </li>
        ))}
      </ul>
      <h3>Kits</h3>
      {kits.length === 0 && <p className="muted">No kits yet; save a camera and lens pairing from the Frame tab.</p>}
      <ul className="list">
        {kits.map((k) => {
          const cam = cameras.find((x) => x.id === k.cameraId);
          const lens = lensById(k.lensId, lenses);
          return (
            <li key={k.id}>
              <span>
                <input value={k.name} onChange={(e) => gearStore.getState().renameKit(k.id, e.target.value)} aria-label="Kit name" style={{ flex: 1 }} />{' '}
                <span className="meta">
                  {cam?.name ?? 'camera removed'}
                  {lens ? ` · ${lens.name}` : ''}
                </span>
              </span>
              <button className="link" onClick={() => gearStore.getState().removeKit(k.id)}>
                remove
              </button>
            </li>
          );
        })}
      </ul>
      <label className="field">
        <span>Focal length quick picks (mm)</span>
        <input value={focalText} onChange={(e) => setFocalText(e.target.value)} onBlur={applyFocals} onKeyDown={(e) => e.key === 'Enter' && applyFocals()} aria-label="Focal length presets" style={{ flex: 1 }} />
      </label>
    </section>
  );
}
