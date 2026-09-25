import { useEffect, useState } from 'react';
import type { LngLat } from '@core/geo/geodesy';
import { AltitudeRef, ModelSource, type SavedModel } from '@core/model';
import { ModelOrigin, ModelUnit, type ImportOptions } from '@core/model/gltf';
import { importModelFile, placeDraft, type ModelImport } from '@core/model/share';
import { Units } from '@core/format';
import { groundUnder } from '@state/buildings';
import { modelsStore, useModels } from '@state/models';
import { useSettings } from '@state/settings';
import { worldStore } from '@state/world';

const UNITS = Object.values(ModelUnit);

const length = (m: number, units: Units) => (units === Units.Imperial ? `${(m * 3.28084).toFixed(1)} ft` : `${m.toFixed(m < 10 ? 2 : 1)} m`);

/** Picks a .glb, a .gltf, or a .gltf with its .bin files, then shows what it holds and where it will stand. */
export function ModelImportSheet({ files, onClose }: { files: File[]; onClose: () => void }) {
  const units = useSettings((s) => s.units);
  const importAt = useModels((s) => s.importAt);
  const importPick = useModels((s) => s.importPick);
  /** Null reads the file's own Scape options. */
  const [opts, setOpts] = useState<ImportOptions | null>(null);
  const [imp, setImp] = useState<ModelImport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [centre, setCentre] = useState<LngLat>(() => worldStore.getState().view.center);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    importModelFile(files, opts ?? undefined).then(
      (r) => {
        if (!live) return;
        setImp(r);
        setError(null);
        // A file Scape placed says where it stands, so there is nothing to choose.
        if (r.draft.anchor && opts === null) void place(r);
      },
      (e: unknown) => {
        if (!live) return;
        setImp(null);
        setError(e instanceof Error ? e.message : String(e));
      }
    );
    return () => {
      live = false;
    };
    // oxlint-disable-next-line react/exhaustive-deps -- placed once per parse, not per render's `place`
  }, [files, opts]);

  useEffect(
    () => () => {
      modelsStore.getState().setImportPick(false);
      modelsStore.setState({ importAt: null });
    },
    []
  );
  const at = importAt ? { where: importAt, label: 'the picked building' } : { where: centre, label: 'the map centre' };

  const shown = opts ?? imp?.draft.importOptions ?? null;
  const setOpt = (p: Partial<ImportOptions>) => shown && setOpts({ ...shown, ...p });
  const fromFile = !!imp?.draft.anchor && opts === null;
  const imported = imp?.draft.source === ModelSource.Imported;

  const place = async (r: ModelImport) => {
    const asIs = !!r.draft.anchor && opts === null;
    setBusy(true);
    try {
      const anchor = r.draft.anchor ?? {
        ...at.where,
        altRef: AltitudeRef.Ground,
        altM: 0,
        headingDeg: 0,
        scale: 1
      };
      // The file's own footprint as written, so a round trip keeps it byte for byte.
      const m: SavedModel = asIs ? { ...r.draft, anchor } : placeDraft(r, anchor);
      const groundM = await groundUnder(m.footprint.map(([lng, lat]) => ({ lng, lat }))).catch(() => null);
      await modelsStore.getState().importDraft({ ...m, groundM: groundM ?? NaN });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="model-import">
      <h3>Import {files.map((f) => f.name).join(' + ')}</h3>
      {imported && shown && (
        <div className="kv">
          <span className="k">Units</span>
          <b className="v">
            <select value={shown.units} onChange={(e) => setOpt({ units: e.target.value as ModelUnit })} aria-label="File units">
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </b>
          <span className="k">Origin</span>
          <b className="v">
            <select value={shown.origin} onChange={(e) => setOpt({ origin: e.target.value as ModelOrigin })} aria-label="Model origin">
              <option value={ModelOrigin.BaseCentre}>Base centre</option>
              <option value={ModelOrigin.Keep}>Keep file origin</option>
            </select>
          </b>
          <b className="v wide">
            <label className="toggle">
              <input type="checkbox" checked={shown.zUp} onChange={(e) => setOpt({ zUp: e.target.checked })} />
              <span>File is Z-up</span>
            </label>
          </b>
        </div>
      )}
      {error && (
        <p className="error" data-testid="import-error">
          {error}
        </p>
      )}
      {imp && (
        <div className="kv import-stats" data-testid="import-stats">
          <span className="k">Vertices</span>
          <b className="v">{imp.stats.vertices.toLocaleString('en')}</b>
          <span className="k">Triangles</span>
          <b className="v">{imp.stats.triangles.toLocaleString('en')}</b>
          <span className="k">Height</span>
          <b className="v">{length(imp.stats.heightM, units)}</b>
          <span className="k">Footprint</span>
          <b className="v">
            {length(imp.stats.widthM, units)} × {length(imp.stats.depthM, units)} <span className="muted">W × D</span>
          </b>
          <span className="k">Degenerate</span>
          <b className="v">{imp.degenerate.toLocaleString('en')} dropped</b>
          <span className="k">Place at</span>
          <b className="v">{imp.draft.anchor ? (fromFile ? 'where the file says' : 'where the file says, footprint redrawn') : at.label}</b>
        </div>
      )}
      {imp && imp.warnings.length > 0 && (
        <ul className="warnings">
          {imp.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <div className="actions">
        <button onClick={() => imp && void place(imp)} disabled={!imp || busy}>
          Place
        </button>
        {imp && !imp.draft.anchor && (
          <>
            <button className={importPick ? 'on' : ''} onClick={() => modelsStore.getState().setImportPick(!importPick)} title="Then click an Overture building on the map">
              {importPick ? 'Click a building…' : 'On a building'}
            </button>
            <button
              onClick={() => {
                modelsStore.setState({ importAt: null });
                setCentre(worldStore.getState().view.center);
              }}
            >
              At map centre
            </button>
          </>
        )}
        <button className="link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
