Research date: 2026-09-13

# F — Formats, conversion tools, hosting economics for Scape's software rasteriser

Scope: how 3D building geometry actually reaches a 2D canvas rasteriser in a browser, cheaply, without three.js/Cesium. Facts marked **[V]** verified today by fetch/`npm view`/`gh api`; **[R]** recalled from spec knowledge, not re-verified.

---

## 1. Formats: what a few hundred lines of TS can parse

| Format | Parse cost in hand-written TS | Notes |
|---|---|---|
| **GLB** (container) | ~80 lines | 12-byte header (`glTF` magic, version, length) + chunks (JSON 0x4E4F534A, BIN 0x004E4942). Triangle-only reader = header + `meshes[].primitives` + `accessors`/`bufferViews` → typed arrays. ~200–250 lines total for POSITION+indices+node matrices. **[R]** |
| **3D Tiles 1.1 tileset.json** | ~150 lines | Explicit tree: `root.boundingVolume` (`region`/`box`/`sphere`), `geometricError`, `refine`, `content.uri`, `transform` (4×4 column-major ECEF). glTF is the primary tile format in 1.1; **b3dm/i3dm/pnts/cmpt were deprecated in 1.1** and "may be removed" **[V]** (spec README line 62). glTF is y-up; 3D Tiles is z-up, so a +π/2 rotation about x is applied at runtime **[V]** (spec lines 427–441). |
| **b3dm** (1.0, still what most public tilesets serve) | +60 lines | 28-byte header: magic, version, byteLength, featureTableJSON/Binary lengths, batchTableJSON/Binary lengths, then JSON+binary tables, then an embedded GLB. `RTC_CENTER` lives in the feature table JSON. **[R]** |
| **Implicit tiling** (1.1) | ~200 lines | `implicitTiling{subdivisionScheme: QUADTREE|OCTREE, subtreeLevels, availableLevels, subtrees.uri}`; subtree files are a binary header + availability bitstreams; content URIs are templated `{level}/{x}/{y}`. Removes tileset.json traversal entirely — the client computes tile URLs. **[V]** spec §Implicit Tiling. |
| **EXT_mesh_features / EXT_structural_metadata** | skippable | Per-vertex/per-texel feature IDs + a schema; only needed if you want per-building picking. Ignorable for a depth-only rasteriser. **[V]** spec line 897. |
| **EXT_meshopt_compression + KHR_mesh_quantization** | 28 KB JS dep | `meshopt_decoder.js` is self-contained (wasm inlined as base64), MIT. **This is the sweet spot.** |
| **Draco (KHR_draco_mesh_compression)** | hard dep | `draco3d@1.5.7`, Apache-2.0: `draco_decoder.wasm` **279 KB** + `draco_decoder_nodejs.js` glue 57 KB (encoder wasm 361 KB, not needed). Last publish **2024-01-17** — effectively frozen. **[V]** |
| **KTX2/Basis** | hard dep | `ktx-parse@2.0.0` MIT (202 KB unpacked) parses the container, but transcoding needs the Basis wasm (~250 KB) *and* a GPU target format. Irrelevant to Scape: a software rasteriser wants raw RGBA or no textures at all. **[V]** version/licence |
| **CityJSON 2.0 / CityJSONSeq** | ~150 lines | Plain JSON. CityJSONSeq = ndjson: first object is the `CityJSON` header (`transform`, CRS, geometry-templates), following lines are independent `CityJSONFeature`s each with their own local `vertices`. Ideal for streaming into a worker. Suggested extension `.city.jsonl`. **[V]** cityjson.org/cityjsonseq |
| **FlatCityBuf (.fcb)** | npm dep, 276 KB | New cloud-optimised CityJSON-in-FlatBuffers with a packed Hilbert R-tree + B+tree attribute indices; **queries a 70 GB file over plain HTTP Range requests, no server**. `@cityjson/flatcitybuf@0.4.1`, MIT, 276 KB unpacked, one dep (`flatbuffers`), **pure TypeScript, browser, no WASM**. Public demo queries the whole 3DBAG (**~10.7 M buildings, ~68 GB**) live in-browser. **[V]** |
| **CityGML 3.0** | no | Gigantic XML+GML with ADEs. Browser parsing is not realistic; convert offline. |
| **I3S / SLPK** | no | Esri's format; needs a heavyweight client, node-page/geometry buffers per node. Skip. **[R]** |
| **quantized-mesh (terrain)** | ~200 lines | 88-byte header (center ECEF, min/max height, bounding sphere, horizon occlusion point), zigzag-delta u/v/height arrays, high-watermark-encoded indices, edge index lists, optional extensions. `@here/quantized-mesh-decoder@1.2.8` MIT, **57 KB unpacked** — small enough to vendor or reimplement. **[V]** |

