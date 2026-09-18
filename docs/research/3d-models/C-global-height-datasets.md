Research date: 2026-09-13

# Global building-height / roof-shape data for Scape

Verified today = fetched with `curl`/WebSearch on 2026-09-13. Recalled = from memory, not re-verified.

## 1. Headline: Overture buildings PMTiles is already what we want

Verified today: `https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/2026-08-19.0/buildings.pmtiles`

| Property | Value (verified by HTTP range reads of the PMTiles header + metadata) |
|---|---|
| Size | 180,364,329,147 bytes (180.4 GB) — but it is a PMTiles archive, so the browser only fetches the ~16 KB header + directory + the tiles it needs |
| CORS | `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET, HEAD`, `Access-Control-Expose-Headers: ETag, Content-Length, Content-Range, Accept-Ranges`; `Range` request returned `206` with those headers |
| Tile type / zooms | MVT, minzoom 0, **maxzoom 14**, clustered, gzip tile compression, 16,069,480 tiles |
| Layers | `building` (minzoom 4, maxzoom 14) and `building_part` (minzoom 8, maxzoom 14) |
| `building` fields in the tiles | `height`, `min_height`, `min_floor`, `num_floors`, `num_floors_underground`, `roof_shape`, `roof_height`, `roof_direction`, `roof_orientation`, `roof_material`, `roof_color`, `facade_material`, `facade_color`, `is_underground`, `level`, `class`, `subtype`, `has_parts`, `id`, `names`, `sources`, plus helper `@height_source` / `@geometry_source` |
| `building_part` fields | same shape fields plus `building_id` |
| Generation | Planetiler profile `profiles/Buildings.java` in `OvertureMaps/overture-tiles` (MIT); `addFullTags(source, polygon, 14)` copies **every** Parquet column into the tile, always present at z ≥ 14 |
| Cadence | monthly, one tileset per release; tiles live at `s3://overturemaps-extras-us-west-2/tiles/<RELEASE>/<THEME>.pmtiles` |

So a single public, CORS-enabled, range-readable URL already gives worldwide footprints **with height, min_height, num_floors and the full OSM roof tag set at z14** — exactly the layer we would otherwise have to build. Caveat: Overture calls these "X-ray" tilesets, "not designed to be a production-ready cartographic basemap" (docs.overturemaps.org/examples/overture-tiles/), and the URL changes every release (no stable "latest" alias), so Scape must pin a release string and update it. Sub-extracts are trivial: `pmtiles extract <url> out.pmtiles --bbox=...` (their own documented example) gives an offline-cacheable regional file we can re-host.

Counts, 2026-08-19.0 release notes (verified today): `building` 2,529,582,613; `building_part` 4,339,150 (OSM-only). Cadence monthly. Licence: **ODbL** for the buildings theme (it includes OSM); Overture only admits ODbL-compatible sources such as CC BY 4.0. ODbL share-alike applies to derived *databases* — a paid app may use it, but a derived building database we publish (e.g. our own re-hosted tiles) must be ODbL and attributed. Other Overture themes (base/divisions/places) are CDLA-Permissive-2.0, but buildings is not.

### Schema (verified today from `OvertureMaps/schema` `buildings/defs.yaml`)
`height` (m, >0, lowest to highest point), `min_height`, `min_floor`, `num_floors`, `num_floors_underground`, `is_underground`, `roof_shape` enum = dome, flat, gabled, gambrel, half_hipped, hipped, mansard, onion, pyramidal, round, saltbox, sawtooth, skillion, spherical; `roof_direction` (bearing 0–360), `roof_orientation` (along|across), `roof_height`, `roof_material`, `roof_color`, `facade_material`, `facade_color`. This is a 1:1 mirror of OSM Simple 3D Buildings, so one renderer serves both sources.

### Sources feeding Overture buildings
Docs (verified today, `docs.overturemaps.org/guides/buildings/`): primary OSM (highest conflation priority), then Esri Community Maps, authoritative national/municipal data (IGN Spain, City of Vancouver), then ML roofprints from Microsoft, Google Open Buildings and an East-Asia dataset. Matching by IoU > 0.5; heights are merged between matched features. Buildings ≥ 900 m are dropped; ML footprints < 10 m² dropped.

