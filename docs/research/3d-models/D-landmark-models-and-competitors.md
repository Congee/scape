Research date: 2026-09-13

# D — Individual landmark models, and how competitors get them

Method note: `WebFetch` was disabled and the reader MCP failed to connect, so pages were read with `curl` + HTML stripping and the Sketchfab v3 API was queried directly. Printables, Poly Pizza, 3D Warehouse, the Sketchfab blog and Epic's newsroom are JS-only or Cloudflare-gated; those rows are marked **recalled** or **search-sourced**.

## 0. How accurate is "accurate enough"?

The Moon and Sun are both ~0.5° across. Scape's test scene is Hoboken → 30 Hudson Yards, ~2.7 km. At that range 0.5° subtends ≈ 23.6 m, so **one Moon diameter ≈ 24 m of building**. A 2 m error in modelled height or in the horizontal position of a spire is ≈ 1/12 of a Moon — visible, but not fatal. A 10 m error (the typical spread between OSM `height`, "architectural height", "roof height" and "tip height" for a skyscraper) is **0.4 Moon diameters** and will wreck a planned alignment.

The dominant error term is therefore the *height datum and ground elevation*, not mesh tessellation: a 300-vertex prism with the right heights beats a 400 000-vertex photogrammetry mesh with a 1.5° heading error. That is exactly why PlanIt's 327-vertex / 13 KB "30 Hudson Yards" model is adequate — **the hard part is georeferencing, not geometry**. (Arithmetic verified; 0.5° is standard, cf. https://petapixel.com/2016/08/25/plan-capture-perfectly-aligned-moonrise-photo/)

## 1. PlanIt! Pro — the only competitor that actually ships landmark meshes

