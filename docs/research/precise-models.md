# Precise building models — design (2026-09-24)

In-app modelling (C) and glTF import (B), per PLAN §8. Both become the GPU input the Overture
prisms already use — one plane per triangle, eye-relative metres, curvature drop applied — so
per-pixel plane depth, terrain/sky occlusion via the G-buffer, cascades and `boxCastsInto` come free.

## 1. Data model and storage

`src/lib/core/model.ts`:
```ts
export const ModelSource = { Drawn: 'Drawn', Imported: 'Imported' } as const;
export const AltitudeRef = { Ground: 'Ground', Absolute: 'Absolute' } as const;
export interface ModelAnchor { lat: number; lng: number; altRef: AltitudeRef; altM: number; headingDeg: number; scale: number }
export interface ModelPart { id: string; ring: [e: number, n: number][]; baseM: number; heightM: number; roof: RoofShape; roofHeightM: number; roofDirDeg: number; roofAcross: 0 | 1 }
export interface ModelMesh { pos: Float32Array; idx: Uint32Array; box: Float32Array }
export interface SavedModel { id; name; source: ModelSource; anchor: ModelAnchor; parts?: ModelPart[]; glb?: ArrayBuffer; footprint: [lng: number, lat: number][]; suppressOverture: boolean; visible: boolean; attribution: string; notes; createdAt; updatedAt }
```
- Local frame: ENU tangent plane at the anchor, metres, U = 0 at the anchor altitude.
- `AltitudeRef.Ground` = lowest DEM sample under the footprint + `altM` (same rule as `groundForRows`).
- Source of truth: Drawn → `parts` (rebuilt with `roofs.ts#buildRoof`); Imported → original `glb`
  bytes, re-parsed on load. `ModelMesh` is derived, never stored.
- IndexedDB `models` store in `data/db.ts` (schema v4, `byName` index); Zustand `state/models.ts` with a `rev`.
- Sharing: `exportModelGlb(m)` writes `asset.extras.scape = { anchor, footprint, parts? }`;
  `ScapeExport` gains `models` (GLB base64); `isScapeExport`/`importAll` extended.

## 2. GLB/glTF import (`core/model/gltf.ts`, pure, no dependency)

- GLB v2 (magic/JSON/BIN chunks, length and alignment checks); `.gltf` with `data:` URIs; `.gltf` + `.bin` picked together.
- `scene` or scene 0; node `matrix`/TRS composed in Float64; primitive mode 4 as-is, 5/6 triangulated, points/lines skipped with a warning.
- `POSITION` only (FLOAT VEC3, `byteStride` honoured); indices u8/u16/u32/none. Materials, normals, UVs ignored; double-sided.
- Reject sparse accessors and any `extensionsRequired`. Draco/meshopt get: "Compressed mesh (Draco/meshopt) is not supported. Re-export from Blender with Compression off, or run `gltf-transform copy in.glb out.glb`."
- Axes: E = x, N = −z, U = y. Import sheet: units (m, cm, mm, ft, in), "File is Z-up", origin "Base centre" (default) or "Keep file origin".
- `validateMesh`: finite positions, indices in range, degenerate triangles dropped and counted, 500 k triangle cap, warn if largest dimension < 1 m or > 2 km.
- Sheet shows vertices, triangles, height, footprint W×D before placing.
- `extras.scape` → auto-place; else drop at map centre or the clicked Overture building's centroid; `footprint` defaults to the plan-view convex hull.

## 3. In-app modelling UX

Markers tab gets a "Markers | Models" segmented switch (no new peek-bar tab). One inspector component with a `compact` prop for the phone sheet.
- **MVP "Model this building"**: tap (or Alt-click) an Overture building → Drawn model seeded from its rows (footprints, heights, `min_height`, roof tags → `ModelPart`s). User types heights/bases per part, picks roof shape, roof height and direction, adds/deletes parts, "Add spire".
- **Draw from scratch**: MapController `drawingModel` mode; tap vertices, tap first to close, drag handles, long-press deletes; "Right angles" snap; snap to Overture vertices within 12 px; edge table (length, bearing). Map layers `models-fill` / `models-line`, selected part in accent.
- **Viewfinder adjust**: selected model's silhouette outlined in accent on the 2D overlay; nudge pad E/N (0.1/1 m), heading (0.05°/1°), altitude (0.1/1 m), part height; arrow keys with Shift/Alt; on phone the pad lives in the peek sheet. "Set target to model top", and a readout comparing apex az/el with a typed az/el.
- **Photo overlay** (P4): photo over the frame, opacity slider, fitted by lens FOV.

## 4. Render integration

