# 3D models for the viewfinder: where precise geometry can come from

Research date: 2026-09-13. Six slices, each researched by a separate agent that fetched the endpoints, licence pages and price lists that day; the per-slice reports with URLs, CORS probes and verification marks are in [`3d-models/`](3d-models/) (A commercial services, B open government models, C global height datasets, D landmark meshes and competitors, E precision terrain, F formats, tooling and hosting). The headline endpoints were re-probed from this machine before this summary was written. Prices and URLs are as of that date.

Context: the viewfinder is Scape's own canvas rasteriser. It takes triangles or extruded polygons in local east-north-up metres relative to the eye and depth-tests them against the terrain sweep. Today the geometry is OpenStreetMap footprints from OpenFreeMap z14 tiles extruded as flat prisms; untagged footprints get OpenMapTiles' 5 m default and there are no roof shapes. Terrain is AWS Terrain Tiles ("Terrarium"). Constraints: free or a few dollars a month, fetchable from the browser or re-hostable, licences that survive an open-source and a possibly paid app, offline caching (local-first).

---

## 1. What "precise" means in numbers

The Sun and Moon are 0.5° across. Everything below is angular error at the frame, computed in reports D and E.

| Error source | Size | At the frame |
|---|---|---|
| 1 m of height or position, Hoboken → 30 Hudson Yards (2.7 km) | 1 m | 1/24 of a Moon; one Moon = 24 m of building |
| Skyscraper height ambiguity (architectural vs roof vs tip; OSM 395 m, NYC footprints 385.6 m for 30 HY) | ~10 m | 0.4 Moon — wrecks an alignment |
| 30 m DEM cell on a ridge, 15 km away (SRTM / EU-DEM class) | 30 m | 6.9′ = 23 % of a Moon = 200 px at 600 mm |
| 5 m DEM, 15 km | 5 m | 1.15′ = 4 % of a Moon |
| 1 m DEM, 15 km | 1 m | 0.23′; below this refraction (0.1–0.5° near the horizon), GPS position (3–10 m) and where the photographer actually stands dominate |
| Geoid vs ellipsoid height mix-up (GPS eye height against orthometric building data) | +43 m NL, +49 m CH, +45–48 m DE, ~+36 m Tokyo | every building sits a whole tower too low |

Consequences. The useful floor is 2–5 m for both buildings and terrain; sub-metre buys nothing a photographer can use. Height datum and georeferencing dominate mesh density: PlanIt's 327-vertex "30 Hudson Yards" is adequate, a 400 k-vertex photogrammetry mesh with a 1.5° heading error is not. Terrarium's 25–30 m data in the Alps is disqualifying for a 600 mm ridge shot on its own.

---

## 2. Verdict by source

