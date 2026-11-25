import { anyOccluder, MeshOccluder, type Occluder } from '@core/geo/meshOcclude';
import { placeModel } from '@core/geo/modelPlace';
import { PrismOccluder } from '@core/geo/prismOcclude';
import { prismFrameKey, type PrismShading, type PrismTile } from '@core/geo/prismRaster';
import type { SurfaceMesh } from '@core/geo/surfaces';
import { modelMesh } from '@core/model/mesh';
import { buildingsStore, stopBuildings } from '@state/buildings';
import { compositionStore } from '@state/composition';
import { lod2HeldStats, lod2Store } from '@state/lod2';
import { modelsStore } from '@state/models';
import { settingsStore } from '@state/settings';
import { worldStore } from '@state/world';
import type { Scene } from './paint';
import { BUILDING_RANGE_M } from './viewWindow';

/** Buildings, LoD2 meshes and models placed around the eye, for the picture pass and object occlusion. */
export class BuildingLayer {
  /** Eye-relative prisms per tile, only those placed for the current camera location. */
  private prisms = new Map<string, PrismTile>();
  private prismSrc: { frame: string; tiles: unknown } | null = null;
  /** Overture rows the LoD2 and model footprints hid, over the tiles drawn. */
  private prismHidden = 0;
  /** One index per LoD2 tile, so a tile streaming in does not re-index the others. */
  private lod2Occ = new WeakMap<SurfaceMesh, MeshOccluder>();
  private occCache: { key: string; occ: Occluder | null } | null = null;
  /** Bumps whenever `prisms` changes, so the prism index is rebuilt only then. */
  private prismRev = 0;
  private meshOccCache: { key: string; occ: MeshOccluder | null } | null = null;
  private anyOccCache: { key: string; occ: Occluder | null } | null = null;
  /** Placed models, rebuilt when the camera location or any model changes. */
  private modelCache: { key: string; meshes: SurfaceMesh[]; ids: string[] } | null = null;

  get models() {
    return this.modelCache;
  }

  /** Prisms the worker placed for the current camera location; a tile from an old one waits for its rebuild. */
  private prismTiles(sc: Scene): Map<string, PrismTile> {
    const frame = prismFrameKey(worldStore.getState().pin, sc.eyeM);
    const { tiles } = buildingsStore.getState();
    // The store replaces its map on change, so the same identity means nothing new.
    if (this.prismSrc?.frame === frame && this.prismSrc.tiles === tiles) return this.prisms;
    this.prismSrc = { frame, tiles };
    this.prisms = new Map();
    this.prismHidden = 0;
    for (const [k, t] of tiles) {
      if (t.frame !== frame) continue;
      this.prisms.set(k, t.prism);
      this.prismHidden += t.hidden;
    }
    this.prismRev++;
    return this.prisms;
  }

  /** Visible models in the same eye-relative frame as the prisms. */
  private modelSurfaces(sc: Scene): SurfaceMesh[] {
    const w = worldStore.getState();
    const { models, rev } = modelsStore.getState();
    const key = `${w.pin.lat.toFixed(6)},${w.pin.lng.toFixed(6)}|${sc.eyeM.toFixed(2)}|${rev}`;
    if (this.modelCache?.key !== key) {
      const meshes: SurfaceMesh[] = [];
      const ids: string[] = [];
      for (const m of models) {
        const mesh = m.visible ? modelMesh(m) : null;
        if (!mesh || mesh.idx.length === 0) continue;
        meshes.push(placeModel(mesh, m.anchor, m.groundM, w.pin, sc.eyeM));
        ids.push(m.id);
      }
      this.modelCache = { key, meshes, ids };
    }
    return this.modelCache.meshes;
  }

  /** Placed LoD2 meshes; they share the models' pass, index and shadows. */
  private lod2Surfaces(): SurfaceMesh[] {
    return [...lod2Store.getState().tiles.values()].map((t) => t.mesh);
  }

  /** Tiles and shading for the GPU prism pass, or null when buildings are off or none have arrived. */
  glPrisms(sc: Scene, hazeRgb: readonly number[]): { tiles: Iterable<PrismTile>; models: Iterable<SurfaceMesh>; shading: PrismShading } | null {
    if (!compositionStore.getState().showBuildings || !settingsStore.getState().terrain) return null;
    const tiles = this.prismTiles(sc);
    const models = [...this.modelSurfaces(sc), ...this.lod2Surfaces()];
    if (tiles.size === 0 && models.length === 0) return null;
    const lightAzDeg = sc.light?.azimuthDeg ?? sc.aim.azimuthDeg + 135;
    const rangeM = Math.min(sc.view?.rangeM ?? BUILDING_RANGE_M, BUILDING_RANGE_M);
    return { tiles: [...tiles.values()], models, shading: { lightAzDeg, hazeRgb, night: sc.night, rangeM } };
  }

  /** Index of the same prisms the picture draws; it only changes when the tiles or the camera move. */
  occluder(sc: Scene): Occluder | null {
    if (!compositionStore.getState().showBuildings || !settingsStore.getState().terrain) return null;
    const tiles = this.prismTiles(sc);
    const models = this.modelSurfaces(sc);
    const lod2 = this.lod2Surfaces();
    if (tiles.size === 0 && models.length === 0 && lod2.length === 0) return null;
    const rangeM = Math.min(sc.view?.rangeM ?? BUILDING_RANGE_M, BUILDING_RANGE_M);
    const key = `${this.prismRev}|${rangeM}`;
    const modelKey = this.modelCache?.key ?? '';
    // Separate caches: tiles streaming in must not re-index a large imported mesh.
    if (this.meshOccCache?.key !== modelKey) this.meshOccCache = { key: modelKey, occ: models.length > 0 ? new MeshOccluder(models) : null };
    if (this.occCache?.key !== key) this.occCache = { key, occ: tiles.size > 0 ? new PrismOccluder(tiles.values(), rangeM) : null };
    const both = `${key}|${modelKey}|${lod2Store.getState().version}`;
    if (this.anyOccCache?.key !== both) {
      const lod2Occ = [...lod2Store.getState().tiles.values()].map((t) => {
        let occ = this.lod2Occ.get(t.mesh);
        if (!occ) this.lod2Occ.set(t.mesh, (occ = new MeshOccluder(t.occ)));
        return occ;
      });
      this.anyOccCache = { key: both, occ: anyOccluder([this.occCache.occ, this.meshOccCache.occ, ...lod2Occ]) };
    }
    return this.anyOccCache.occ;
  }

  lod2Stats() {
    const l = lod2Store.getState();
    return { tiles: l.tiles.size, tris: l.tris, buildMs: l.buildMs, busy: l.busy, missing: l.missing, error: l.error, hiddenRows: this.prismHidden, held: lod2HeldStats() };
  }

  dispose() {
    stopBuildings();
  }
}
