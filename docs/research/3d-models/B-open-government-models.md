Research date: 2026-09-13

# Open government 3D building / landmark models — catalogue for Scape

Legend: **CORS ✅** = verified today with `curl -sI -H 'Origin: http://localhost:5173'`. **[recalled]** = from memory, not re-verified today. Everything else = verified today via WebSearch result text (source listed), not by fetching the byte stream.

---

## 1. CORS-tested endpoints (verified today, 2026-09-13)

| Endpoint | What | Result |
|---|---|---|
| `https://data.3dbag.nl/v20250903/cesium3dtiles/lod22/tileset.json` (also `lod13`, `lod12`) | NL 3DBAG, 3D Tiles | **200, `access-control-allow-origin: *`** ✅ |
| `https://data.3dbag.nl/v20240420/3dtiles/lod22/tileset.json` | older 3DBAG path, still live | **200, ACAO `*`** ✅ (1.6 MB root) |
| `https://data.3dbag.nl/v20250903/tile_index.fgb` | FlatGeobuf tile index → per-tile `.city.json` / `.gpkg` | **200, ACAO `*`**, 5.7 MB ✅ |
| `https://3d.geo.admin.ch/ch.swisstopo.swissbuildings3d.3d/v1/tileset.json` | swissBUILDINGS3D 3D Tiles | **200, ACAO `*`** ✅. Root region = lon 5.96–10.49°, lat 45.82–47.80° → **Zermatt covered** |
| `https://3d.geo.admin.ch/ch.swisstopo.swisstlm3d.3d/v1/tileset.json` | swissTLM3D 3D Tiles | **200, ACAO `*`** ✅ |
| `https://3d.geo.admin.ch/ch.swisstopo.vegetation.3d/v1/tileset.json` | swisstopo vegetation | **200, ACAO `*`** ✅ (1.6 MB root) |
| `https://3d.geo.admin.ch/ch.swisstopo.terrain.3d/v1/layer.json` | **quantized-mesh-1.0**, z0–18, EPSG:4326, TMS, octvertexnormals, tiles `20250101/{z}/{x}/{y}.terrain` | **200, ACAO `*`** ✅ — *far better than Terrarium z14 for the Matterhorn* |
| `https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo.swissalti3d/items?bbox=…` | swissALTI3D STAC search | **200, ACAO `*`** ✅ |
| `https://data.geo.admin.ch/ch.swisstopo.swissalti3d/swissalti3d_2019_2616-1091/swissalti3d_2019_2616-1091_0.5_2056_5728.tif` | **0.5 m DTM GeoTIFF, 11.4 MB, 1 km tile, Zermatt/Matterhorn area, 2019** | **200, ACAO `*`** ✅ |
| `https://assets.cms.plateau.reearth.io/assets/ad/52340f-…/13104_shinjuku-ku_…_bldg_3dtiles_…_lod2/tileset.json` | PLATEAU Shinjuku LoD2 3D Tiles | **200, ACAO `*`** ✅ (423 KB root) |
| `https://www.virtualcitymap.de/datasource-data/f892f6af-180a-4eef-917f-5ff03c260b32/tileset.json` | Berlin LoD2 (untextured, open data) 3D Tiles | **200, ACAO `*`** ✅ |
| `https://data.cityofnewyork.us/resource/5zhs-2jue.json` | NYC Building Footprints (Socrata SoQL, `height_roof`, `ground_elevation`, ft) | **200, ACAO `*`** ✅ |
| `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer` | USGS 3DEP dynamic elevation (1 m where flown) | **200, ACAO `*`** ✅ |
| `https://www.opengeodata.nrw.de/produkte/geobasis/3dg/lod2_gml/` | NRW LoD2 CityGML bulk | **200, ACAO `*`** ✅ (directory listing, re-hostable + directly fetchable) |
| `https://data.geobasis-bb.de/geobasis/daten/3d_gebaeude/lod2_gml/` | Brandenburg LoD2 CityGML | **200, ACAO `*`** ✅ |
| `https://download.data.grandlyon.com/files/…` | Lyon file server | **ACAO reflects origin (`http://localhost:5173`)** ✅ |
| `https://data.wien.gv.at/daten/geo` (WFS) | Vienna geodata | **200, ACAO `*`** ✅ |
| `https://donnees.montreal.ca/` (CKAN) | Montréal catalogue | **200, ACAO `*`** ✅ |
| `https://api.plateauview.mlit.go.jp/datacatalog/3dtiles/…` | PLATEAU "stable URL" resolver | **404** on the two paths I tried (`13101-bldg-lod2-latest`, `all-bldg-lod2-2025`); ACAO `*` present. Path syntax needs confirming against docs.plateauview.mlit.go.jp |
| `https://vectortiles.geo.admin.ch/3d-tiles/ch.swisstopo.swissbuildings3d.3d/…` | old host | **403** — use `3d.geo.admin.ch` instead |
| `https://geodaten.bayern.de/odd/…`, `https://opengeodata.lgln.niedersachsen.de/` | Bavaria / Lower Saxony | 200 but **no CORS header** → download-and-rehost only |
| `https://portal.opentopography.org/API/globaldem` | global DEM API | **401** — needs a free API key (ACAO `*`) |
| `https://daten.gdz.bkg.bund.de/produkte/` | BKG open-data mirror | 200, ACAO `*`, but **no `lod1`/`lod2` directory** under `produkte/`, `produkte/dlm/`, `produkte/sonstige/` → **LoD2-DE is not on BKG's free bulk mirror** |