**Verdict on parsing:** GLB + b3dm + tileset.json + CityJSONSeq + quantized-mesh are all "few hundred lines" territory. Draco and KTX2 are the only true black boxes.

---

## 2. Consuming 3D Tiles in JS without three.js — minimum bundle cost

| Path | Package(s) | Licence | Unpacked size | Verdict |
|---|---|---|---|---|
| Hand-written GLB + b3dm + tileset walker | none | — | ~0 KB | Feasible; add `meshopt_decoder.js` (28 KB) if the source uses meshopt. **Cheapest.** |
| + Draco support | `draco3d@1.5.7` | Apache-2.0 | 873 KB pkg; **279 KB decoder wasm** shipped | Only if you must read Google PR3DT or Cesium-ion-style tilesets. |
| loaders.gl | `@loaders.gl/3d-tiles@4.5.1` (1.90 MB) → pulls `@loaders.gl/gltf` (1.69 MB), `@loaders.gl/draco` (**15.7 MB**), `@loaders.gl/tiles` (1.07 MB), `@loaders.gl/compression`, `zip`, `images`, `math.gl/*` | MIT | >20 MB installed; realistically 200–400 KB gzipped in-bundle | Actively maintained (published 2026-09-09). Heavy, but tree-shakable-ish and **does not need three.js**. |
| `3d-tiles-renderer@0.5.2` (NASA-AMMOS) | Apache-2.0, 3.3 MB, peer-deps **three** (20.4 MB) | — | — | Excellent traversal/LOD code, but three is a hard peer. Not viable for a canvas rasteriser. **[V]** |
| `@gltf-transform/core@4.5.0` | MIT, 976 KB, 1 dep (`property-graph`) | — | — | Authoring/offline SDK; pushed 2026-09-12. Use it in the **build pipeline**, not in the browser. |
| Cesium | Apache-2.0, **79.4 MB** unpacked | — | — | Non-starter. |

`@mapbox/vector-tile@3.0.0` (BSD-3, 17.6 KB) + `pbf@5.1.2` (BSD-3, 90 KB) — what Scape already ships — remain the size baseline to beat. **[V]**

---

## 3. Google Photorealistic 3D Tiles

- Root: `https://tile.googleapis.com/v1/3dtiles/root.json?key=KEY`; the response's child URIs carry a `session=` parameter (e.g. `/v1/3dtiles/datasets/CgA/files/UlRPVEYuYnVs.json?session=CIqhrPOFvdHSYg`) which **must** be forwarded on every subsequent tileset/tile request along with the API key. A root request is good for **at least three hours** of tile requests. **[V]**
- Content is **GLB with `KHR_draco_mesh_compression` everywhere**; no KTX2 — textures are JPEG. So it *can* be decoded without three.js, but not without the 279 KB Draco wasm. **[V]/[R]**
- Traversal is a deep explicit tileset tree with `geometricError`-driven refinement; a street-level view typically pulls tens to a few hundred GLBs of a few hundred KB each (order 10–50 MB per view). **[R] — not verified today, treat as an order-of-magnitude.**
- **ToS, verbatim** (developers.google.com/maps/documentation/tile/policies, fetched 2026-09-13) **[V]**:
  > "Subject to the terms of your Agreement, you must not pre-fetch, index, store, or cache any Content except under the limited conditions stated in the terms. Specifically, applications should use Map Tiles API for map visualizations. You may not use Map Tiles API for any non-visualization use cases, such as: Image analysis; Machine interpretation; Object detection or identification; Geodata extraction or resale; **Offline uses**, including for any of the above."
  > "Map Tiles API responses may include Cache-Control headers which should be implemented according to the HTTP protocol documentation… your client must respect the max-age value, the stale-while-revalidate value, the must-revalidate directive, and the private directive."
- General GMP ToS §"No Caching": *"Customer will not cache Google Maps Content except as expressly permitted under the Maps Service Specific Terms."* The Service Specific Terms grant explicit caching periods (30 days) only to **Address Validation** content — **no caching allowance exists for Map Tiles**. **[V]**
- **Consequence for Scape:** Google PR3DT is incompatible with OPFS offline regions and with feeding geometry into a depth buffer for a non-visualization purpose (the viewfinder computes occlusion, arguably "machine interpretation"). Treat it as online-only eye-candy or not at all.

---

## 4. Conversion tools (licence / last push verified via `gh api`, 2026-09-13) **[V]**