| Fact | Value | Status |
|---|---|---|
| App price (iOS, US) | **$9.99** one-time, "Planit Pro: Photo Planner", v10.7.29, updated 2026-09-02 | **verified** via `itunes.apple.com/lookup?id=898876435`, 2026-09-13 |
| 3D model IAP | **"3D Model (A Month)" $0.99** and **"3D Model (A Year)" $5.99** | **verified** by scraping https://apps.apple.com/us/app/planit-pro-photo-planner/id898876435, 2026-09-13 |
| Feature launch | "Intro to the 3D Model and Marker Sharing Feature of Planit Pro on Android", published **2021-02-11** | **verified** (YouTube metadata, https://www.youtube.com/watch?v=5oPnFhWrRPQ) |
| Who makes the models | Users. PlanIt lets subscribers **upload their own 3D models and share them with other Planit Pro users**; the library grows as the community contributes | search-sourced (https://wherehowardgoes.com/2024/10/4966/) |
| Public catalogue of models | **None found.** planitphoto.com is a single static landing page (10 user-guide PDFs, no 3D-model guide among them); discovery is in-app only | **verified** (listed all `pdfs/*.pdf` links; grepped guides 01/02/04/05 for "3D model", "obj", "sketchup", "collada" — zero hits) |
| Any Sketchfab presence | No. The `planitpro` tag on Sketchfab returns **1 unrelated model** ("Indian Maharaja") | **verified** via `api.sketchfab.com/v3/search?tags=planitpro` |
| Stated modelling source (Google Earth / 3D Warehouse / photogrammetry / hand-built) | **No public statement found.** PlanIt's own docs and site say nothing about provenance | verified absence within this search budget |
| Examples cited by reviewers | Houses of Parliament (London), Notre-Dame de la Garde (Marseille) | search-sourced |

**Reading of it:** PlanIt's moat is a 5-year-old crowdsourced library behind a $6/yr paywall with no export and no public index — closed by obscurity, not by geometry. The transferable lessons are the ~300-vertex complexity budget and the *community upload path* as the acquisition mechanism.

## 2. Everyone else: nobody ships landmark meshes

| App | Landmark geometry | Status |
|---|---|---|
| **PhotoPills** | None. 3D AR overlay of Sun/Moon/Milky Way/Polaris on the live camera feed; no building models, no terrain occlusion | search-sourced |
| **TPE 3D** (Photo Ephemeris) | **Terrain only** — DEM-based 3D landscape with shadow playback; explicitly a terrain product, no buildings | search-sourced |
| **Sun Surveyor** | AR + a **Google Street View overlay** (its differentiator: view from a remote location). Uses Google's imagery, not meshes it owns | search-sourced |
| **PhotoTransit** | Transit/alignment geometry over maps; no 3D building models | recalled |

The competitive gap is a one-horse race against PlanIt.

## 3. Sketchfab — alive, downloadable, and under new ownership

The 2024–25 "Epic is killing Sketchfab downloads" panic did **not** end in a shutdown, and ownership changed again in August 2026.

| Fact | Status |
|---|---|
| **KitBash3D acquired Sketchfab and ArtStation from Epic Games**, announced **2026-08-10** ("ArtStation and Sketchfab are moving from Epic Games to join KitBash", alongside Greyscalegorilla); both sides state **no change to how creators access or use the platforms** | **verified** — read https://kitbash3d.com/pages/kitbash-acquires-sketchfab-and-artstation-kitbash3d (Epic's own newsroom copy is Cloudflare-gated) |
| Sketchfab **Store closed 2024-10-22**; paid marketplace moved to Fab, but **free / CC models stayed on Sketchfab**. CC licences do **not** exist on Fab at all (no CC0/BY-SA/BY-NC/BY-ND) — which is why museum and CC content stayed put, and why historians objected | search-sourced (https://80.lv/articles/historians-are-concerned-about-epic-games-sketchfab-to-fab-migration) |
| **The v3 REST API is live today.** `GET api.sketchfab.com/v3/search?type=models&downloadable=true&…` returns HTTP 200 with results; `GET /v3/models/{uid}` returns full licence objects; `GET /v3/licenses` enumerates the vocabulary | **verified by direct call, 2026-09-13** |
| Licence vocabulary (verified from `/v3/licenses`): `cc0`, `by`, `by-sa`, `by-nd`, `by-nc`, `by-nc-sa`, `by-nc-nd`, `free-st` (Free Standard), `st` (Standard), `ed` (Editorial) | **verified** |
| `/v3/models/{uid}/download` needs an OAuth token (`401` unauthenticated) | **verified** |
| Download archives: **glTF ZIP (`scene.gltf` + `scene.bin` + `textures/`)**, GLB, USDZ, `source` — but **FBX/OBJ source formats are not served through the API**, only via the website | search-sourced (docs pages returned empty to curl) |

### Licence mix for landmarks (verified counts, 2026-09-13)

Paging `/v3/search` with `downloadable=true`, capped at 8 pages (192):

| Query | Downloadable total | CC0 | CC-BY | CC-BY-NC | CC-BY-ND |
|---|---|---|---|---|---|
| Eiffel Tower | 152 | 0 | **143** | 1 | 0 |
| Golden Gate Bridge | 31 | 0 | **25** | 2 | 0 |
| landmark building | >192 | 0 | **>192** | 3 | 1 |

**This is the single most useful licensing finding: downloadable landmark content on Sketchfab is overwhelmingly plain CC-BY** — commercial use allowed, derivatives allowed, attribution required. NC and ND are statistically negligible (1–3 per query), and CC0 is effectively absent (uploaders must opt in and rarely do). CC-BY is compatible with an open-source *and* later-paid Scape, provided attribution ships with the app.

### Quality spot-check (verified: name, licence slug, vertex/face counts from the API)

| Landmark | Best-matching model | Verts | Faces | Licence |
|---|---|---|---|---|
| **30 Hudson Yards** | **"10 & 30 Hudson Yards"** by *NanoRay* — https://sketchfab.com/3d-models/10-30-hudson-yards-9bc3204c872f45cda717eedc36dfcc9b | **6 912** | 9 412 | **CC Attribution (`by`)**, `isDownloadable: true` |
| Eiffel Tower | "( FREE ) La tour Eiffel" | 60 896 | 147 604 | downloadable |
| Golden Gate Bridge (usable) | "Golden Gate Bridge" | 26 327 | 51 196 | downloadable |
| Empire State Building | "Empire State Building" | 309 678 | 439 857 | downloadable |
| One Vanderbilt | **no direct hit** (top results were MetLife Building, 383 Madison Ave) | — | — | — |
| Tower Bridge, Sagrada Família | **no direct hit** — results were fantasy/sci-fi assets and unrelated sculpture | — | — | — |

Two conclusions. **Coverage is spiky** — the test-scene landmark is present and CC-BY, while Tower Bridge, One Vanderbilt and Sagrada Família return nothing usable. And **vertex budgets are wrong by 2–3 orders of magnitude** for a CPU rasteriser (300k–2M-vertex photogrammetry meshes need aggressive decimation, with unverified silhouette accuracy). None carries georeferencing: position, scale and heading are all manual.

## 4. Trimble 3D Warehouse

| Fact | Status |
|---|---|
| ToU "Last updated: April 1, 2017", still served; *"you may use 3D Warehouse to **view, search, locate, download, and Distribute Models**"* | **verified quote** (https://embed-3dwarehouse-classic.sketchup.com/tos/) |
| **General Model License**: uploaders grant end users a *"perpetual, sublicensable, irrevocable, worldwide, royalty-free, and non-exclusive license to reproduce, adapt, modify, publish, publicly perform and display, distribute, **create derivative works of**, make, sell, offer to sell, import, and use the Models"* | search-sourced (the GML page itself is JS-gated; wording consistent across multiple secondary sources) |
| Practical effect | **The most permissive terms of any major library** — redistribution in a commercial or open-source app, and conversion, both allowed, no attribution required |
| **The catch** | The GML is only as good as the uploader's right to grant it, and 3D Warehouse is full of models traced from Google Earth or re-uploaded from elsewhere. Per-model provenance vetting is unavoidable |
| Formats | `.skp` natively; Collada/DAE download for many models. **No glTF** — conversion via SketchUp or Blender/Assimp is required | recalled |
| Google Earth legacy geo-located buildings | Google retired user-built geo-modelling (Building Maker) when 3D Buildings went auto-photogrammetry in 2012–13. Legacy models survive on 3D Warehouse, often with geolocation intact in the `.skp`, but coverage is unmaintained and **pre-2013 — so no 30 Hudson Yards (2019) or One Vanderbilt (2020)** | recalled |
| API | No public documented download API comparable to Sketchfab's | recalled |

## 5. Free / CC repositories

| Source | Landmark coverage | Typical licence | Format | Verdict for Scape |
|---|---|---|---|---|
| **Sketchfab** | Best of any free source; spiky | **CC-BY dominant** (verified) | glTF/GLB/USDZ via API | **Primary candidate** |
| **Poly Pizza** | ~10 600 models incl. the rescued **Google Poly archive** (Poly shut 2021-06-30); ~69 % CC-BY, rest CC0; free API key | CC-BY / CC0 | glTF | Stylised low-poly game assets — right licence, wrong geometry |
| **Smithsonian Open Access** | 2 000+ models, API + GitHub data repo | **CC0** | OBJ, glTF | Artefacts, fossils, statues — **essentially no buildings** |
| **Scan the World** (MyMiniFactory) | Large CC scan library | CC, **per-object** | STL | Sculpture, not architecture at building scale |
| **MiniWorld3D** (Printables/MMF/MakerWorld) | **The best free landmark series that exists** — famous buildings since 2014, 60+ authors | **Per-model, frequently CC-BY-NC or -NC-ND** (print-community default; page JS-gated, **unverified**) | STL | Print miniatures: thickened, simplified, no georeferencing. **NC/ND would block a paid Scape** |
| Thingiverse / Printables / Cults3D | Many landmarks | Mixed; **NC and ND common**; Cults3D restricts file redistribution | STL | Per-model vetting; print-oriented |
| **Wikimedia Commons** | Small STL set | CC-BY-SA / CC0 / PD | STL | Thin; **SA is viral if the model ships in the repo** |
| **OpenGameArt / Kenney / Quaternius** | Game props and kits | CC0 / CC-BY / GPL | OBJ, glTF | Stylised — **no real landmarks** |

Pattern: **the CC0 sources have no landmarks; the sources with landmarks are CC-BY (Sketchfab) or NC/ND (the 3D-printing world)**.

## 6. Paid marketplaces and city-model vendors

**The decisive clause is the same everywhere: "incorporated / non-extractable".** TurboSquid's and CGTrader's Royalty-Free Licenses permit embedding a model in a larger product only if end users cannot retrieve the geometry standalone. (verified: https://www.turbosquid.com/licensing, https://help.cgtrader.com/hc/en-us/articles/360015124437-Royalty-Free-License)

**Consequence: a public open-source repository containing the converted mesh breaches every one of these licences**, whatever Scape itself is licensed as — the geometry is retrievable by definition. Paid-marketplace models only work if Scape ships them obfuscated from a closed channel, which contradicts the open-source option. Free3D is TurboSquid-owned and inherits the same RF terms.

| Source | Licence | Redistribute in a distributed app? | Price | Format |
|---|---|---|---|---|
| TurboSquid | Royalty-Free | Only if non-extractable; **never open-source** | Eiffel $19–$499; Empire State $45–$399; generic skyscraper $30–$150 | FBX/OBJ/max |
| CGTrader | Royalty Free / Editorial | Same incorporation rule; Editorial = non-commercial only | Empire State **$9.99–$35**; landmarks ~$20–$150 | FBX/OBJ/glTF |
| Free3D / 3DExport / Hum3D | RF variants | Same pattern (3DExport/Hum3D text unverified) | varies | varies |
| AccuCities (London) | 3-yr company-wide multi-use | Use-only | **£250+VAT per 0.25 km² LOD2 tile; £500+VAT LOD3** | DWG/SKP/FBX |
| Vu.City / CyberCity3D / Aerometrex | SaaS seat or enterprise data licence | **No** / negotiated only | custom, undisclosed | proprietary, OBJ, 3D Tiles |

### The open-government alternative

Verified open city models, redistributable and open-source-compatible, mostly **CC-BY**:

| Dataset | Licence | Format | LOD |
|---|---|---|---|
| **PLATEAU** (Japan) | free/open, attribution | CityGML | LOD0–2 (+bridges) |
| **3D BAG** (Netherlands) | Dutch open data | CityJSON, GeoPackage, OBJ | LOD1.2/1.3/2.2 |
| **swissBUILDINGS3D** | swisstopo **OGD BY** | CityGML 2.0 | ~LOD2 |
| **Berlin** | Open Data, resale allowed | CityGML | LOD2, ~550k buildings |
| **Helsinki** | **CC BY 4.0** | CityGML 2.0 | LOD1/2 |
| **Vienna** | **CC BY 4.0** | CityGML/DXF | LOD2.1, LOD2.4 subset |
| **NYC DoITT 3D Building Model** | NYC Open Data terms (PD-like) | Shapefile/CityGML | LOD1 citywide + ~100 landmarks at LOD2 |

**Caveat that hits the test scene:** the NYC DoITT model derives from a **2014 aerial survey**, so 30 Hudson Yards (2019) and One Vanderbilt (2020) are **almost certainly absent** (assessed, not confirmed by dataset query). Open city data covers Tokyo/Berlin/Helsinki/Vienna/Zurich well and **fails precisely on new Manhattan supertalls**.

### Trade dress / editorial traps

The Eiffel Tower structure is public domain (copyright expired 1993), but SETE claims the **night-time illumination** as a separately copyrighted work requiring authorisation for commercial reproduction — hence many marketplace landmarks listed **Editorial Use Only**. Affects Scape only if it renders lit facades; a daytime silhouette is unaffected.

## 7. Making your own — and the OSM result that may make most of this moot

**Overpass API queried live, 2026-09-13.** OpenStreetMap's Simple 3D Buildings scheme (`building:part`, `height`, `min_height`, `roof:shape`, `roof:height`, `roof:direction`) is far better populated on trophy landmarks than expected:

| Landmark | `building:part` ways nearby | Main way height | Tag quality |
|---|---|---|---|
| **30 Hudson Yards** | **64** (incl. the wider Hudson Yards complex) | `height=395` | Per-tier `height`, `roof:shape`, `roof:height`, `roof:direction`, `roof:material` |
| **Eiffel Tower** | **27** (pillars, platforms, roof segments) | `building=tower`, `height=330`, `roof:shape=pyramidal` | **Fractional-metre** `min_height` (e.g. `276.13`), per-level parts |
| **Empire State Building** | **70** (setback tiers + antenna) | `height=443.2`, `building:levels=102` | Setbacks to ~330 m base, spire to 443.2 m |
| **Tower Bridge** | ~15–20 bridge-specific (249 in a 250 m radius) | towers `height` up to `46.5` | `min_height`, `roof:shape=pyramidal`, `layer` for the high walkway |

This is the most consequential finding in this slice. **Scape already ingests OSM PBF tiles and has its own rasteriser.** Upgrading the extruder from flat prisms to full Simple 3D Buildings — honouring `building:part`, `min_height` and `roof:shape` — yields a correctly-georeferenced, correctly-scaled, ODbL model of 30 Hudson Yards and the Eiffel Tower with **no asset pipeline, no licence audit, no per-model georeferencing and no download**. It is the only option where position, scale and heading are free by construction.

Caveats: coverage outside famous landmarks is inconsistent (verified for these four only), lattice structures reduce to solid massing, and ODbL share-alike attaches to *derived databases*, not rendering output.

### Tooling, if models are still authored by hand

| Tool | Licence / price | Relevance |
|---|---|---|
| **OSM2World** | **LGPL** | Exports glTF/GLB/OBJ; implements much of S3DB — a reference implementation Scape could mirror rather than depend on |
| **Blosm** (ex-blender-osm) | Free tier functional, pay-what-you-want; Premium ~€10–16 (recalled) | S3DB-aware OSM import, SRTM terrain, and Google 3D Tiles |
| **SketchUp Free (web)** | **Still free in 2026** | Free tier exports **STL, OBJ, DAE**; **glTF is Pro/Go only**. "Add Location" geolocation is free |

**Google Photorealistic 3D Tiles are not a legal source.** Google's terms prohibit derivative use including *"programmatically reading and recording measurements (heights, distances, elevations)"* and any *"geodata extraction or resale, offline uses"* — the product is licensed for immersive visualisation only. Blosm's Google 3D Cities import works technically, but capturing tiles into a redistributable model breaches the Maps Platform terms. Treat as closed.

### Photogrammetry (2026)

| App | Free tier | Free export | Rights | Paid |
|---|---|---|---|---|
| **Meshroom** (AliceVision) | full | OBJ/PLY/STL | **MPL-2.0, unrestricted** | free |
| **RealityScan** (Epic) | full, 300 photos/scan | mesh formats | free | — |
| **KIRI Engine** | unlimited scans + exports advertised | OBJ/GLB | unrestricted per marketing | Pro tiers |
| **Polycam** | capped | **glTF only** | OBJ and commercial exports are paid | $30/mo, $150/yr |
| **Luma AI** | limited | **splats only, no mesh** | unsuitable for a mesh pipeline | — |
| **Apple Object Capture** | free API | USDZ via wrappers | depends on wrapper | free |

**Ground photogrammetry of a 300 m skyscraper is not viable.** Dense surroundings block sightlines to all four façades, close vantage points give poor incidence angles, and drones are capped at **120 m / 400 ft AGL** in most jurisdictions — under a third of 30 Hudson Yards. Photogrammetry suits bases, bridges and ornament, not supertalls.

### Hand-modelling effort (hobbyist, from footprint + published heights)

| Subject | Hours |
|---|---|
| Boxy tower with setbacks (30 Hudson Yards class) | **2–5** |
| Distinct roof/spire (Empire State class) | **8–15** |
| Lattice/truss (Eiffel Tower, Tower Bridge) | **20–40+** |

## 8. Verdict

1. **OSM Simple 3D Buildings first.** Verified-good tagging on the test-scene landmark (`height=395`, 64 `building:part` ways), ODbL, already in Scape's tile pipeline, georeferencing free by construction. Highest value per unit of work by a wide margin.
2. **Sketchfab as the hero-landmark supplement.** API live under new KitBash ownership; downloadable landmarks overwhelmingly **CC-BY** (143/152 Eiffel, 25/31 Golden Gate); glTF delivery; a CC-BY "10 & 30 Hudson Yards" at 6 912 verts. Costs: attribution UI, decimation, manual pose per model.
3. **Paid marketplaces are structurally incompatible with open-sourcing Scape** — the anti-extraction clause is universal.
4. **Open government CityGML is clean and CC-BY**, but NYC's model is a 2014 capture predating both 30 Hudson Yards and One Vanderbilt.
5. **Copy PlanIt's mechanism, not its library:** a community upload path with manual georeferencing at a ~300-vertex budget, which the 24 m-per-Moon arithmetic shows is ample.