---

## 2. Priority entries for the two test scenes

### Zermatt → Matterhorn (Switzerland)
- **swissALTI3D** — 0.5 m and 2 m bare-earth DTM, GeoTIFF + XYZ, 1 km tiles, Zermatt tiles are 2019 vintage, ~11 MB per 0.5 m tile. Licence: swisstopo OGD (free, commercial use allowed, attribution "© swisstopo"). STAC API and the GeoTIFFs are both CORS `*`. **This is the single biggest accuracy win available for this scene** — the Matterhorn silhouette is terrain, not buildings, and 0.5 m vs ~20 m Terrarium is two orders of magnitude.
- **swisstopo terrain 3D Tiles (quantized-mesh)** — ready-made LOD pyramid, CORS `*`, no key. Cheaper path than tiling swissALTI3D yourself; resolution capped by the pyramid (z18).
- **swissBUILDINGS3D 3.0** — LoD2 with roof shapes, nationwide; free OGD download (Shapefile/DXF/FileGDB/CityGML per swisstopo product page) and a public 3D Tiles service (CORS `*`). Covers Zermatt village.

### Hoboken → 30 Hudson Yards (New York)
- **NYC 3-D Building Model (DoITT), `tnru-abg2`** — LoD2 CityGML 894 MB / ESRI Multipatch 251 MB / DGN 744 MB, ~100 iconic buildings in true LoD2 with ridges and domes. **Vintage: 2014 aerial survey.** 30 Hudson Yards topped out 2019 → **it is NOT in this model**. Licence: NYC Open Data terms of use (effectively free reuse with attribution) — *verify the exact wording before shipping paid*.
- **NYC DCP "3D Model by Community District"** — same 2014 geometry, converted to `.3dm`; dataset row last updated 2024-10-30 but the *survey* is still 2014.
- **NYC Building Footprints `5zhs-2jue`** — live, continuously edited, CORS `*`, SoQL queryable. Verified today: a 200 m circle around 40.7539/−74.0007 returns BIN 1088961 with `height_roof` **1265 ft (385.6 m), construction_year 2018** — that is 30 Hudson Yards. So the **LoD1 prism for 30 HY is available and accurate**, but its distinctive angled crown / observation-deck wedge is not modelled anywhere in NYC open data. For a sub-degree silhouette at 600 mm you would need a hand-built or third-party model of that one tower.
- **USGS 3DEP** — 1 m DEM over NYC/NJ, ImageServer CORS `*`.
- **Open City Model** (`github.com/opencitymodel/opencitymodel`) — LoD1 CityGML, >125 M US buildings from Microsoft footprints + heights. ODbL-ish/permissive [recalled — check the repo licence file]. Useful as a US-wide fallback, not for precision.