## 2. Spot checks (all run today)

**Hoboken** (bbox −74.036,40.735 → −74.021,40.756), DuckDB over the Overture GeoParquet on S3 vs Overpass over OSM:

| Source | buildings | with height | with floors | with roof shape |
|---|---|---|---|---|
| OSM (Overpass, today) | 3,388 | **3** | 135 | 1 |
| Overture 2026-08-19.0 | 3,345 | **3,236 (96.7%)**, median 13.3 m | 128 | 1 |

Provenance of those heights (DuckDB `unnest(sources)`): `USGS Lidar` → `/properties/height` on 3,162 buildings, `Microsoft ML Buildings` → height on 63; geometry from OpenStreetMap on 3,337. USGS Lidar is not even named in Overture's prose docs. **This alone fixes the Hoboken 5 m-default problem.**

**30 Hudson Yards** (Overpass, today): the building way carries `height=395`; seven sibling `building:part` ways carry heights 10 / 15 / 21 / 65 / 85 / 98 / 108.5 m, each `roof:shape=flat`. Neighbours are well tagged too (10 HY 272.8 m, 35 HY 304.8 m + 72 levels, 50 HY 308.2 m). Overture carries `building_part` as its own tile layer (minzoom 8) with `building_id`, so the parts are available — our renderer must union parts with the parent footprint the way S3DB specifies.

**Zermatt** (bbox 7.72,46.00 → 7.78,46.04), Overture: 2,192 buildings, 973 with height (44.4%), median 5.56 m, 41 with `num_floors`, **16 with `roof_shape`, 0 with `roof_height`**. So alpine Switzerland is the weak case: roofs are almost never tagged and less than half the buildings have heights — expect to fall back to a levels/default heuristic and flat or generic gabled roofs there. (Zermatt matters less for the Matterhorn scene, which is terrain-dominated.)

## 3. The other global datasets

| Dataset | Coverage | Height quality | Licence | Format / size |
|---|---|---|---|---|
| **GlobalBuildingAtlas (TUM, ESSD 17, 6647, 2025)** | global, 2.75 B polygons; GBA.LoD1 = 2.68 B with heights | RMSE 1.5–8.9 m by continent, **global mean RMSE 5.5 m** (Oceania 1.5, Europe 4.1, N. America 5.3, Asia 5.9) | **GBA.Polygon + GBA.LoD1 and GBA.Height are CC BY-NC 4.0**; only GBA.ODbLPolygon is ODbL | 922 GeoJSON tiles (5°), 1.1 TB; Parquet conversion ~210 GB on Source Cooperative (source.coop/tge-labs/globalbuildingatlas-lod1, CORS `*` verified today) |
| **Microsoft GlobalMLBuildingFootprints** | ~1.4 B footprints global | heights for **>174 M** buildings only; per-country, no published accuracy table | ODbL | GeoJSONL per quadkey |
| **Google Open Buildings v3** | Africa, S/SE Asia, LatAm & Caribbean (~1.8 B) | footprints only, no height | CC BY 4.0 **and** ODbL (dual) | CSV/GeoParquet |
| **Google Open Buildings 2.5D Temporal v1** | Global South only (~58 M km²) | height **raster**, 4 m effective resolution (0.5 m grid), annual 2016–2023 | CC BY 4.0 + ODbL (dual) | Earth Engine ImageCollection; no per-building polygons |
| **3D-GloBFP (ESSD 16, 5357, 2024)** | global, per-footprint heights, year 2020 | R² 0.66–0.96, **RMSE 1.9–14.6 m** over 33 validation subregions | see Zenodo record (CC-BY family; verify before shipping) | Shapefiles on Zenodo, by continent |
| **EUBUCCO v0.1** | EU-27 + Switzerland, ~202 M buildings | height present for **73%** of buildings; sourced from 50 government datasets + OSM | mixed per-source (much ODbL) | CSV/GPKG |
| **Copernicus Urban Atlas Building Height 2012** | selected EEA38 + UK cities | 10 m raster, 2012 vintage | Copernicus free & open | raster |
| **WSF 3D (DLR)** | global | 90 m grid: mean height, volume, area fraction — not per building | CC BY 4.0 | raster / vector tiles |
| **GHSL GHS-BUILT-H R2023A** | global | 100 m grid, average gross/net building height, from AW3D30+SRTM+Sentinel-2 (2018) | free & open (EC) | raster, Mollweide |
| **Open City Model** | USA | LoD1 (extruded prisms), heights from ML/lidar-derived sources | ODbL (BuildZero.Org) | CityGML on AWS Open Data |

