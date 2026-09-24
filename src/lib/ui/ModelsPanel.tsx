import { compass, distance, height } from '@core/format';
import { bearingDeg, distanceM } from '@core/geo/geodesy';
import type { ModelPart, SavedModel } from '@core/model';
import { modelHeightAt } from '@core/model/heightAt';
import { modelApexM, newPart, spirePart } from '@core/model/seed';
import { useModels, modelsStore } from '@state/models';
import { useSettings } from '@state/settings';
import { useWorld, worldStore } from '@state/world';
import { RoofShape } from '@workers/buildings.protocol';

const ROOFS = Object.entries(RoofShape) as [keyof typeof RoofShape, RoofShape][];

const num = (v: string, fallback: number) => (v.trim() === '' || !Number.isFinite(Number(v)) ? fallback : Number(v));

export function ModelsPanel() {
  const models = useModels((s) => s.models);
  const loaded = useModels((s) => s.loaded);
  const selectedId = useModels((s) => s.selectedId);
  const picking = useModels((s) => s.picking);
  const pickError = useModels((s) => s.pickError);
  const pin = useWorld((s) => s.pin);
  const units = useSettings((s) => s.units);
  const ms = modelsStore.getState();
  const selected = models.find((m) => m.id === selectedId) ?? null;
  const sorted = models.map((m) => ({ m, d: distanceM(pin, m.anchor) })).toSorted((a, b) => a.d - b.d);

  return (
    <div className="models">
      <div className="actions">
        <button className={picking ? 'on' : ''} onClick={() => ms.setPicking(!picking)} title="Then click an Overture building on the map to model it from its footprints">
          {picking ? 'Click a building…' : 'Model this building'}
        </button>
      </div>
      {pickError && <p className="error">{pickError}</p>}
      {selected && <ModelEditor key={selected.id} m={selected} />}
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

function ModelEditor({ m }: { m: SavedModel }) {
  const units = useSettings((s) => s.units);
  const ms = modelsStore.getState();
  const patch = (p: Partial<SavedModel>) => void ms.update(m.id, p);
  const parts = m.parts ?? [];
  const setPart = (id: string, p: Partial<ModelPart>) => patch({ parts: parts.map((q) => (q.id === id ? { ...q, ...p } : q)) });
  const useAsTarget = () => {
    const w = worldStore.getState();
    w.setPin2({ lat: m.anchor.lat, lng: m.anchor.lng });
    const h = modelHeightAt([m], m.anchor);
    if (h) w.setPin2Height(Math.round(h.heightM), true, m.name);
  };
  return (
    <div className="model-editor">
      <div className="kv">
        <span className="k">Name</span>
        <b className="v">
          <input type="text" value={m.name} onChange={(e) => patch({ name: e.target.value })} aria-label="Model name" />
        </b>
        <span className="k">Top</span>
        <b className="v">
          {height(modelApexM(parts) * m.anchor.scale + m.anchor.altM, units)} <span className="muted">above ground{Number.isNaN(m.groundM) ? '' : ` · ground ${height(m.groundM, units)}`}</span>
        </b>
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
            <tr key={p.id}>
              <td>
                <input type="number" step={1} value={p.baseM} onChange={(e) => setPart(p.id, { baseM: num(e.target.value, 0) })} aria-label={`Part ${i + 1} base, metres`} />
              </td>
              <td>
                <input type="number" step={1} value={p.heightM} onChange={(e) => setPart(p.id, { heightM: num(e.target.value, p.heightM) })} aria-label={`Part ${i + 1} top, metres`} />
              </td>
              <td>
                <select value={p.roof} onChange={(e) => setPart(p.id, { roof: Number(e.target.value) as RoofShape })} aria-label={`Part ${i + 1} roof shape`}>
                  {ROOFS.map(([name, code]) => (
                    <option key={code} value={code}>
                      {name}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input type="number" min={0} step={1} value={p.roofHeightM || ''} placeholder="auto" onChange={(e) => setPart(p.id, { roofHeightM: Math.max(0, num(e.target.value, 0)) })} aria-label={`Part ${i + 1} roof height, metres`} />
              </td>
              <td>
                <input type="number" step={1} value={Number.isNaN(p.roofDirDeg) ? '' : p.roofDirDeg} placeholder="auto" onChange={(e) => setPart(p.id, { roofDirDeg: num(e.target.value, NaN) })} aria-label={`Part ${i + 1} roof direction, degrees`} />
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
      <div className="actions">
        <button onClick={useAsTarget} title="Aim at this model's top">
          Use as target
        </button>
        <button onClick={() => worldStore.getState().flyTo(m.anchor, Math.max(worldStore.getState().view.zoom, 15))}>Show on map</button>
        <button className="link" onClick={() => void ms.remove(m.id)}>
          Delete model
        </button>
      </div>
      <p className="muted hint">{m.attribution}</p>
    </div>
  );
}