---

## 3. Catalogue by country

Most rows below come from **awesome-citygml** (`github.com/OloOcki/awesome-citygml`, README fetched today, self-reported "last update 18/05/2026", 22 countries / 68 regions, >215 M buildings), cross-checked where noted. Sizes are mostly unpublished; I mark "n/p".

### Netherlands
| Item | LoD | Formats | Licence | Tiled endpoint |
|---|---|---|---|---|
| **3DBAG** (TU Delft / 3DGI), ~10 M buildings, updated ~quarterly (`v20250903` current) | 1.2, 1.3, 2.2 | CityJSON, OBJ, GPKG, **3D Tiles**, WFS/WMS | CC BY 4.0 [recalled] | **Yes, CORS ✅** (see §1) |
| AHN (AHN4/AHN5) — national LiDAR DTM/DSM, 0.5 m | — | GeoTIFF, LAZ | CC0/CC BY [recalled] | via PDOK services |
| Rotterdam 3D | 1–2 | CityGML, selectable export | city open data | viewer export only |

### Germany
Nationwide **LoD2-DE** (BKG): ~58 M buildings, standardised roof forms, ~1 m height accuracy, licence **Datenlizenz Deutschland – Namensnennung 2.0** (`https://www.govdata.de/dl-de/by-2-0`), catalogued at `gdz.bkg.bund.de/index.php/default/3d-gebaudemodelle-lod2-deutschland-lod2-de.html` and on data.europa.eu. **Caveat verified today:** the free bulk mirror `daten.gdz.bkg.bund.de/produkte/` has no LoD2 directory, so in practice you assemble Germany from the Länder portals — all of which are DL-DE/BY-2.0 and free.

| State / city | LoD | Format | Endpoint |
|---|---|---|---|
| **NRW** | 1 + 2 | CityGML | `opengeodata.nrw.de/produkte/geobasis/3dg/lod2_gml/` — **CORS ✅** |
| **Brandenburg** | 1 + 2 | CityGML | `data.geobasis-bb.de/geobasis/daten/3d_gebaeude/lod2_gml/` — **CORS ✅** |
| **Bavaria** | 2 (+DGM1, ortho) | CityGML | `geodaten.bayern.de/opengeodata/…?pn=lod2` — 200 but **no CORS** |
| **Baden-Württemberg** | 1 + 2 | CityGML | `opengeodata.lgl-bw.de` |
| **Lower Saxony** | 1 + 2 | CityGML | `opengeodata.lgln.niedersachsen.de/#lod2` — **no CORS** |
| **Berlin** | 2 + **textured mesh** | CityGML, mesh | `businesslocationcenter.de/berlin3d-downloadportal/`; **3D Tiles CORS ✅** (`virtualcitymap.de`) |
| **Hamburg** | 1 + 2, multi-year, **manually improved roofs + textures** | CityGML | `suche.transparenz.hamburg.de/dataset/3d-stadtmodell-lod2-de-hamburg2` |
| Saxony, Saxony-Anhalt, Thuringia, Hesse, Rhineland-Palatinate, Mecklenburg-Vorpommern, Schleswig-Holstein, Bremen | 1 + 2 | CityGML | state portals (see awesome-citygml links) |
| Leipzig, Hannover, Freiburg, Potsdam | 2 | CityGML/DXF/DWG | city portals |
| **Ingolstadt**, **TUM tum2twin** | **LoD3** (+textured LoD2) | CityGML | GitHub releases — best open LoD3 reference data |

### Switzerland
swissBUILDINGS3D 3.0 (LoD2, free OGD; 2.0 is CityGML but paid), swissTLM3D, swissALTI3D, swissSURFACE3D LiDAR. All swisstopo OGD: free, commercial use OK, attribution "© swisstopo". Public 3D Tiles for buildings/TLM3D/vegetation and quantized-mesh terrain — all CORS ✅. `swissnames3d.3d` 3D Tiles returned **403** today.