Practical reading: nothing here beats Overture as a *delivery* format, because Overture already ingests Microsoft and Google and adds authoritative national data on top. GlobalBuildingAtlas has the best *published* global height accuracy and would be the natural gap-filler for Zermatt-like areas, but **CC BY-NC blocks a paid Scape**, so it is only usable if the app stays free, or under the ODbL-polygon subset that lacks the heights. The rasters (GHSL, WSF3D, Open Buildings 2.5D) are 90–100 m or Global-South-only and are useless for a viewfinder that projects individual prisms.

## 4. OpenStreetMap itself

Taginfo API, verified today (global object counts, all element types):

| Key | Objects | vs. `building` (708.5 M) |
|---|---|---|
| `building` | 708,479,553 | — |
| `building:levels` | 42,738,421 | 6.0% |
| `height` | 27,176,536 | 3.8% (upper bound; includes non-buildings) |
| `roof:shape` | 9,676,458 | 1.4% |
| `roof:levels` | 5,150,817 | 0.7% |
| `building:part` | 4,700,410 | 0.66% |
| `roof:orientation` | 1,395,817 | 0.20% |
| `roof:height` | 568,921 | 0.08% |
| `min_height` | 298,992 | 0.04% |
| `roof:direction` | 173,859 | 0.02% |

So OSM alone gives real heights to <4% of buildings worldwide — Overture's conflated heights are the only path to "true heights everywhere".

**Levels → height heuristic.** OSM2World (`LevelAndHeightData.java`, read today) computes `height = parseHeight(tags, buildingLevels * defaults.heightPerLevel + roofHeight)`, i.e. tagged height wins, otherwise levels × a per-building-type `heightPerLevel` plus a roof height; roof height comes from `roof:height`, else `roof:levels × heightPerLevel`, else a shape-specific default (dome/onion → half the outline diameter, skillion → 1 m, otherwise `DEFAULT_RIDGE_HEIGHT`). Levels are back-derived as `max(1, height_without_roof / heightPerLevel)` when only height is tagged. The widely used rule of thumb elsewhere is 3 m per level (recalled).

**Reusable roof algorithm.** `tordanik/OSM2World` is **MIT** (verified via `gh api`) and contains a complete, per-shape class hierarchy: `FlatRoof, GabledRoof, HippedRoof, HalfHippedRoof, SideHippedRoof, PyramidalRoof, SkillionRoof, MansardRoof, GambrelRoof, RoundRoof, DomeRoof, OnionRoof, ConeRoof, SaltboxRoof, SawtoothRoof, ComplexRoof, RoofWithRidge, RoofWithInnerLines, HeightfieldRoof` (file list verified today). It is Java, so it needs porting to TS, but MIT means we may port it freely — including into a paid app. By contrast `OSMBuildings/OSMBuildings` has no SPDX-recognised licence (`NOASSERTION`), and `kendzi/kendzi3d` has no licence file at all — neither is safe to copy from. F4map is closed. MapLibre's `osm-3d` demos only extrude flat prisms (recalled).

## 5. Tile schemas

