import { useEffect, useRef, useState } from 'react';
import { fitToLens, type LensSpec } from '@core/optics/fov';
import { gearTokens, longApertureOf, searchGear } from '@core/optics/gearSearch';
import type { CameraRow, LensRow } from '@data/gearCatalog';
import { compositionStore, useComposition } from '@state/composition';
import { gearStore, sensorById, useGear } from '@state/gear';

interface Catalog {
  cameras: readonly CameraRow[];
  lenses: readonly LensRow[];
}

let catalog: Promise<Catalog> | null = null;
const loadCatalog = () => (catalog ??= import('@data/gearCatalog').then((m) => ({ cameras: m.CAMERAS, lenses: m.LENSES })));

export const cameraId = (r: CameraRow) => `cat:${r[0]} ${r[1]}`;
export const lensId = (r: LensRow) => `cat:${r[0]} ${r[1]} (${r[5]})`;

/** The catalogue carries only the short-end aperture; the long end is spelled out in the model name. */
export function lensSpecOf(r: LensRow): LensSpec {
  const long = longApertureOf(r[1]);
  const spec: LensSpec = { id: lensId(r), name: `${r[0]} ${r[1]}`, minMm: r[2], maxMm: r[3], maxAperture: r[4], mount: r[5] };
  return long && long > r[4] ? { ...spec, maxApertureLong: long } : spec;
}

export function GearSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Catalog | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const cameras = useGear((s) => s.cameras);
  const sensorId = useComposition((s) => s.sensorId);
  const mount = sensorById(sensorId, cameras).mount;

  useEffect(() => {
    if (!open || data) return;
    void loadCatalog().then(setData);
  }, [open, data]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  const tokens = gearTokens(q);
  const camHits = data ? searchGear(data.cameras, (r) => `${r[0]} ${r[1]} ${r[5]}`, tokens, () => 0, 6) : [];
  const lensHits = data ? searchGear(data.lenses, (r) => `${r[0]} ${r[1]} ${r[5]}`, tokens, (r) => (mount && r[5] === mount ? 3 : 0), 8) : [];

  const pickCamera = (r: CameraRow) => {
    const id = gearStore.getState().addCamera({ id: cameraId(r), name: `${r[0]} ${r[1]}`, widthMm: r[2], heightMm: r[3], pixelsWide: r[4], mount: r[5] });
    compositionStore.getState().update({ sensorId: id });
    setOpen(false);
    setQ('');
  };
  const pickLens = (r: LensRow) => {
    const spec = lensSpecOf(r);
    const id = gearStore.getState().addLens(spec);
    const c = compositionStore.getState();
    c.update({ lensId: id, ...fitToLens(spec, c.focalMm, c.fNumber) });
    setOpen(false);
    setQ('');
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'Enter') {
      if (camHits[0]) pickCamera(camHits[0]);
      else if (lensHits[0]) pickLens(lensHits[0]);
    }
  };

  return (
    <div className="gear-search" ref={box}>
      <input
        placeholder="Search cameras and lenses… (e.g. a7 iv, 24-70 2.8)"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        aria-label="Search the camera and lens catalogue"
      />
      {open && tokens.length > 0 && (
        <div className="gear-results" role="listbox">
          {!data && <p className="muted hint">Loading the catalogue…</p>}
          {data && camHits.length === 0 && lensHits.length === 0 && <p className="muted hint">Nothing matches. Add a sensor size by hand in Settings.</p>}
          {camHits.length > 0 && <div className="group">Cameras</div>}
          {camHits.map((r) => (
            <button key={cameraId(r)} role="option" aria-selected={false} onClick={() => pickCamera(r)}>
              {r[0]} {r[1]}
              <span className="meta">
                {r[2]} × {r[3]} mm · {Math.round((r[4] * r[4] * (r[3] / r[2])) / 1e5) / 10} MP · {r[5] === 'fixed' ? 'fixed lens' : `${r[5]} mount`} · {r[6]}
              </span>
            </button>
          ))}
          {lensHits.length > 0 && <div className="group">Lenses</div>}
          {lensHits.map((r) => (
            <button key={lensId(r)} role="option" aria-selected={false} onClick={() => pickLens(r)}>
              {r[0]} {r[1]}
              <span className="meta">
                {r[2] === r[3] ? `${r[2]} mm` : `${r[2]}–${r[3]} mm`} · f/{r[4]}
                {lensSpecOf(r).maxApertureLong ? `–${lensSpecOf(r).maxApertureLong}` : ''} · {r[5] === 'fixed' ? 'fixed' : `${r[5]} mount`}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