### Austria
Vienna: LoD1 "Baukörpermodell" + LoD2 "Generalisiertes Dachmodell", tiled download from `wien.gv.at`, CC BY 4.0 (data.gv.at). WFS CORS ✅. Linz: textured LoD2, `geo.data.linz.gv.at`.

### France
- **IGN LiDAR HD** — Licence Ouverte 2.0, classified LAZ (ground/veg/building/water/bridge) ≥10 pts/m², plus MNT/MNS/MNH GeoTIFF at 0.5 m. ~80% of metropolitan France by end-2025, full coverage planned end-2026. Best route to LoD2 roofs anywhere in France (you reconstruct).
- **Lyon Métropole** — textured CityGML LoD2 (2012/2015/2018 vintages) *and* a **2023 photomesh in 3D Tiles**, `data.grandlyon.com`, Licence Ouverte; file server CORS reflects origin ✅.
- **BDNB / BD TOPO** — nationwide LoD1 heights, GeoPackage, Licence Ouverte / etalab.
- Bordeaux (3DS), Marseille (LoD2 benchmark + ALS).

### Rest of Europe
| Country | Dataset | LoD | Notes |
|---|---|---|---|
| **Poland** | GUGiK, ~15.5 M buildings | 1 nationwide, **2 for 10 voivodeships only** | free, geoportal.gov.pl; `rgugik` R package automates county downloads |
| **Czechia** | Prague (geoportalpraha.cz) | 2 + bridges + 1 m DEM | city-wide |
| **Estonia** | Maa-amet nationwide | 1 + 2, >800 k buildings, roof shapes | free for everybody; also DTM/DSM |
| **Finland** | Helsinki (semantic LoD2 **+ 7.5 cm photogrammetric reality mesh 2015/2017**, CC BY 4.0, DAE/FBX/OBJ/**3D Tiles**/3MX); Espoo (to "LoD3"=textured); Vantaa (textured LoD2); Kuopio | 1–2 | Helsinki mesh is the best free photogrammetric city mesh in Europe |
| **Luxembourg** | national: **textured LoD2** + **LoD3 bridges & rail**, trees | 1–3 | data.public.lu |
| **Belgium** | Brussels (SketchUp), Namur (textured LoD2 CityGML) | 2 | Flanders GRB has 3D building shells [recalled, unverified] |
| **Latvia** | Riga | 1 + 2 + mesh + point clouds | georiga.eu |
| **Spain** | Barcelona LoD1/LoD2 | 1–2 | Catastro gives nationwide footprints+floors [recalled] |
| **UK** | **No open LoD2.** OS OpenData (OGL, free) = OS Open Zoomstack/OpenMap — footprints, **no heights**. **OS MasterMap Building Height Attribute is premium** (sample only on OS Data Hub). Glasgow LoD1/2 on Zenodo (research, City3D). EA LiDAR (England, OGL) is the practical free height source [recalled for EA licence] |
| **Ireland** | Dublin 500×500 m CAD sample only | 2 | no national open 3D |
| **Italy** | not in awesome-citygml; regional only [recalled] | — | |
| **Nordics** | Denmark/Norway/Sweden **not covered by awesome-citygml**; I could not verify GeoDanmark 3D, Kartverket or Stockholm/Gothenburg licences today — **uncertain** | — | |