- `core/geo/modelPlace.ts#placeModel(mesh, anchor, groundM, pin, eyeM): SurfaceMesh` — anchor ENU → lng/lat → same pin distance/bearing and `curvatureDropM` as `buildPrisms`, Float64.
- Refactor: CPU half of `PrismGl.mesh()` → pure `core/geo/surfaces.ts#prismSurfaces(tile): SurfaceMesh`
  (`{ pos; surfId; bldgId; idx; plane; surf; sphere; size; box; doubleSided }`). `PrismGl` uploads `SurfaceMesh`es from a WeakMap cache.
  Models: each triangle its own surface (`kind = 1`, `bearing = atan2(nx, ny)`, `hor = hypot(nx, ny)`); one building row per model for culls; sub-pixel cull off (`size.w = 2`); `doubleSided` disables `CULL_FACE`, fragment flips `pl.xyz` toward the eye when `dot(pl.xyz, d) > 0`.
- `SceneGlInput.models: Iterable<SurfaceMesh>`: `geometryPass` draws them after prisms into the same G-buffer/depth; `shadowPass` merges model bounds into `prismGl.bounds`; `renderDepth` gates each model by `boxCastsInto(mesh.box, 0, light, cascade)`. Stats gain `models`, `shadowModelTriangles`.
- ViewfinderController: `modelSurfaces(sc)` cached on `prismKey + models.rev`; `behindBuilding` also asks `core/geo/meshOcclude.ts#MeshOccluder` (azimuth-degree buckets, Möller–Trumbore) for sun/moon discs, stars, markers; `__scape.prism.models`.
- Ground mask: `sunCeiling.ts#stampTriangles(g, e, n, u)` rasterises each triangle's plan projection to interpolated height, stamping vertices too (thin spires); mask worker gets models via the protocol and folds them into `stampFrameBuildings` and the mask cache key.

## 5. Overture suppression and target height

- `buildings.protocol.ts`: `BuildingsKind.Models`, `ModelsSync { rev; models: { id; footprint; suppress; tris: Float64Array /* lng,lat,absU */ }[] }`, sent to both workers on `models.rev` change.
- `core/geo/buildingTiles.ts#suppressRows(decoded, rings)` drops rows whose centroid is inside a suppressing footprint (per row, not group — podiums outside survive); applied in `run`, `stampFrameBuildings`, `heightAt`; `models.rev` joins `requestBuildings`' `lastKey`. Geometric, not GERS ids, so it survives Overture releases. Inspector lists suppressed rows with "keep" toggles (later).
- Target height: `applyBuildingHeight` first asks `core/model/heightAt.ts#modelHeightAt(models, p)` — inside a visible model's footprint it returns apex above base (Overture's `heightM` meaning), else `buildingHeightAt`. Label: "from model «name»".

## 6. Phases (each ships, each ends with an agent-browser smoke test)

Shared matrix: focal 24 / 200 / 600 / 2400 mm × aim (model top, grazing edge, behind a ridge) × landscape/portrait × day (sun behind camera), low side sun ~5°, night. Checks read `__scape.prism` plus screenshots.

- **P1** render path + drawn MVP: `surfaces.ts` refactor, `placeModel`, models store + db v4, "Model this building", part editor, suppression, target height.
  Unit: `prismSurfaces` golden-identical to today; `placeModel` vs `buildPrisms` within 1 mm at 10 km.
  Smoke (Hoboken → 30 Hudson Yards): `models ≥ 1`, model tris > 0 at every focal; Overture rows under the footprint gone; no z-fight (consecutive-frame diff < 0.1% in the model box); sky occluded above the crown; hidden behind a ridge; `shadowModelTriangles > 0` day, 0 night; ground mask shows the shadow; target height = typed apex; persists across reload and offline (CDP `Network.emulateNetworkConditions`).
- **P2** freehand drawing, snap, edge table, viewfinder outline and nudge pad, phone sheet. Smoke adds 390×844: draw a 4-vertex footprint by taps, nudge heading 1°, outline follows.
- **P3** GLB import/export: `gltf.ts`, `validateMesh`, hand-built fixture GLBs in tests, import sheet, `extras.scape` round trip in GLB and `.scape.json`. Smoke: a real GLB places, suppresses, casts; a Draco file shows the error; export → re-import keeps anchor and footprint byte-identical.
- **P4** photo overlay, `MeshOccluder` polish. Smoke: Moon behind the model hidden in the overlay at night.
- **Follow-up**: official LoD2 (swissBUILDINGS3D, PLATEAU, 3DBAG) as 3D Tiles — tileset walker, ECEF→ENU, meshopt decoder (needs the user's approval), per-region suppression; reuses P3 parser and P1 `SurfaceMesh`.

## 7. Risks

- Centroid suppression can misjudge a row straddling the footprint; the keep/suppress list mitigates.
- One surface per triangle: 500 k triangles → ~490-row surface textures (limit 2048); merge coplanar triangles if needed.
- The draped mask treats overhangs as solid columns (same as prisms); viewfinder cascades are exact.
- Target height is the apex by default; an "under point" toggle may follow.