| Tool | Licence | Last push | Output |
|---|---|---|---|
| `citygml4j/citygml-tools` | Apache-2.0 | 2026-05-31 | CityGML↔CityJSON, LoD filtering, glTF/gltf export (Java) |
| `citygml4j/citygml4j` | Apache-2.0 | 2026-08-25 | Java API, CityGML 3.0 |
| `cityjson/cjio` | MIT | 2025-05-09 | CityJSON CLI: subset, reproject, `export --format glb/obj`, CityJSONSeq |
| `tudelft3d/val3dity` | **GPL-3.0** | 2026-08-26 | ISO19107 validation (GPL — offline use only) |
| `3DGI/tyler` | Apache-2.0 | 2026-07-27 | **CityJSON → 3D Tiles. This is 3DBAG's own tiler.** Rust. |
| `3DBAG/roofer` | GPL-3.0 | 2026-07-30 | LoD2.2 reconstruction from footprints+AHN |
| `tudelft3d/3dfier` | GPL-3.0 | 2026-09-08 | 2D footprints + DTM → LoD1 city model |
| `Geodan/pg2b3dm` | MIT | 2026-08-18 | PostGIS → 3D Tiles (b3dm/glb), implicit tiling support |
| `Gaia3D/mago-3d-tiler` | MPL-2.0 | 2026-08-11 | Java; CityGML/IFC/shp/OBJ → 3D Tiles 1.0/1.1 |
| `Oslandia/py3dtiles` | (NOASSERTION) | **archived 2025-07** — moved to gitlab.com/py3dtiles/py3dtiles | point clouds + b3dm |
| `CesiumGS/obj2gltf` | Apache-2.0 | 2025-11-19 | OBJ → glTF/GLB (npm 3.2.0, 159 KB) |
| `donmccurdy/glTF-Transform` | MIT | 2026-09-12 | Quantize, meshopt/Draco, weld, dedup, prune — the build-time workhorse |
| `njam/citygml-to-3dtiles` | Apache-2.0 | **2024-08-28 (stale)** | CityGML → 3D Tiles |
| `tordanik/OSM2World` | **MIT** | 2026-09-09 | OSM → OBJ/glTF/GLB with **roof shapes** (`roof:shape`, gabled/hipped/dome), offline, Java |
| FME (Safe Software) | commercial | — | Everything↔everything; used by 3D Tiles Nederland. **[R]** price ~ €4k+/yr |
| Blender + Blosm/blender-osm | GPL add-on (premium tier paid) | — | OSM → meshes; manual, not a pipeline. **[R]** |

Note: **3DBAG's own 3D Tiles are built with tyler and use `KHR_mesh_quantization` + `EXT_meshopt_compression`, not Draco** — i.e. a meshopt-only client (28 KB) can read them. **[V]** (3dtilesnederland.nl / 3DBAG docs)

---

## 5. Dataset sizes

| Dataset | Size | Source |
|---|---|---|
| **NRW LoD2 CityGML** (Germany) | **219.6 GB** uncompressed GML across **35,022** 1×1 km tiles (edition dated 2026-05-26) — **≈6.3 MB of CityGML per km²** | **[V]** summed `opengeodata.nrw.de/produkte/geobasis/3dg/lod2_gml/lod2_gml/index.json` |
| **3DBAG (Netherlands), full semantic** | **~68 GB** as FlatCityBuf, **~10.7 M buildings** (LoD1.2/1.3/2.2) | **[V]** cityjson.org/flatcitybuf |
| 3DBAG LoD1.3 geometry-only, whole NL | **1.9 GB** single file | **[V]** research.geodan.nl |
| **PLATEAU Tokyo 23 wards** | ~**9.5 GB** CityGML, ~1.7 M buildings, ~627 km² (LOD1+LOD2 subset) | **[R/partially V]** secondary sources only |
| **swissBUILDINGS3D 3.0 Beta** | tiles of 13.125 km², Solid + separated-element variants, 20 cantons + Zurich covered as of 2026-06-04; **total GB not published** | **[V]** swisstopo page (no size figure) |
| Bavaria LoD2, NYC 3D model | not verified today | **[R]** |

