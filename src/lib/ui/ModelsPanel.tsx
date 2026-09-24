import { useState } from 'react';
import { compass, distance, height } from '@core/format';
import { bearingDeg, distanceM } from '@core/geo/geodesy';
import { modelBaseM, ModelSource, type ModelPart, type SavedModel } from '@core/model';
import { apexOf, applyNudge, azElTo, NUDGE_STEPS, NudgeKind, ringEdges, withEdgeBearing, withEdgeLength, withPart } from '@core/model/draw';
import { importedMesh, modelMesh, modelTopM } from '@core/model/mesh';
import { newPart, spirePart } from '@core/model/seed';
import { endpointHeightM } from '@core/terrain/los';
import { finishDraft, useModels, modelsStore } from '@state/models';
import { useSettings } from '@state/settings';
import { EYE_HEIGHT_M, useTerrain } from '@state/terrain';
import { useWorld, worldStore } from '@state/world';
import { RoofShape } from '@workers/buildings.protocol';
import { downloadBlob } from './download';
import { ModelImportSheet } from './ModelImport';
import { useMedia } from './useMedia';

const ROOFS = Object.entries(RoofShape) as [keyof typeof RoofShape, RoofShape][];

const num = (v: string, fallback: number) => (v.trim() === '' || !Number.isFinite(Number(v)) ? fallback : Number(v));
const fixed = (v: number, d: number) => Number(v.toFixed(d));
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}°`;

/** The phone's bottom sheet. */
const COMPACT = '(max-width: 900px)';

const NUDGE_ROWS: { kind: NudgeKind; label: string; unit: string }[] = [
  { kind: NudgeKind.East, label: 'East', unit: 'm' },
  { kind: NudgeKind.North, label: 'North', unit: 'm' },
  { kind: NudgeKind.Heading, label: 'Heading', unit: '°' },
  { kind: NudgeKind.Lift, label: 'Lift', unit: 'm' },
  { kind: NudgeKind.Height, label: 'Height', unit: 'm' }
];

/** A number typed freely and committed on Enter or blur, so rounding never fights the caret. */
function NumField({ value, onCommit, label, step }: { value: number; onCommit: (v: number) => void; label: string; step: number }) {
  const commit = (el: HTMLInputElement) => {
    const v = num(el.value, NaN);
    if (Number.isFinite(v) && v !== value) onCommit(v);
    else el.value = String(value);
  };
  // Keyed on the value so an outside change resets what is typed.
  return <input key={value} type="number" step={step} defaultValue={value} onBlur={(e) => commit(e.currentTarget)} onKeyDown={(e) => e.key === 'Enter' && commit(e.currentTarget)} aria-label={label} />;
}

export function ModelsPanel() {
  const models = useModels((s) => s.models);
  const loaded = useModels((s) => s.loaded);
  const selectedId = useModels((s) => s.selectedId);
  const picking = useModels((s) => s.picking);
  const pickError = useModels((s) => s.pickError);
  const draft = useModels((s) => s.draft);
  const rightAngles = useModels((s) => s.rightAngles);
  const compact = useMedia(COMPACT);
  const pin = useWorld((s) => s.pin);
  const units = useSettings((s) => s.units);
  const ms = modelsStore.getState();
  const selected = models.find((m) => m.id === selectedId) ?? null;
  const sorted = models.map((m) => ({ m, d: distanceM(pin, m.anchor) })).toSorted((a, b) => a.d - b.d);
  const [files, setFiles] = useState<File[] | null>(null);

  return (
    <div className="models">
      <div className="actions">
        <button className={picking ? 'on' : ''} onClick={() => ms.setPicking(!picking)} title="Then click an Overture building on the map to model it from its footprints">
          {picking ? 'Click a building…' : 'Model this building'}
        </button>
        <button className={draft ? 'on' : ''} onClick={() => ms.setDraft(draft ? null : [])} title="Tap its corners on the map">
          Draw a building
        </button>
        <label className="button file-pick" title="A .glb, a .gltf, or a .gltf with its .bin files picked together">
          Import GLB…
          <input
            type="file"
            className="model-file"
            accept=".glb,.gltf,.bin,model/gltf-binary,model/gltf+json"
            multiple
            onChange={(e) => {
              const picked = [...(e.currentTarget.files ?? [])];
              e.currentTarget.value = '';
              if (picked.length) setFiles(picked);
            }}
          />
        </label>
      </div>
      {files && <ModelImportSheet key={files.map((f) => f.name + f.lastModified).join('|')} files={files} onClose={() => setFiles(null)} />}
      {pickError && <p className="error">{pickError}</p>}
      {draft && (
        <div className="model-draft">
          <p className="muted hint">Tap the map to add corners; tap the first corner to close. Drag a corner to move it, hold it to delete it.</p>
          <div className="actions">
            <span className="count">
              {draft.length} corner{draft.length === 1 ? '' : 's'}
            </span>
            <label className="toggle">
              <input type="checkbox" checked={rightAngles} onChange={(e) => ms.setRightAngles(e.target.checked)} />
              <span>Right angles</span>
            </label>
            <button onClick={() => void finishDraft()} disabled={draft.length < 3}>
              Done
            </button>
            <button className="link" onClick={() => ms.setDraft(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {selected && <ModelEditor key={selected.id} m={selected} compact={compact} />}
      <h3>
        {models.length} model{models.length === 1 ? '' : 's'}
      </h3>
      {loaded && models.length === 0 && <p className="muted hint">A model replaces the rough Overture shape of one building with parts you size yourself, so its crown, spire and shadow line up in the viewfinder.</p>}
      <ul className="list model-list">
        {sorted.map(({ m, d }) => (
          <li key={m.id} className={m.id === selectedId ? 'selected' : ''} onClick={() => ms.select(m.id === selectedId ? null : m.id)}>
            <span className="name">
              {m.name}
              {!m.visible && <span className="muted"> · hidden</span>}
            </span>
            <span className="where">
              {distance(d, units)} {compass(bearingDeg(pin, m.anchor))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Where the model's top stands and how high above the geoid. */
function modelApex(m: SavedModel): {
  at: { lng: number; lat: number };
  aboveGroundM: number;
  absM: number;
} | null {
  const a = apexOf(m, modelMesh(m).pos);
  if (!a) return null;
  const absM = modelBaseM(m.anchor, m.groundM) - m.anchor.altM + a.aboveGroundM;
  return {
    at: a.at,
    absM,
    aboveGroundM: absM - Math.max(Number.isNaN(m.groundM) ? 0 : m.groundM, 0)
  };
}

function NudgePad({ m, partId }: { m: SavedModel; partId: string | null }) {
  const adjusting = useModels((s) => s.adjusting);
  const ms = modelsStore.getState();
  const part = m.parts?.find((p) => p.id === partId) ?? null;
  const value: Record<NudgeKind, string> = {
    East: '',
    North: '',
    Heading: `${fixed(m.anchor.headingDeg, 2)}°`,
    Lift: `${fixed(m.anchor.altM, 1)} m`,
    Height: part ? `${fixed(part.heightM, 1)} m` : ''
  };
  return (
    <div className="nudge-pad">
      {NUDGE_ROWS.map(({ kind, label, unit }) => {
        const [fine, coarse] = NUDGE_STEPS[kind];
        const disabled = kind === NudgeKind.Height && !m.parts;
        return (
          <div className="nudge-row" key={kind}>
            <span className="k">{label}</span>
            {[-coarse, -fine, fine, coarse].map((by) => (
              <button key={by} disabled={disabled} onClick={() => void ms.update(m.id, applyNudge(m, { kind, by }, partId))} aria-label={`${label} ${by > 0 ? '+' : '−'}${Math.abs(by)} ${unit}`}>
                {by > 0 ? '+' : '−'}
                {Math.abs(by)}
              </button>
            ))}
            <span className="v muted">{value[kind]}</span>
          </div>
        );
      })}
      <label className="toggle" title="Arrows move it, Alt+arrows turn and lift it, Shift for the big step">
        <input type="checkbox" checked={adjusting} onChange={(e) => ms.setAdjusting(e.target.checked)} />
        <span>Arrow keys adjust it in the viewfinder</span>
      </label>
    </div>
  );
}

/** The apex's bearing and elevation from the eye beside the ones measured in a photo. */
function ApexReadout({ m }: { m: SavedModel }) {
  const pin = useWorld((s) => s.pin);
  const pinHeightM = useWorld((s) => s.pinHeightM);
  const pinGroundM = useTerrain((s) => s.pinGroundM);
  const [az, setAz] = useState('');
  const [el, setEl] = useState('');
  const apex = modelApex(m);
  if (!apex) return null;
  const eye = endpointHeightM(Number.isNaN(pinGroundM ?? NaN) ? 0 : (pinGroundM ?? 0), pinHeightM + EYE_HEIGHT_M);
  const at = azElTo(pin, apex.at, apex.absM - eye);
  const dAz = az.trim() === '' ? null : ((((at.azDeg - num(az, 0)) % 360) + 540) % 360) - 180;
  const dEl = el.trim() === '' ? null : at.elDeg - num(el, 0);
  return (
    <div className="kv apex">
      <span className="k">Apex</span>
      <b className="v">
        az {at.azDeg.toFixed(2)}° · el {at.elDeg.toFixed(2)}°
      </b>
      <span className="k">Measured</span>
      <b className="v">
        <input type="number" step={0.01} value={az} placeholder="az" onChange={(e) => setAz(e.target.value)} aria-label="Measured apex azimuth, degrees" />
        <input type="number" step={0.01} value={el} placeholder="el" onChange={(e) => setEl(e.target.value)} aria-label="Measured apex elevation, degrees" />
      </b>
      {(dAz != null || dEl != null) && (
        <>
          <span className="k">Off by</span>
          <b className="v" data-testid="apex-delta">
            {dAz != null && `az ${signed(dAz)}`}
            {dAz != null && dEl != null && ' · '}
            {dEl != null && `el ${signed(dEl)}`}
          </b>
        </>
      )}
    </div>
  );
}

function EdgeTable({ m, part }: { m: SavedModel; part: ModelPart }) {
  const ms = modelsStore.getState();
  const setRing = (ring: [number, number][]) => void ms.update(m.id, { parts: withPart(m.parts!, part.id, { ring }) });
  return (
    <table className="parts edges">
      <thead>
        <tr>
          <th>Edge</th>
          <th title="Metres">Length</th>
          <th title="Degrees from true north">Bearing</th>
        </tr>
      </thead>
      <tbody>
        {ringEdges(part.ring, m.anchor).map((e, i) => (
          <tr key={part.ring[i].join()}>
            <td>{i + 1}</td>
            <td>
              <NumField value={fixed(e.lengthM, 2)} step={0.1} onCommit={(v) => setRing(withEdgeLength(part.ring, i, v, m.anchor))} label={`Edge ${i + 1} length, metres`} />
            </td>
            <td>
              <NumField value={fixed(e.bearingDeg, 1)} step={1} onCommit={(v) => setRing(withEdgeBearing(part.ring, i, v, m.anchor))} label={`Edge ${i + 1} bearing, degrees`} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ModelEditor({ m, compact }: { m: SavedModel; compact: boolean }) {
  const units = useSettings((s) => s.units);
  const selectedPartId = useModels((s) => s.selectedPartId);
  const ms = modelsStore.getState();
  const patch = (p: Partial<SavedModel>) => void ms.update(m.id, p);
  const parts = m.parts ?? [];
  const setPart = (id: string, p: Partial<ModelPart>) => patch({ parts: withPart(parts, id, p) });
  const current = parts.find((p) => p.id === selectedPartId) ?? null;
  const drawn = m.source === ModelSource.Drawn;
  const [withParts, setWithParts] = useState(true);
  const [exportError, setExportError] = useState<string | null>(null);
  const exportGlb = () => {
    setExportError(null);
    try {
      const out = ms.exportGlb(m.id, drawn && withParts);
      if (!out) return;
      const { fileName, glb } = out;
      downloadBlob(fileName, new Blob([glb], { type: 'model/gltf-binary' }));
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    }
  };
  const targetTop = () => {
    const a = modelApex(m);
    if (!a) return;
    const w = worldStore.getState();
    w.setPin2(a.at);
    w.setPin2Height(fixed(a.aboveGroundM, 1), true, m.name);
  };
  const pad = <NudgePad m={m} partId={current?.id ?? null} />;
  return (
    <div className={compact ? 'model-editor compact' : 'model-editor'}>
      {compact && pad}
      <div className="kv">
        <span className="k">Name</span>
        <b className="v">
          <input type="text" value={m.name} onChange={(e) => patch({ name: e.target.value })} aria-label="Model name" />
        </b>
        <span className="k">Top</span>
        <b className="v">
          {height(modelTopM(m) * m.anchor.scale + m.anchor.altM, units)}{' '}
          <span className="muted">
            above ground
            {Number.isNaN(m.groundM) ? '' : ` · ground ${height(m.groundM, units)}`}
          </span>
        </b>
        {!drawn && m.glb && (
          <>
            <span className="k">Mesh</span>
            <b className="v">{(importedMesh(m.glb, m.importOptions).mesh.idx.length / 3).toLocaleString('en')} triangles</b>
          </>
        )}
        <span className="k">Lift</span>
        <b className="v">
          <input type="number" step={0.1} value={m.anchor.altM} onChange={(e) => patch({ anchor: { ...m.anchor, altM: num(e.target.value, 0) } })} aria-label="Model base above ground, metres" />
          <span className="muted">m above ground</span>
        </b>
        <b className="v wide">
          <label className="toggle">
            <input type="checkbox" checked={m.visible} onChange={(e) => patch({ visible: e.target.checked })} />
            <span>Show in the viewfinder</span>
          </label>
        </b>
        <b className="v wide">
          <label className="toggle">
            <input type="checkbox" checked={m.suppressOverture} onChange={(e) => patch({ suppressOverture: e.target.checked })} />
            <span>Hide the Overture buildings under it</span>
          </label>
        </b>
      </div>
      {drawn && (
        <>
          <h3>
            {parts.length} part{parts.length === 1 ? '' : 's'}
          </h3>
          <table className="parts">
            <thead>
              <tr>
                <th title="Bottom above the model's base, metres">Base</th>
                <th title="Top above the model's base, metres">Top</th>
                <th>Roof</th>
                <th title="Roof height, metres; blank picks one">Roof h</th>
                <th title="Roof direction, degrees from north; blank picks one">Dir</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {parts.map((p, i) => (
                <tr key={p.id} className={p.id === selectedPartId ? 'current' : ''} onClick={() => ms.selectPart(p.id)}>
                  <td>
                    <input type="number" step={1} value={p.baseM} onChange={(e) => setPart(p.id, { baseM: num(e.target.value, 0) })} aria-label={`Part ${i + 1} base, metres`} />
                  </td>
                  <td>
                    <input
                      type="number"
                      step={1}
                      value={p.heightM}
                      onChange={(e) =>
                        setPart(p.id, {
                          heightM: num(e.target.value, p.heightM)
                        })
                      }
                      aria-label={`Part ${i + 1} top, metres`}
                    />
                  </td>
                  <td>
                    <select
                      value={p.roof}
                      onChange={(e) =>
                        setPart(p.id, {
                          roof: Number(e.target.value) as RoofShape
                        })
                      }
                      aria-label={`Part ${i + 1} roof shape`}
                    >
                      {ROOFS.map(([name, code]) => (
                        <option key={code} value={code}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={p.roofHeightM || ''}
                      placeholder="auto"
                      onChange={(e) =>
                        setPart(p.id, {
                          roofHeightM: Math.max(0, num(e.target.value, 0))
                        })
                      }
                      aria-label={`Part ${i + 1} roof height, metres`}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step={1}
                      value={Number.isNaN(p.roofDirDeg) ? '' : p.roofDirDeg}
                      placeholder="auto"
                      onChange={(e) => setPart(p.id, { roofDirDeg: num(e.target.value, NaN) })}
                      aria-label={`Part ${i + 1} roof direction, degrees`}
                    />
                  </td>
                  <td>
                    <button className="link" onClick={() => patch({ parts: parts.filter((q) => q.id !== p.id) })} aria-label={`Delete part ${i + 1}`} disabled={parts.length <= 1}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="actions">
            <button onClick={() => patch({ parts: [...parts, newPart(parts[0] ?? null)] })} title="A copy of the tallest part to reshape">
              Add part
            </button>
            <button onClick={() => patch({ parts: [...parts, spirePart(parts)] })} title="A thin pyramid on top of the tallest part">
              Add spire
            </button>
          </div>
          {current && (
            <details className="edges-box" open={!compact}>
              <summary>Edges of part {parts.indexOf(current) + 1}</summary>
              <EdgeTable m={m} part={current} />
            </details>
          )}
        </>
      )}
      {!compact && pad}
      <ApexReadout m={m} />
      <div className="actions">
        <button onClick={targetTop} title="Put the target on this model's highest point">
          Set target to model top
        </button>
        <button onClick={() => worldStore.getState().flyTo(m.anchor, Math.max(worldStore.getState().view.zoom, 15))}>Show on map</button>
        <button className="link" onClick={() => void ms.remove(m.id)}>
          Delete model
        </button>
      </div>
      <div className="actions">
        <button onClick={exportGlb} title="A .glb with its place in it, for Blender or another Scape">
          Export GLB
        </button>
        {drawn && (
          <label className="toggle">
            <input type="checkbox" checked={withParts} onChange={(e) => setWithParts(e.target.checked)} />
            <span>with parts</span>
          </label>
        )}
      </div>
      {exportError && <p className="error">{exportError}</p>}
      <p className="muted hint">{m.attribution}</p>
    </div>
  );
}