| Schema | Building attributes | Roof tags? |
|---|---|---|
| **OpenMapTiles / OpenFreeMap** (verified today at openmaptiles.org/schema) | `render_height`, `render_min_height`, `colour`, `hide_3d` only | **No** — at any zoom |
| **Protomaps basemap** (docs repo `basemaps/layers.md`, verified today) | `kind` ∈ {address, building, building_part}, `height`, `min_height`, `layer`; z0–14 merged, z15+ individual; height quantised at low zoom | **No** |
| **Shortbread 1.0** | buildings layer from z14 with a `dummy=1` property only; height/min_height exist only in experimental forks (planetiler-shortbread) | No |
| **Tilezen / Nextzen** (docs verified today) | `height`, `min_height`, `roof_height`, `roof_shape`, `roof_material`, `roof_orientation`, `roof_color`, `building_part`, `root_id`, `volume`, `kind_detail` | **Yes** — richest OSM-derived schema, but Nextzen's public tile service is defunct (recalled); you would have to run the pipeline |
| **Overture buildings tileset** | full schema (section 1) | **Yes** |

**Rolling our own.** Planetiler's own PLANET.md (verified today) reports a full OpenMapTiles planet build from a 64.7 GB `planet.osm.pbf` producing a 99 GB mbtiles in 3h21m on a 16-CPU/128 GB machine with 192 GB of temp feature storage; today's planet PBF is ~85 GB (recalled). A buildings-only z14 layer is a small fraction of that: Overture's z0–14 buildings-with-all-tags tileset is 180 GB, and an OSM-only buildings layer keeping just height/min_height/roof:* would plausibly land in the 20–60 GB range (estimate, not measured) — cheap to generate, expensive to host and to re-generate monthly. Overture's own pipeline runs on AWS Batch in ~90 minutes on a `c7gd.16xlarge`. Given that Overture publishes the identical product monthly at zero cost with `*` CORS, building our own is only justified if we need different zooms (e.g. z16 individual footprints, since Overture stops at z14) or a slimmer payload.

## 6. Implications for Scape

1. Switch the buildings source from OpenFreeMap to the Overture buildings PMTiles (same z14, same MVT decoding path, far richer attributes). Keep `render_height` fallback only for tiles we already cached.
2. Height selection order: `height` → `num_floors × 3 m` (+ roof) → class-based default; never a blanket 5 m.
3. Add `building_part` handling (parent `building_id`, `min_height`) — required for 30 Hudson Yards and any stepped tower.
4. Port the roof shapes we can justify from OSM2World (MIT): flat, gabled, hipped, half-hipped, pyramidal, skillion, mansard, gambrel, round, dome — they map 1:1 onto Overture's `roof_shape` enum, and our rasteriser already eats triangles.
5. Treat GlobalBuildingAtlas as a *possible* gap filler only while Scape is free; its heights are CC BY-NC.

### Sources
- https://docs.overturemaps.org/guides/buildings/ · https://docs.overturemaps.org/examples/overture-tiles/ · https://docs.overturemaps.org/blog/2026/08/19/release-notes/
- https://github.com/OvertureMaps/schema (`schema/buildings/defs.yaml`, `building.yaml`) · https://github.com/OvertureMaps/overture-tiles (`profiles/Buildings.java`, MIT)
- https://essd.copernicus.org/articles/17/6647/2025/ · https://github.com/zhu-xlab/GlobalBuildingAtlas · https://source.coop/tge-labs/globalbuildingatlas-lod1
- https://github.com/microsoft/GlobalMLBuildingFootprints · https://sites.research.google/gr/open-buildings/temporal/ · https://essd.copernicus.org/articles/16/5357/2024/
- https://www.nature.com/articles/s41597-023-02040-2 (EUBUCCO) · https://human-settlement.emergency.copernicus.eu/ghs_buH2023.php · https://geoservice.dlr.de/web/datasets/wsf_3d · https://land.copernicus.eu/en/products/urban-atlas/building-height-2012 · https://github.com/opencitymodel/opencitymodel
- https://taginfo.openstreetmap.org/api/4/key/stats · https://overpass-api.de/api/interpreter
- https://github.com/tordanik/OSM2World · https://openmaptiles.org/schema/ · https://docs.protomaps.com/basemaps/layers · https://shortbread-tiles.org/schema/1.0/ · https://tilezen.readthedocs.io/en/latest/layers/ · https://github.com/onthegomap/planetiler/blob/main/PLANET.md