| Source | What it gives | Where | Licence | Browser access | Cost | Verdict |
|---|---|---|---|---|---|---|
| **Overture Maps buildings PMTiles** | footprints with `height`, `min_height`, `num_floors`, `roof_shape/height/direction/orientation`, separate `building_part` layer, z14 | worldwide, monthly | ODbL | one 180 GB archive, `Access-Control-Allow-Origin: *`, range requests | $0 | **Best value per hour.** Same MVT decode path as today. |
| **National / city LoD2 3D Tiles** (3DBAG NL, swissBUILDINGS3D CH, Berlin, PLATEAU JP) | true roof shapes, whole countries | NL, CH, Berlin, 210+ JP municipalities | CC BY 4.0 / OGD BY | public `tileset.json`, CORS `*`, no key | $0 | **Real LoD2 for free** where they exist; needs a 3D Tiles + GLB + meshopt reader (~30 KB + a few hundred lines). |
| **LoD2 CityGML downloads** (NRW, Brandenburg, Bavaria, Hamburg, Vienna, Montréal, Estonia, Poland ×10 voivodeships, Helsinki, Lyon, NYC 2014) | true roof shapes | see report B | DL-DE/BY-2.0, CC BY 4.0, Licence Ouverte, NYC terms | download, convert, re-host | ~$1/month on R2 or B2 for a whole country | Second wave once a pipeline exists. |
| **Sketchfab CC-BY landmark meshes** | hero landmarks incl. crowns and spires | spiky: 30 HY yes (6 912 verts, CC Attribution), Eiffel 143/152 CC-BY, One Vanderbilt / Tower Bridge / Sagrada Família nothing usable | CC BY per model | v3 API live (owner since 2026-08-10: KitBash3D), OAuth for download, glTF/GLB | $0 | Curated supplement; manual position, scale, heading; decimation. |
| **In-app modelling / community upload** (PlanIt's mechanism) | crowns, spires, new towers no dataset has | anywhere | ours | — | build cost | The only path beyond OSM's planar roof parts for a 2019 supertall's crown. |
| **swisstopo terrain quantized-mesh z18, swissALTI3D 0.5 m COG; USGS 3DEP 1 m COG; LINZ 1 m; GSI JP 5 m PNG** | 0.5–5 m terrain | CH, US, NZ, JP | OGD BY, public domain, CC BY 4.0, GSI attribution (approval for some republication) | CORS `*` + range, no key | $0 | Two orders of magnitude over Terrarium in the Alps. |
| **Copernicus GLO-30 + national 1 m DEMs re-tiled to Terrarium z16** | 1.7 m/px regional packs | worldwide floor + marquee mountains | ESA/Copernicus (commercial OK), national open licences | must be re-hosted (GLO-30 bucket has no CORS) | ~165–300 MB per 400 km² pack; ~$1/month | Fits the existing raster sweep unchanged. |
| Google Photorealistic 3D Tiles | photogrammetric mesh, 2 500 cities | — | GMP terms | key + session token; Draco everywhere | $0.006/session after 1 000 free | **Not viable**: terms forbid pre-fetch, store, cache, "offline uses" and "geodata extraction"; weakest exactly on spires. |
| Cesium ion (OSM Buildings, World Terrain, Google via ion) | LoD1 = levels × 3 m, i.e. what we have | — | Community tier non-commercial; $149/mo covers use *inside your organisation* only | — | — | **Not viable** for a distributed app without a negotiated licence; no accuracy gain. |
| Esri Open 3D Buildings (Overture, Draco I3S) | LoD1 | — | Esri Master License Agreement | CORS `*`, no token | — | Technically open, legally closed. |
| Mapbox landmarks, MapTiler, TomTom, HERE | Mapbox: 10 000 artist models, "symbolic realism"; others LoD1 | — | vendor terms | — | — | Not ground truth. |
| Maxar, Blackshark, Nearmap, Vexcel, Aerometrex, Cyclomedia, Bluesky, AccuCities | real meshes / LoD2 | cities | enterprise contracts; AccuCities £250+VAT per 0.25 km² | — | thousands per city | Out of budget. Bing Maps 3D is dead. |
| TurboSquid, CGTrader, Free3D | landmarks $10–$500 | — | royalty-free with **non-extractable** clause | — | — | **Incompatible with an open-source repo** (the mesh would be extractable by definition). |
| MiniWorld3D, Thingiverse, Printables, Cults3D | print miniatures of landmarks | — | mostly CC BY-NC / -ND | — | — | NC/ND blocks a paid app; thickened print geometry anyway. |
| GlobalBuildingAtlas (TUM 2025, 2.75 B LoD1) | global heights, RMSE 5.5 m | worldwide | **CC BY-NC 4.0** for heights | Parquet on Source Cooperative, CORS `*` | $0 | Only while Scape is free; Overture covers most of the gain. |
| FABDEM, TanDEM-X EDEM, MERIT | bare-earth / better 30 m | worldwide | CC BY-NC-SA / non-commercial | — | — | Licence excludes. |
| MapTiler Terrain-RGB, Mapbox Terrain-DEM, Cesium World Terrain | tiled DEM | worldwide | forbid cached/bulk tiles; free tiers non-commercial | — | $29–$149/mo | Incompatible with offline regions. |

---

## 3. The viable sources in detail

### 3.1 Overture buildings: worldwide Simple 3D Buildings for free

`https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/<release>/buildings.pmtiles`, current release `2026-08-19.0`. Verified: 180.4 GB, MVT, minzoom 0, maxzoom 14, gzip, clustered; a 16 KB range read returned `206` with `Access-Control-Allow-Origin: *` and `Access-Control-Expose-Headers: ETag, Content-Length, Content-Range, Accept-Ranges`. Layers `building` (z4–14) and `building_part` (z8–14, with `building_id`). At z14 every Parquet column is present: `height`, `min_height`, `num_floors`, `roof_shape` (enum dome, flat, gabled, gambrel, half_hipped, hipped, mansard, onion, pyramidal, round, saltbox, sawtooth, skillion, spherical), `roof_height`, `roof_direction`, `roof_orientation`, materials and colours, `has_parts`, `sources`. The schema is a 1:1 mirror of OSM Simple 3D Buildings, so one renderer serves OSM and Overture alike.

Heights come from OSM first, then Esri Community Maps and authoritative city data, then Microsoft ML and Google Open Buildings; report C found USGS Lidar as a height source that the prose docs do not even name. Spot checks (DuckDB over the GeoParquet and Overpass, 2026-09-13):

| Area | OSM buildings with height | Overture buildings with height |
|---|---|---|
| Hoboken | 3 of 3 388 | **3 236 of 3 345 (96.7 %)**, median 13.3 m, 3 162 from USGS Lidar |
| Zermatt | — | 973 of 2 192 (44 %), 16 roof shapes, 0 roof heights |
| 30 Hudson Yards | parent `height=395`, `has_parts`; podium parts 10–108.5 m flat; tower parts 310–395 m incl. three `roof:shape=skillion` faces (`roof:height` 180 / 255 / 328, `roof:direction` 121 / 166) and the Edge deck as a part with `min_height=335`, `height=340` (verified in Overture tile 14/4824/6157, 2026-08-19.0) | same, as `building_part` rows |

Limits: Overture calls these tiles "X-ray" tilesets, not a production basemap; the URL changes each release, so a release string must be pinned and bumped; nothing above z14; ODbL share-alike attaches to any derived database we publish (re-hosted extracts must stay ODbL and attributed), not to rendered frames. `pmtiles extract <url> out.pmtiles --bbox=…` (Overture's own documented example) yields regional files for offline regions.

Roof geometry: OSM2World (`tordanik/OSM2World`, **MIT**, pushed 2026-09-09) has a complete per-shape class set (Flat, Gabled, Hipped, HalfHipped, SideHipped, Pyramidal, Skillion, Mansard, Gambrel, Round, Dome, Onion, Cone, Saltbox, Sawtooth, plus ridge/inner-line helpers) and the levels → height rule (`height` wins, else `levels × heightPerLevel + roof height`, roof height from `roof:height`, else `roof:levels`, else a shape default). It is Java and would be ported, which MIT permits. OSMBuildings has no recognised licence and Kendzi3D has none; F4map is closed. OpenMapTiles/OpenFreeMap, Protomaps and Shortbread expose no roof tag at any zoom; Tilezen's schema does but its public service is defunct.

### 3.2 Open government LoD2: true roofs for whole countries

Endpoints a browser can fetch today without a key (all `access-control-allow-origin: *`, verified):

| Endpoint | Content |
|---|---|
| `https://data.3dbag.nl/v20250903/cesium3dtiles/lod22/tileset.json` (also `lod13`, `lod12`; `tile_index.fgb` for per-tile CityJSON) | Netherlands, ~10.7 M buildings, LoD2.2, quarterly; built with 3DGI's `tyler`, **`KHR_mesh_quantization` + `EXT_meshopt_compression`, no Draco** |
| `https://3d.geo.admin.ch/ch.swisstopo.swissbuildings3d.3d/v1/tileset.json` (+ `swisstlm3d.3d`, `vegetation.3d`) | Switzerland LoD2, root region covers Zermatt |
| `https://www.virtualcitymap.de/datasource-data/f892f6af-180a-4eef-917f-5ff03c260b32/tileset.json` | Berlin LoD2 (~550 k buildings) |
| `https://assets.cms.plateau.reearth.io/assets/…/tileset.json` per city and LoD | Japan PLATEAU, CC BY 4.0, LoD1–3, 210+ municipalities; stable slugs documented at docs.plateauview.mlit.go.jp |
| `https://data.cityofnewyork.us/resource/5zhs-2jue.json` | NYC footprints with `height_roof`, `ground_elevation`; returns 30 HY as BIN 1088961, 1 265 ft, built 2018 |

Download-and-convert sources (licence open, no browser endpoint or no CORS): NRW LoD2 CityGML (219.6 GB over 35 022 km-tiles, ≈6.3 MB/km², directory itself is CORS `*`), Brandenburg (CORS `*`), Bavaria and Lower Saxony (no CORS), Hamburg (hand-improved roofs), Vienna (CC BY 4.0), Montréal (textured LoD2), Estonia (nationwide LoD2), Poland (LoD1 nationwide, LoD2 in 10 voivodeships), Helsinki (LoD2 + 7.5 cm mesh, CC BY 4.0), Lyon (textured LoD2 and a 2023 photomesh in 3D Tiles, CORS reflects origin), Luxembourg (textured LoD2), Melbourne (2018 photomesh, CC BY), NYC 3-D Building Model (LoD2, **2014 survey**: no 30 Hudson Yards, no One Vanderbilt). Germany's nationwide LoD2-DE is catalogued by BKG but is not on its free bulk mirror; assemble from the Länder. UK has no open heights (OS building heights are premium). Nordics, Italy, Korea, Taiwan and most US cities other than NYC, Boston, Philadelphia, Cambridge and Austin were not verified.

Global aggregator of these: `github.com/OloOcki/awesome-citygml` (22 countries, 68 regions, >215 M buildings).

### 3.3 Landmark meshes and how PlanIt does it

PlanIt! Pro: app $9.99, "3D Model" in-app purchase $0.99/month or $5.99/year (App Store, 2026-09-13); feature launched 2021-02; models are user-made and user-uploaded, shared to other subscribers; no public catalogue, no export, no provenance statement anywhere on planitphoto.com. PhotoPills, TPE 3D (terrain only), Sun Surveyor (Street View overlay) and PhotoTransit ship no landmark geometry. PlanIt's moat is the upload mechanism and five years of accumulated uploads, not the technology.

Sketchfab: KitBash3D acquired it from Epic on 2026-08-10 with no change to access; the store moved to Fab in 2024 but CC content stayed. The v3 API answers today (`/v3/search?downloadable=true`, `/v3/models/{uid}`; download needs OAuth). Downloadable landmarks are overwhelmingly plain CC-BY (Eiffel 143 of 152, Golden Gate 25 of 31; CC0 ≈ 0, NC/ND 1–3 per query). Delivery is glTF/GLB/USDZ. Quality is spiky and vertex counts are 2–3 orders of magnitude above what a CPU rasteriser wants (Empire State 310 k verts) so decimation is needed, and no model carries position, scale or heading.

Trimble 3D Warehouse's General Model License is the most permissive text of any library (perpetual, sublicensable, derivative works, sell), but provenance is unvetted, downloads are `.skp`/Collada, and the legacy Google Earth geo-models predate 2013.

Making models: hand-modelling from footprint plus published heights takes 2–5 h for a setback tower, 8–15 h for a distinct spire, 20–40 h for lattice. Ground photogrammetry of a 300 m tower is not viable (sightlines, 120 m drone ceiling). Capturing Google 3D Tiles into a model breaches the Maps terms ("programmatically reading and recording measurements … geodata extraction"). SketchUp Free still exports OBJ/DAE/STL (glTF is paid); Blosm imports OSM with roof shapes; Meshroom (MPL-2.0), RealityScan and KIRI Engine export freely.

### 3.4 Terrain: Terrarium is the weak link in the Alps

Terrarium was built 2016–17 and "regular updates are not planned". The tiles carry a CORS-exposed `x-amz-meta-x-imagery-sources` header: over Zermatt at z13–15 it says `eudem/eudem_dem_5deg_n45e005.tif` (EU-DEM 25 m, ~7 m RMSE, ridge crests smoothed), over Mt Rainier `ned19…` (3 m lidar). That header is a free per-region quality probe.

Directly usable from the browser today (CORS `*`, range requests, no key): swisstopo quantized-mesh terrain `https://3d.geo.admin.ch/ch.swisstopo.terrain.3d/v1/layer.json` (z0–18, EPSG:4326 TMS, 270–540 KB per tile), swissALTI3D 0.5 m and 2 m COGs via the STAC API (16.6 MB per 1 km² tile at 0.5 m), USGS 3DEP 1 m COGs on `prd-tnm.s3.amazonaws.com`, LINZ 1 m DEM on `nz-elevation.s3-ap-southeast-2.amazonaws.com`, GSI Japan `dem_png`/`dem5a_png` XYZ tiles (custom RGB encoding). Copernicus GLO-30 (commercial OK) is the right global floor but its bucket has no CORS, so it must be re-hosted. AHN (CC0), RGE ALTI, Austrian ALS, Norway, Denmark, Finland, Spain PNOA, EA LiDAR (OGL), Canada HRDEM and Australia ELVIS are download-and-re-host. Nepal, the Andes and the Himalaya have nothing open above 30 m.

Re-tiling to Terrarium z16 (1.7 m/px, under the 2 m floor) costs ~41–77 MB per 100 km², so a 400 km² Zermatt pack is 165–300 MB, a plausible OPFS download alongside the existing regions; the raster sweep needs no change. Alternatives: sample the swisstopo TIN directly (needs a quantized-mesh reader, ~200 lines or the 57 KB MIT `@here/quantized-mesh-decoder`), or read COG overviews straight from source for the few tiles under the aim (needs a small COG reader, unpredictable latency).

---

## 4. Getting geometry into the rasteriser

Parsing cost in hand-written TypeScript (report F): GLB ~80 lines for the container, ~250 for positions, indices and node matrices; `tileset.json` walker ~150; b3dm header +60; implicit tiling ~200; CityJSONSeq ~150; quantized-mesh ~200. `EXT_meshopt_compression` needs `meshopt_decoder.js`, 28 KB MIT with inlined WASM. Draco needs a 279 KB WASM (`draco3d@1.5.7`, frozen since 2024-01) and is required essentially only by Google. loaders.gl works without three.js but installs >20 MB and lands at 200–400 KB gzipped; `3d-tiles-renderer` has three as a hard peer; Cesium is 79 MB. The baseline to beat is what Scape ships now: `@mapbox/vector-tile` 17.6 KB + `pbf` 90 KB.

Sizes: a z14 tile of LoD2 at NRW density is ~640 buildings, ~32 k triangles, ~310 KB raw as 16-bit quantized positions and indices, **~60–130 KB after meshopt and brotli**; the Netherlands is then ≈5–8 GB, NRW ≈6–9 GB. Hosting 50 GB with 200 GB/month egress: Cloudflare R2 ≈ $1 (10 GB free, $0 egress), Backblaze B2 ≈ $0.75 (egress free to 3× stored), Bunny ≈ $1–2.50, Hetzner Object Storage €6.49 flat for 1 TB, S3 + CloudFront $1–18; GitHub Pages, Netlify and Vercel free tiers are unusable at this volume; Hugging Face datasets host 1 TB free but are not a CDN.

Packaging: PMTiles v3 allows `tile_type 0x00 = Unknown`, so meshopt GLBs or a custom quantized-triangle blob per z14 tile fit in one clustered archive read by range requests (`pmtiles` ~15 KB ESM, BSD-3), the same way Protomaps hosts a planet basemap as one file. Alternatives: directory of files (CDN-friendly, many objects), 3D Tiles implicit tiling (interoperable with other clients), or FlatCityBuf (`@cityjson/flatcitybuf`, MIT, pure TypeScript, 276 KB) which range-queries the whole 68 GB 3DBAG with no tiling step. Safari grants an origin up to 60 % of disk but evicts script storage after 7 days without interaction unless installed or `navigator.storage.persist()` succeeds.

Conversion tools, all verified alive: `citygml-tools`/`citygml4j` (Apache-2.0), `cjio` (MIT), `tyler` (Apache-2.0, 3DBAG's tiler), `pg2b3dm` (MIT), `mago-3d-tiler` (MPL-2.0), `glTF-Transform` (MIT), `obj2gltf` (Apache-2.0), OSM2World (MIT); `val3dity`, `roofer`, `3dfier` are GPL and fine offline.

Coordinates: 3D Tiles are ECEF; ECEF → subtract eye → rotate by the ENU basis is ~30 lines, done in Float64. CityGML sits in national projected CRSs with orthometric heights; reproject at build time so the browser needs no CRS code. The geoid offset (~45 m in Europe) varies under 1 m across tens of kilometres, so one constant per conversion region stored in tile metadata is enough; no 5.5 MB EGM96 grid in the bundle.

---

## 5. What the two test scenes would get

**Hoboken → 30 Hudson Yards.** Overture fixes Hoboken (96.7 % lidar heights instead of 5 m boxes) and supplies the tower's tiers as `building_part` rows for the same z14 decode path, including the angled crown as three skillion roof planes and the Edge deck as a floating part at 335–340 m (verified in the z14 tile; see §2). Rendering roof shapes is therefore what unlocks the crown, at OSM's planar approximation. A truer crown needs a mesh: NYC's LoD2 model is a 2014 survey, NYC footprints give an LoD1 prism only, the ArcGIS Web Scene "2021 NYC Lidar 3D Buildings" (item 303d7109f2c24691b806ef5d3bbd8240) is a test scene with no licence stated and an incomplete 30 Hudson Yards, so the choices are the CC-BY Sketchfab "10 & 30 Hudson Yards" (6 912 verts, manual placement) or in-app modelling. Note the datum problem: OSM says 395 m, NYC says 1 265 ft = 385.6 m roof, the architectural height is 387 m; 10 m is 0.4 Moon here.

**Zermatt → Matterhorn.** Terrain-dominated. Terrarium is EU-DEM 25 m there, i.e. up to a quarter of a Moon of skyline error at 600 mm. swisstopo's quantized-mesh (z18) and swissALTI3D (0.5 m) are open, CORS-enabled and cover the summit; swissBUILDINGS3D LoD2 3D Tiles cover the village, where Overture has heights for only 44 % of buildings and almost no roof tags.

---

## 6. Recommendation

Advice only; the choices in the last list are the user's.

Order by value per hour of work:

1. **Overture buildings PMTiles + full Simple 3D Buildings rendering.** Swap the tile source (same MVT path, pinned release URL, `pmtiles extract` for offline regions), read `building_part` with `min_height`, choose height as `height` → `num_floors × per-level` + roof → class default (never a blanket 5 m), port the roof shapes from OSM2World (MIT). Worldwide, $0, and it makes 30 Hudson Yards, the Eiffel Tower and the Empire State Building correct in massing with georeferencing free by construction.
2. **Terrain precision where it is free.** Consume swisstopo's terrain (and 3DEP / LINZ / GSI) directly where CORS allows, and build a small offline pipeline that re-tiles national 1 m DEMs and GLO-30 to Terrarium z15/z16 "precision packs" hosted on R2 for chosen mountain regions. Always apply refraction. This is what makes the Matterhorn shot plannable at all.
3. **Regional LoD2 registry.** When the camera is inside NL, CH, Berlin or a PLATEAU city, stream the public 3D Tiles (tileset walker + GLB + meshopt, no Draco) instead of Overture prisms; later convert the download-only CityGML states into own meshopt tiles in a PMTiles archive on R2 for about $1/month per country.
4. **Hero landmarks.** glTF import with position, scale and heading (option B in PLAN.md), seeded with a curated CC-BY set from Sketchfab with attribution shipped, plus in-app modelling (option C) for crowns and new towers. Copy PlanIt's mechanism, community upload with a ~300-vertex budget, not its library.

Drop for good: Google Photorealistic 3D Tiles, Cesium ion, Esri scene layers, paid marketplaces, NC-licensed datasets, MapTiler/Mapbox terrain.

Decisions that are the user's:

- Building source: Overture PMTiles (ODbL, release-pinned URL) versus staying on OpenFreeMap.
- LoD2 delivery: consume foreign 3D Tiles live, convert and self-host in PMTiles on R2 or B2, or both.
- Decoder path: hand-written GLB/b3dm/tileset reader + `meshopt_decoder.js` (~30 KB) versus loaders.gl (200–400 KB gzipped); either way no Draco.
- Terrain: raster z16 Terrarium packs (no sweep change) versus a TIN sampler for quantized-mesh versus COG-direct reads; and whether to pay ~$1/month for R2.
- Landmark meshes: whether to ship a curated Sketchfab CC-BY set with an attribution screen, and whether community sharing is in scope.
- Whether Scape stays free forever, which decides if CC BY-NC data (GlobalBuildingAtlas heights) may ever be used.

---

## 7. Gaps and unverified items

Exact licence wording was not re-read for 3DBAG (recalled CC BY 4.0), NYC Open Data, Montréal, Melbourne and PLATEAU per-city supplements; check before monetising. Nordic, Italian, Korean, Taiwanese and most US city models were not verified. PLATEAU's stable-URL slug syntax returned 404 on two guesses. Google tile counts per view (10–50 MB) and the per-z14-tile LoD2 size (60–130 KB) are derived, not measured. GSI Japan's Survey Act approval requirement for republication needs a proper read.
