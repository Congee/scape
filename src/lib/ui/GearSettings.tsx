import { useState } from 'react';
import { SENSORS } from '@core/optics/fov';
import { DEFAULT_FOCALS, gearStore, useGear } from '@state/gear';

/** Custom sensor formats and the focal-length quick picks. */
export function GearSettings() {
  const cameras = useGear((s) => s.cameras);
  const focals = useGear((s) => s.focalPresets);
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
        Built in: {SENSORS.map((s) => s.name).join(' · ')}. Add your own sensor size below; it appears in the Frame panel.
      </p>
      <ul className="list">
        {cameras.map((c) => (
          <li key={c.id}>
            <span>
              {c.name} <span className="meta">{c.widthMm} × {c.heightMm} mm</span>
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
      <label className="field">
        <span>Focal length quick picks (mm)</span>
        <input value={focalText} onChange={(e) => setFocalText(e.target.value)} onBlur={applyFocals} onKeyDown={(e) => e.key === 'Enter' && applyFocals()} aria-label="Focal length presets" style={{ flex: 1 }} />
      </label>
    </section>
  );
}