### Asia-Pacific
| Item | LoD | Notes |
|---|---|---|
| **Japan Project PLATEAU** | 1, 2, and 3 for selected areas | **CC BY 4.0**; >210 municipalities, target 500 cities by 2027. CityGML source on `geospatial.jp/ckan/dataset/plateau`; converted **3D Tiles 1.0 + MVT** served from `assets.cms.plateau.reearth.io` — **CORS ✅**. Stable "composite" URLs via `api.plateauview.mlit.go.jp/datacatalog/3dtiles/<area>-<type>-lod<N>-<year>/tileset.json`; my two guesses 404'd, get the exact slugs from `docs.plateauview.mlit.go.jp/datasets/3d-tiles/`. **The single best open LoD2/LoD3 corpus worldwide.** |
| **Hong Kong** | photorealistic 3D of >210 k buildings + 5 k infrastructure + 9 100 km 3D Pedestrian Network | LandsD 3D Mapping; data.gov.hk terms; formats "native and open" — exact formats/licence **unverified** |
| **Singapore** | HDB public housing **LoD1** only (CityJSON, OBJ), `github.com/ualsg/hdb3d-data` | Virtual Singapore itself is not open |
| **South Korea / Taiwan** | V-World and Taiwanese open 3D exist [recalled]; **searches today returned nothing concrete — treat as unverified** |
| **Australia** | Melbourne **3D textured photomesh 2018** (OBJ+MTL+JPG, Data Vic, CC BY); Victoria statewide Vicmap Buildings LoD1–2, some textured; Adelaide FBX/SKP/Multipatch; Brisbane/Sydney/Perth mainly commercial (Vexcel, MetroMap) |
| **New Zealand** | LINZ NZ Building Outlines — **2D roof outlines only**, CC BY 4.0. No national 3D |

### Americas
| Item | LoD | Notes |
|---|---|---|
| **NYC** | see §2 | 2014 vintage LoD2; live LoD1 heights via Socrata |
| **Boston** | 1–2 + terrain | bostonplans.org, CAD + Esri Multipatch |
| **Philadelphia** | textured LoD2, 2008/2010/2015 | PASDA GDB |
| **Cambridge MA** | 1 + terrain | CAD/Multipatch |
| **Austin** | 2 | KMZ + LiDAR |
| **Washington DC / SF / Chicago / LA / Portland / Seattle** | not in awesome-citygml; DC and SF publish Multipatch/shapefile massing models [recalled — unverified today] |
| **USA nationwide** | Open City Model, LoD1, >125 M buildings | derived from Microsoft footprints |
| **USGS 3DEP** | 1 m / 10 m DEM, public domain | ImageServer **CORS ✅** |
| **Montréal** | **textured LoD2 CityGML** + terrain + ALS | donnees.montreal.ca, CKAN **CORS ✅**; CC BY 4.0 [recalled] |
| **Toronto** | LoD1 3D Massing | open.toronto.ca |
| **Calgary** | LoD2, CAD + GDB | data.calgary.ca |
| **Winnipeg** | ~240 k LoD1 shapefiles | — |
| **Vancouver / Ottawa** | not in awesome-citygml; Vancouver publishes building footprints+heights [recalled] |

### Global
- **GlobalBuildingAtlas** (TUM, 2025): LoD1 for **2.75 billion** buildings (97% of the world), heights from Planet imagery + DL, GeoJSON. `mediatum.ub.tum.de/1782307`, paper in ESSD 2025. This is the obvious *global fallback* replacing "untagged → 5 m".
- Aggregators: **awesome-citygml**, CityGML Wiki "Open Data Initiatives", TU Delft `3d.bk.tudelft.nl/opendata/opencities/`.

---

## 4. Honest uncertainty
- Exact licence text (and whether it survives a *paid* app) was **not** re-read today for: 3DBAG, NYC, Montréal, Melbourne, PLATEAU per-city supplements, Hong Kong. Check each before monetising.
- Nordics, Italy, Korea, Taiwan, and several US cities are gaps in this pass.
- Total download sizes are published for almost none of these; the only figures verified are NYC (894 MB CityGML / 251 MB Multipatch / 744 MB DGN) and per-tile sizes (swissALTI3D 0.5 m ≈ 11 MB/km², 3DBAG tile index 5.7 MB).
- `3d.geo.admin.ch` and `data.3dbag.nl` set plain `ACAO: *` with no `Vary` complications — safe for `fetch()` and for Service Worker / Cache API offline storage.