**Per-z14-tile estimate (derive, don't trust):** a z14 tile at 52°N is ≈1.51 km × 1.51 km ≈ **2.3 km²**. NRW density ≈ 280 buildings/km² ⇒ **~640 buildings per z14 tile**. LoD2.2 ≈ 40–60 triangles/building ⇒ ~32 k triangles, ~20 k vertices. Quantized 16-bit positions (6 B/vtx) + 16-bit indices (6 B/tri) = **~310 KB raw**; `EXT_meshopt_compression` typically 2.5–4× on quantized attributes ⇒ **~80–130 KB per z14 tile**, brotli on top ⇒ **~60–110 KB**. At that rate the whole Netherlands (10.7 M buildings) is **≈5–8 GB** of geometry-only tiles, and NRW ≈ 6–9 GB. **[R — arithmetic, not measured]**

---

## 6. Hosting economics — 50 GB stored, 200 GB egress/month

| Provider | Price basis (verified 2026-09-13 unless noted) | Monthly cost for 50 GB + 200 GB |
|---|---|---|
| **Cloudflare R2** | $0.015/GB-mo standard, **10 GB-mo free**, Class A $4.50/M, Class B $0.36/M, **$0 egress** | **≈$0.60** + ops (1 M range reads ≈ $0.36) → **~$1** **[V]** developers.cloudflare.com/r2/pricing |
| **Backblaze B2** | $0.006/GB-mo (first 10 GB free); egress free up to **3× stored** then $0.01/GB; API calls free | storage $0.24 + egress (150 GB free, 50 GB × $0.01) $0.50 = **~$0.75** **[V]** backblaze.com/cloud-storage/pricing |
| **Bunny Storage + CDN** | Storage HDD **$0.01/GB/region** (2 regions incl.), SSD $0.02/GB; CDN **from $0.002/GB**; **$1/mo minimum** | storage $0.50 + CDN ~$0.40–$2.00 → **~$1–$2.50** **[V]** bunny.net/pricing/storage |
| **Hetzner Object Storage** | **€6.49/mo** base incl. ~1 TB storage **and ~1 TB egress**; ingress + API calls free | **€6.49 flat** **[V via search, Apr 2026 pricing]** |
| **Hetzner Storage Box** | BX11 1 TB ≈ €3.81/mo, free traffic — but WebDAV/SFTP, **no S3 API, no CORS control** | ~€4, **not usable for browser Range+CORS** **[R]** |
| **AWS S3 + CloudFront** | S3 Standard $0.023/GB-mo; CloudFront $0.085/GB (first 10 TB, US/EU) with **1 TB/mo always-free** | storage $1.15 + egress $0 under free tier, else **$17** ⇒ **$1.15–$18** **[V via search, Q2 2026]** |
| **Hugging Face Hub (datasets)** | **1 TB free** public dataset storage; more at $8–18/TB/mo; supports HTTP Range | **$0** — but ToS is dataset hosting, not a CDN; rate-limits unknown **[V via search]** |
| **GitHub Releases** | 2 GB per file; no published bandwidth cap but ToS forbids CDN use | unusable at 50 GB **[V via search]** |
| **GitHub Pages** | **1 GB site limit**, 100 GB/mo soft bandwidth | unusable **[V via search]** |
| **Netlify (free, post-Sep-2025)** | 300 credits/mo, 20 credits/GB ⇒ **~15 GB/mo**, then sites pause | unusable **[V via search]** |
| **Vercel Hobby** | **100 GB/mo** fast data transfer, then project paused; Pro 1 TB | unusable at 200 GB **[V via search]** |

**Conclusion:** R2 and B2 are both roughly **$1/month** at this scale. R2's $0 egress makes cost independent of viewer count; B2 is cheapest at rest but egress-capped at 3×.

---

## 7. Packaging: PMTiles vs directory vs implicit tiling

- **PMTiles v3** is format-agnostic: `tile_type` `0x00 = Unknown / Other`, alongside MVT/PNG/JPEG/WEBP/AVIF; `tile_compression` likewise has `0x00 = Unknown`. **Nothing stops you storing meshopt-GLB or a custom quantized-triangle blob per tile.** Header is fixed-size with root directory; leaf directories are fetched on demand; **Clustered = 0x01** means tile data is ordered by TileID so consecutive tiles coalesce into one Range request. **[V]** spec/v3/spec.md
- Requires only HTTP `Range` + permissive CORS (`Access-Control-Allow-Origin`, `Access-Control-Expose-Headers: ETag`). R2, B2 and Bunny all serve Range with configurable CORS. `pmtiles@4.5.0` BSD-3-Clause, **380 KB unpacked / ~15 KB ESM dist**, one dep (`fflate`). **[V]**
- **How Protomaps hosts cheaply:** a single immutable .pmtiles object on R2/B2 behind a CDN; the client does the directory walk itself, so there is no server and no per-tile object cost — the entire planet basemap is one file.
- **Directory-of-files** wins on CDN cache granularity and simple offline `fetch`, loses on object count/Class-A ops and on being un-copyable as one artefact.
- **3D Tiles implicit tiling** gives the same URL-computable addressing as PMTiles but as many small files, plus availability subtrees; it's the right choice if you also want other 3D Tiles clients to consume your data.
- **A FlatCityBuf file is a fourth option**: one 68 GB object, spatial+attribute indexed, queried by Range, pure-TS reader, no tiling step at all.
- **Offline caching:** Safari 17+/iOS 17+ grants an origin **up to 60% of total disk** in a browser app (15% in a WKWebView-hosting app) via `navigator.storage.estimate()`; OPFS shares that quota with Cache API and IndexedDB. **Eviction:** with ITP on, an origin with **no user interaction in the last 7 days of browser use has script-created storage deleted** — so a PWA added to the Home Screen, or `navigator.storage.persist()`, matters for offline regions. **[V]** webkit.org/blog/14403

---

## 8. Coordinates: getting to local ENU metres

- **3D Tiles** is **ECEF (EPSG:4978)** throughout. `boundingVolume.region` is `[west, south, east, north, minHeight, maxHeight]` in **radians + metres above the WGS84 ellipsoid**; `box`/`sphere` are in the tile's transformed frame. Tile `transform` matrices are 4×4 **column-major**. b3dm feature tables may carry `RTC_CENTER` (ECEF offset) to keep GLB floats small. **[V]/[R]**
- **Pipeline:** ECEF → subtract eye ECEF → rotate by the ENU basis at the eye (`R = [[-sinλ, cosλ, 0], [-sinφcosλ, -sinφsinλ, cosφ], [cosφcosλ, cosφsinλ, sinφ]]`). ~30 lines, no library. Do it in **Float64** before down-casting to Float32 for the rasteriser, or precision fails at ~6.4 Mm radii.
- **CityGML/CityJSON national CRSs:** EPSG:28992 (RD/NL, NAP heights), 2056 (LV95/CH, LN02), 25832 (UTM32N/DE, DHHN2016), 6668 (JGD2011/JP, geoidal). All are **projected metres + orthometric (geoid) heights**.
- **The geoid trap:** ellipsoidal minus orthometric height is **+43 m (NL/NAP), ~+49 m (CH), +45–48 m (DE), ~+36 m (Tokyo)**. If your eye height comes from GPS (ellipsoidal) and the buildings from CityGML (orthometric), every building sits ~45 m too low — catastrophic for a viewfinder horizon. **[R]**
- **How cheap to fix:** the geoid undulation varies by <1 m over tens of km, so **a single constant per conversion region baked into the tile metadata is sufficient** — no grid needed at runtime. If you want a runtime grid: `egm96-universal@1.1.1` MIT but **5.55 MB unpacked** (ships the full 15′ grid) — far too heavy to bundle; better to sample it offline. `egm96@0.0.1` ISC is unmaintained. **[V]**
- **Reprojection:** `proj4@2.22.0` MIT, **845 KB unpacked**, pure JS, 2 deps, published 2026-08-31. But if you only need 2–4 known CRSs, hand-coding the Transverse Mercator / Oblique Stereographic (RD) / Oblique Mercator (LV95) forward-inverse is ~120 lines each and avoids the dependency entirely. Better still: **reproject to WGS84 at build time** in the conversion pipeline (cjio/tyler do this) and ship tiles already in ECEF or in tile-local ENU metres — then the browser needs no CRS code at all. **[V]** version/licence

---

## 9. The three cheapest end-to-end shapes (facts, not a recommendation)

1. **Own tiles, own format.** Offline: CityGML/CityJSON → cjio/citygml-tools → triangles → quantize 16-bit + meshopt → one blob per z14 tile in a PMTiles v3 archive with `tile_type=0` on R2. Browser cost: `pmtiles` (~15 KB) + `meshopt_decoder.js` (28 KB) + ~200 lines of TS. ~60–130 KB/tile; ~$1/month hosting.
2. **Consume published 3D Tiles** (3DBAG, 3D Tiles Nederland). Zero conversion, zero hosting. Browser cost: tileset.json walker + GLB reader + meshopt (3DBAG uses quantization+meshopt, **not** Draco) ≈ 30 KB + ~400 lines. Costs a live network dependency and a foreign LOD scheme.
3. **FlatCityBuf direct.** `@cityjson/flatcitybuf` (MIT, 276 KB, pure TS, no WASM) range-queries a single 68 GB 3DBAG file. Zero tiling work, zero hosting for NL; you triangulate CityJSON solids yourself (~150 lines). Only exists for datasets someone has published as .fcb.

Draco is the only thing that forces a ~280 KB WASM payload, and it is required essentially **only** by Google Photorealistic 3D Tiles — whose ToS forbids the offline caching Scape is built around.
