# Tech research: offline-capable photography sun/moon/Milky Way planning app

Research date: 2026-09-11. Versions confirmed via `npm view`, GitHub releases API, and vendor docs at that date.

---

## 1. Astronomy libraries

- **astronomy-engine** (npm): latest `2.1.19`, published 2023-12-14. MIT, zero deps. https://www.npmjs.com/package/astronomy-engine · https://github.com/cosinekitty/astronomy — GitHub has commits as recent as 2025-01-27 (alive, just no new npm release since late 2023).
  - Size: ~114 KB minified, ~46.8 KB gzip (README targets <120 KB minified).
  - Accuracy: README claims ±1 arcminute vs. NOVAS C 3.1 / JPL Horizons; truncated VSOP87 (planets) + NOVAS-derived lunar model; valid for millennia before/after present, no hard cutoff.
  - Rise/set/transit: `SearchRiseSet`, `SearchHourAngle` (culmination), `SearchAltitude` (generic — used for civil/nautical/astronomical twilight at −6°/−12°/−18°).
  - Moon phase/illumination: `MoonPhase`, `SearchMoonQuarter`, `NextMoonQuarter`, `Illumination`.
  - Equatorial↔horizontal: `Equator`, `Horizon`, `EquatorFromVector`, `VectorFromHorizon`, `HorizonFromVector` — **plus direct galactic rotation matrices `Rotation_EQJ_GAL`/`Rotation_GAL_EQJ`** (IAU 1958 frame), making galactic-center alt/az a simple compose-and-rotate with no manual RA/Dec constant needed.
  - Eclipses/transits: `SearchLunarEclipse`/`NextLunarEclipse`, `SearchGlobalSolarEclipse`/`NextGlobalSolarEclipse`, `SearchLocalSolarEclipse`/`NextLocalSolarEclipse`, `SearchTransit` (Mercury/Venus).
  - No quantified perf benchmarks published beyond size/accuracy goals.
- **suncalc** (npm): latest `2.0.2`, last modified 2026-09-02. https://github.com/mourner/suncalc — 15 KB raw / 4.6 KB gzip. Note: `npm view suncalc license` reports "Proprietary" in registry metadata but the repo's actual LICENSE file is 2-clause BSD — verify before adopting. Recently rewritten as dual ESM/CJS (rolldown build).
  - Covers: sun position/times (sunrise/sunset/solar noon/civil&nautical dawn-dusk/night/nadir), moon position, moon illumination fraction/phase/angle, moon rise/set.
  - Lacks: no eclipse prediction, no galactic-coordinate support, lower-precision simplified formulas (less accurate for the Moon than astronomy-engine/astronomia).
- **astronomia** (npm): latest `4.2.0`, last published/committed 2025-08-30. MIT. https://github.com/commenthol/astronomia — JS translation (via Go port) of Meeus's *Astronomical Algorithms* (2nd ed.). Has `coord` module with Ecliptic/Equatorial/Horizontal/**Galactic** transforms, plus `eclipse`, `moonphase`, `moonposition`, `moonillum`, `planetposition` (full VSOP87). Reasonably maintained but smaller community; lacks astronomy-engine's ready-made high-level search functions — more manual composition required.
- **WASM VSOP87/ELP2000**: no mature, permissively-licensed WASM package found.
  - `vsop87` (npm, gmarty) `1.0.5` (2019) — pure JS, not WASM, unmaintained.
  - `astronomy-bundle` MIT, stable `7.7.7` (2024-04-15), scoped rewrite `@astronomy-bundle/*` `9.38.0` (2026-07-26) — pure TS/JS, full VSOP87 + Meeus, built-in solar-eclipse Besselian-element calc (1900–2100 / −1999–3000 catalogs). No WASM. https://github.com/andrmoel/astronomy-bundle-js
  - `@behaver/elp2000-moon-gecc` (2019) — pure-JS ELP2000, effectively abandoned.
  - `@aulunarcana/ephemeris` (npm `1.1.1`, 2026-07-21) — claims Rust→WASM, "NASA-grade" — but license is non-commercial-only, **not open-source**. Not suitable.
  - Swiss Ephemeris bindings exist (`swisseph` `0.5.17`, `sweph` `2.10.3-8`, `swisseph-wasm` `0.1.0` very early) but Swiss Ephemeris is AGPL/commercial dual-license and JPL-DE based, not VSOP87/ELP2000 — licensing non-starter.
  - Conclusion: nobody has needed a WASM VSOP87/ELP2000 build because truncated-VSOP87-in-JS (astronomy-engine) already hits arcminute accuracy at ~114 KB.

**Recommendation: use `astronomy-engine` (MIT, 2.1.19)** — only option with a complete ready-made API for rise/set/transit, twilight, moon phase/illumination, built-in galactic-coordinate rotation (trivializes galactic-center alt/az), and full solar/lunar eclipse + transit search, at ~47 KB gzipped with zero dependencies.

---

## 2. Maps, offline tiles & terrain

**MapLibre GL JS**
- Latest stable: **v6.9.0**, released 2026-09-09. https://github.com/maplibre/maplibre-gl-js/releases
- Globe projection: stable since **v5.0.0** (Jan 2025). `map.setProjection({type:'globe'})`, `GlobeControl` UI, auto-switches to mercator ~zoom 12. https://maplibre.org/maplibre-gl-js/docs/API/classes/GlobeControl/
- 3D terrain (raster-dem): `addSource('terrain',{type:'raster-dem', tiles/url, encoding:'mapbox'|'terrarium', tileSize:256})` + `map.setTerrain({source, exaggeration})`. Native Mapbox Terrain-RGB and Mapzen Terrarium encodings. https://maplibre.org/maplibre-gl-js/docs/API/classes/RasterDEMTileSource/
- Hillshade: native `type:'hillshade'` layer, `hillshade-method` (incl. `'multidirectional'`), illumination direction/shadow/highlight color paint props.
- Sky/atmosphere: native `type:'sky'` layer — `sky-color`, `horizon-color`, `fog-color` (needs terrain), blend props; still flagged experimental/evolving. https://maplibre.org/maplibre-style-spec/sky/
- CustomLayerInterface: `id`, `type:'custom'`, required `render(gl, args)`, optional `onAdd(map, gl: WebGL2RenderingContext)`/`onRemove`/`prerender`, `renderingMode?:'2d'|'3d'`. Shares MapLibre's own WebGL2 context directly — no separate canvas needed. `'3d'` mode shares the map's depth buffer (correct occlusion); `'2d'` mode has no depth access (needs offscreen framebuffer + `prerender` for depth-aware rendering). https://maplibre.org/maplibre-gl-js/docs/API/interfaces/CustomLayerInterface/

**PMTiles**
- `pmtiles` npm: **4.5.0** (2026-08-10). Separate Go CLI (`go-pmtiles`): **v1.31.2** (2026-07-22).
- Spec: PMTiles v3, unchanged since 2022 — ~97% less initial-request overhead vs v2 (512KB→16KB), no v2 metadata cap. https://github.com/protomaps/PMTiles
- `pmtiles extract INPUT.pmtiles OUTPUT.pmtiles --bbox=MIN_LON,MIN_LAT,MAX_LON,MAX_LAT` (also `--region=geojson`, `--maxzoom`, `--minzoom`, `--download-threads`, `--dry-run`). Format-agnostic (works on vector and raster/terrain archives alike — confirmed via Mapterhorn's own docs using this exact command on Terrarium-encoded terrain PMTiles). https://docs.protomaps.com/pmtiles/cli

**Protomaps free basemap builds** (build.protomaps.com)
- Daily dated builds, e.g. `https://build.protomaps.com/20260730.pmtiles`, browsable at maps.protomaps.com/builds.
- Full planet (z0–15): **~120 GB**. Europe-sized regional extract: **~30–50 GB**. Coarse zoom-0–6-only extract: as small as **~60 MB**. https://docs.protomaps.com/basemaps/downloads
- License, precisely: tiles/data = **ODbL** (OSM attribution required), map style design = **CC0**, generator code = **BSD-3**. https://github.com/protomaps/basemaps/blob/main/LICENSE_DATA.md

**`@protomaps/basemaps`**: npm `5.7.2` (2026-03-10). TS package generating a full MapLibre style (70+ layers) for the Protomaps vector schema; 5 built-in flavors: light, dark, white, grayscale, black.

**Terrain/elevation datasets**
- **AWS Terrain Tiles / Mapzen Terrarium** (`s3://elevation-tiles-prod`): still actively hosted 2026 (AWS Open Data Registry, us-east-1 + eu-central-1 replica), community-maintained despite Mapzen's 2017 dissolution. URL: `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`. **Not blanket CC0** — composite of mostly public-domain sources (SRTM, GMTED2010, ETOPO1, USGS 3DEP) plus some attribution-required regional sources (Australia CC BY 4.0, Canada OGL, Austria CC BY 3.0 AT, Norway CC BY 4.0, NZ CC BY 3.0 NZ, UK OGL v3, EU-DEM/Copernicus). Format: Terrarium PNG (`elevation=(R*256+G+B/256)-32768`).
- **Mapterhorn**: "Protomaps for terrain" — global Terrarium-encoded 512px WebP raster-dem as single PMTiles archives, download.mapterhorn.com (`planet.pmtiles` z0–12 global + regional high-res z13+). Baseline Copernicus GLO-30 refined with 1m US, 2m Canada, 5m Australia, 0.5m Switzerland (swissALTI3D). **Combined size ≈9.8 TiB from 14.5 TiB source data.** Pipeline BSD-3; per-region licenses vary (tracked in attribution.json); NLnet-funded, Cloudflare R2-hosted, active 2026.
- **Copernicus DEM**: GLO-30 (30m) / GLO-90 (90m), DSM not bare-earth. AWS Open Data (Sinergise COGs) + OpenTopography mirror. **Not CC0** — specific license requiring attribution notice carried to downstream users + liability disclaimer; GLO-30 coverage incomplete in some countries.
- **MapLibre + local PMTiles raster-dem terrain: confirmed working fully offline.** Register `pmtiles` protocol (`maplibregl.addProtocol('pmtiles', new pmtiles.Protocol().tile)`), point `raster-dem` source at `pmtiles://…pmtiles` with `encoding:'terrarium'`, feed hillshade + `setTerrain()` — works against a purely local static file server. Mapterhorn itself is a production instance of this pattern. https://docs.protomaps.com/pmtiles/maplibre

---

## 3. 3D rendering options

- **MapLibre GL JS has no native 3D Tiles/photorealistic-mesh support** (confirmed gap). GH issue #3794 closed via a custom-layer example combining three.js + third-party `3d-tiles-renderer`, citing deck.gl's `Tile3DLayer` as the recommended plugin approach. Mapbox GL JS v3's proprietary `batched-model` layer can't be replicated for licensing reasons.
- **Google Photorealistic 3D Tiles**: needs a Google Maps Platform API key, billed via Map Tiles API. **1,000 free tile requests/month**, then **$6.00/1,000 requests (CPM)**; 2026 update raised root-tileset daily quota from 300 to **10,000/day/project**.
- **deck.gl**: `deck.gl`/`@deck.gl/core` npm **9.4.0** (2026-09-05). `Tile3DLayer` renders OGC 3D Tiles + Cesium 3D Tiles + Esri I3S (via `Tiles3DLoader`), point clouds + glTF meshes, built via Cesium partnership. **Interleaved rendering with MapLibre confirmed**: `MapboxOverlay({interleaved:true})` shares MapLibre's own WebGL2 context, correctly depth-sorted against MapLibre's native layers (ordering via `beforeId`/`slot`; needs maplibre-gl ≥3 + WebGL2); also works with MapLibre v5 globe view. Non-interleaved `overlaid:true` mode exists but doesn't intermix depth correctly.
- **CesiumJS**: npm `cesium` **1.145.0** (2026-09-01). Full standalone 3D globe engine, own terrain/imagery/scene-graph architecture, not MapLibre-compatible. Verdict: **overkill** unless photorealistic global 3D Tiles becomes a hard requirement — MapLibre + deck.gl is the lighter-weight fit for this app.
- **Three.js**: npm `three` **0.186.0** (r186, 2026-09-08). Well suited as a small separate widget (celestial-sphere / viewfinder AR panel showing sun/moon/Milky Way relative to camera FOV) rather than the main renderer — trivial standalone `WebGLRenderer` canvas alongside the map. Precedent: MapLibre's own "3D model with three.js" examples, three.js's Sun-Earth-Moon scenegraph example.

---

## 4. Framework & tooling

**Versions (2026-09-11):**
- Svelte `5.57.0`, SvelteKit (`@sveltejs/kit`) `2.70.3`
- SolidJS (`solid-js`) `1.9.15`, SolidStart (`@solidjs/start`) `2.0.5`
- React `19.3.0`, TanStack Router (`@tanstack/react-router`) `1.170.35`
- Vite `8.3.0`
- `vite-plugin-pwa` `1.3.0` — confirmed wraps Workbox (`generateSW`/`injectManifest` strategies internally)
- Workbox (`workbox-build`/`workbox-window`) `7.4.1` — repo not archived, pushed as recently as 2026-09-02, but release cadence has slowed sharply (v7.0.0 May 2023 → v7.4.1 May 2026); README states ownership handed to Chrome's Aurora team — maintenance-mode stewardship, not active feature development
- TypeScript `7.0.2` (Go-based native-compiler rewrite line)
- Bun `v1.4.2` (2026-09-05); ~98% npm compatibility, production-used widely (incl. Claude Code CLI itself); caveats for 72h+-running processes and native-addon-heavy apps
- Vitest `5.0.0`
- Playwright (`playwright`/`@playwright/test`) `1.63.0`

**Framework comparison for a canvas/map-heavy SPA:**
- **SvelteKit + Svelte 5 runes**: `$state`/`$derived`/`$effect` compile away to near-zero framework overhead; `$derived` is lazy (recomputes only when read); `$effect` maps naturally onto imperative canvas/map-library sync. No virtual DOM — compiler-driven surgical DOM updates close the perf gap with signal-first frameworks. PWA tooling identical maturity to the others (Vite-level, not framework-level). Ecosystem growing fast but less battle-tested specifically for map/canvas apps than React's.
- **SolidStart**: finest-granularity reactivity of the three — signals wire directly to the DOM node/consumer, no component re-rendering at all. Benchmarks show ~50–70% better runtime perf and ~5–10x faster DOM updates than React, ~6x smaller bundles; cited real-world case of a high-frequency trading dashboard migrating from React to Solid for exactly this kind of update-heavy UI. Smaller ecosystem, thinner map/canvas library supply, smaller hiring pool, SolidStart itself comparatively young.
- **React 19 + Vite + TanStack Router**: concurrent rendering (urgent vs. transition lanes) lets heavy recomputation yield to input gestures — reported 40–60% reduction in blocking time. Still virtual-DOM-based, inherently more re-render overhead per state change (though canvas rendering itself typically bypasses React's diffing via imperative refs). TanStack Router stable/production-ready as of June 2026; TanStack Start is Release-Candidate. By far the largest ecosystem/hiring pool/library surface.

**Recommendation:**
- **Pick SvelteKit + Svelte 5 runes.**
- Near-Solid-level fine-grained/compiled reactivity for cheap frequent canvas/map redraws, with a much larger ecosystem and hiring pool than SolidStart.
- React+TanStack is the safer long-term-ecosystem bet, but its virtual-DOM model adds unneeded overhead for this app's update-heavy profile relative to Svelte 5's compiled reactivity.

---

## 5. Offline storage

- **OPFS vs IndexedDB browser support (2026)**: OPFS in Chrome/Edge 86+, Firefox 111+, Safari 15.2+ (OPFS-only surface, no full File System Access API with file pickers in Firefox/Safari). OPFS unavailable in Safari Private Browsing; private-mode quota/availability stricter in Firefox/Safari than Chromium.
- **Performance**: OPFS reported 3–4x faster than IndexedDB for binary blobs — bypasses IndexedDB's structured-clone serialization cost, which compounds across thousands of small tile writes. OPFS's synchronous `createSyncAccessHandle` read/write is worker-only, avoiding async event-loop overhead per transaction. **For hundreds of MB–low GB of tile blobs, OPFS is the better primary store**; keep IndexedDB (or a thin metadata table) alongside for indexed/queryable metadata.
- **Quota/eviction (2026)**: Chrome/Edge best-effort origin quota up to **60%** of disk. Safari/WebKit 17+: browser-app origin quota up to **60%**, all-origins combined up to **80%** of disk (non-browser WebKit apps lower: 15%/20%). Storage Buckets model: default **best-effort** bucket can be silently cleared under pressure; **persistent** bucket (`navigator.storage.persist()`) is exempt from the general low-storage eviction sweep — but neither browser prompts the user; both auto-grant/deny via internal heuristics. **Safari caveat**: WebKit's own storage-policy post lists a third, independent eviction trigger — non-interaction/ITP-driven purge (historically a 7-day cap on all script-writable storage) — with no documentation that `persist()` overrides it. Treat Safari as materially less reliable than Chromium for guaranteed long-term persistence; design for tile-cache re-hydration after a Safari long-idle purge.
- **IndexedDB wrappers**: `idb` npm `8.0.3` (thin promise wrapper, minimal overhead); `dexie` npm `4.4.6` (richer: indexes, query chaining, reactive `liveQuery`). **Recommendation**: use `idb` for a lightweight metadata/index table if OPFS holds the actual tile bytes; reach for Dexie only if richer queries or reactive UI binding over tile metadata are needed.

---

## 6. Geocoding & timezone

- **Photon** (komoot, github.com/komoot/photon): OSM-based geocoder on OpenSearch (ES/Lucene fork), Apache-2.0. Fully self-hostable/offline (import prebuilt JSON dump, run locally, no live internet needed). Planet-wide index ≈95 GB disk (2026, growing ~10%/yr), 64GB+ RAM recommended, Java 21+. Weekly prebuilt world + per-country dumps at download1.graphhopper.com/public. Active: latest release 1.3.0 (2026-08-07), last push 2026-09-07, 3,045 stars.
- **Nominatim public API**: hard cap **1 req/sec**; scripted/bulk further capped at 4 req/min, single thread/machine. Banned: autocomplete via API, systematic/grid queries, scraping, reselling; 2026-added clause bars no-code/LLM-tooling embedding without disclosure. Policy recommends self-hosting for anything beyond light use. Underlying OSM data: ODbL.
- **Pelias** (github.com/pelias/pelias): modular OSS geocoder on Elasticsearch, MIT. Actively maintained 2026 (last commit 2026-07-24, 3,583 stars), maintained by Geocode Earth (ex-Mapzen team) since 2013. Fully offline/self-hosted via official Docker stack (github.com/pelias/docker), instance up in <30 min, no API key needed self-run.
- **GeoNames cities dumps** (download.geonames.org/export/dump/): cities500.zip ~13.0 MiB (~185k rows, pop>500), cities1000.zip ~10.3 MiB (~130k rows), cities5000.zip ~5.4 MiB (~50k rows), cities15000.zip ~3.2 MiB (~25k rows, capitals). Tab-delimited UTF-8, 19 cols incl. lat/long, admin levels, population, IANA timezone. License: **CC BY 4.0**.
- **Offline timezone-from-lat/lon**: `tz-lookup` npm `6.1.25` (2022), ~148 KB unpacked, CC0-1.0, unmaintained since 2020. `geo-tz` npm `8.1.8` (2026-07-12, actively maintained), ~70 MB unpacked, MIT, full timezone-boundary-builder polygons — most accurate at borders. `@photostructure/tz-lookup` npm `11.6.1` (2026-08-08) — **exists**, ~86 KB unpacked, CC0-1.0; maintained fork of abandoned tz-lookup rebuilt from timezone-boundary-builder data, adds TS types/CI/signed releases, ~10x smaller/~100x faster than geo-tz per its own benchmark but ~30% global mismatch rate vs. geo-tz (~10% on inhabited points).

**Recommendation: use `geo-tz`** — for a twilight-planning app, correctness at timezone boundaries (exactly where border-adjacent shoot locations would get wrong sunrise/twilight times) outweighs the ~70 MB offline bundle cost.

---

## 7. Elevation profile / horizon computation

- **No mature, purpose-built "terrain horizon line from DEM tiles" JS library exists** — this would need to be built largely from scratch.
- Closest reusable foundation: `maplibre-contour` (github.com/onthegomap/maplibre-contour) — actively maintained, decodes raster-dem/Terrain-RGB tiles to meters-elevation client-side in a Web Worker, stitches neighbor tiles; built for contour lines, not horizons, but its DEM-decode/worker architecture is directly reusable. `@watergis/terrain-rgb` — point-elevation query only, no horizon logic.
- Path-profile (not radial-skyline) plugins found: `watergis/maplibre-gl-elevation`, `@maptiler/elevation-profile-control`, `opengeos/geolibre-elevation-profile`, `Raruto/leaflet-elevation` (npm `leaflet.elevation`) — all chart elevation along a drawn line, not a 360° horizon.
- Viewshed demos exist but don't fit: `solowt/Client-side-viewshed` (Esri-dependent, unmaintained), `inveneo/RFAnalysisJS` (GPL-3.0, calls legacy Google Elevation API), `thingless/viewshed` (MIT but server-side Docker), `fanvanzh/viewshed-analysis` (sparse/abandoned). npm `skyline`/`skyline-js` are false leads (solve the building-silhouette "Skyline Problem," unrelated).
- Best algorithmic blueprint: **HORAYZON** (github.com/ChristianSteger/HORAYZON, Python + Intel Embree ray tracing), published paper describing ray-based horizon-angle/sky-view-factor algorithm.
- No MapLibre or deck.gl viewshed/line-of-sight plugin exists; deck.gl has only a `TerrainLayer` (DEM mesh rendering, no LOS analysis).
- **PeakVisor**: no engineering blog/patent describing its skyline algorithm (Google Patents search for "PeakVisor" returns zero). Confirmed only: ~30m DEM + Sentinel-2 pipeline, offline 3D terrain meshes — likely GPU-rasterization + depth-buffer silhouette extraction (inference, not confirmed), not open-source.
- **PeakFinder**: developer stated publicly that "horizon calculations are cpu intensive," implying **server-side** computation, with a WASM plugin for client-side panorama rendering. Official PeakFinder-API (github.com/Fabiz/PeakFinder-API) documents embedding/export (raster panorama or vector horizon-line polyline) but not the algorithm. Data: SRTM + LiDAR + OSM peaks. No patents found, no open-source components.
- Best actual public algorithm write-up (adjacent, not PeakVisor/PeakFinder): **HeyWhatsThat** (heywhatsthat.com/techfaq.html) — documents per-azimuth radial sweep against a heightfield tracking max elevation angle, with WGS84 Earth-curvature + atmospheric-refraction correction (~3.6 arcsec/mile); server-side C++ against raw SRTM, not open-sourced.
- **Practical path**: reuse maplibre-contour-style DEM tile decoding, implement a from-scratch radial horizon sweep (per-azimuth ray march, max elevation angle, curvature+refraction correction) following the HeyWhatsThat method — likely in a Web Worker or WASM for performance.

---

## 8. Tide data

- **NOAA CO-OPS API** (api.tidesandcurrents.noaa.gov/api/prod/): free, no key. US stations only. Provides `predictions` (harmonic) and `water_level` (observed) as distinct products, plus `hourly_height`, `high_low`, `daily_mean`, `monthly_mean`, `currents`, OFS model output. Datums moved to separate Metadata API. **Harmonic constituents freely downloadable**: `GET .../mdapi/prod/webapi/stations/{id}.json?expand=harcon` returns amplitude/phase/speed per constituent, free, no key. No published hard rate limit (docs ask for throttling); per-request time-window caps apply (e.g. 1-min data limited to 4 days/request).
- **WorldTides API** (worldtides.info/developer, v2.0.2): free tier = 100 one-time signup credits (not recurring). Pay-as-you-go: $9.99→20k credits up to $199→1M credits. Monthly subs: $4.99/mo→20k up to $499/mo→10M credits/mo. 1 credit = 7-day high/low extremes; +1 for 30-min sampled heights; +1 for full datum list. ToS requires fresh predictions per unique end-user request — restricts bulk offline caching/redistribution.
- **UK Admiralty (EasyTide/UKHO Tidal API)**: UK/Ireland/Channel Islands/Isle of Man only. Discovery tier free (1yr, current+6 days, 607 stations); Foundation £120/yr ex VAT (current+13 days, 20 calls/sec, 20k calls/mo); Premium £300/yr ex VAT (historical+current+1yr, 100 calls/sec, 100k calls/mo). Separate free non-API consumer site gives 7-day predictions for 600+ ports.
- **Harmonic-constant offline prediction: feasible.** `@neaps/tide-predictor` (npm `0.11.0`, MIT, github.com/openwatersio/neaps) — actively maintained, implements full IHO TWCWG constituent system (395 constituents incl. compound), IHO/Schureman(1940) nodal corrections, subordinate-station offsets; input format matches NOAA's `harcon` output directly. Companion `@neaps/tide-database` (XTide-TCD-compatible) has an npm-vs-GitHub license discrepancy (MIT vs `NOASSERTION`) — verify before shipping. XTide itself is GPL but its `libtcd` constituent library is separately Public Domain; no maintained JS/WASM port found — `@neaps/tide-predictor` is a from-scratch reimplementation instead. **Practical path**: pre-fetch/cache NOAA's free harmonic constituents per US station, predict offline via `@neaps/tide-predictor`; UK/global coverage still needs live WorldTides/Admiralty calls since their ToS doesn't clearly permit caching/redistributing constituent-equivalent data.

---

## 9. Star catalogs & Milky Way imagery

- **HYG database**: current **v4.1** (`hygdata_v41.csv`), github.com/astronexus/HYG-Database (mirror: codeberg.org/astronexus/hyg). Size: 33,932,548 bytes (~33.9 MB uncompressed); prior v4.0 gzip ~13.6 MB. License: **CC BY-SA 4.0** (older v2.x/v3.x were CC BY-SA 2.5). Combines Hipparcos + Yale BSC (HR/Yale IDs) + Gliese, with IAU proper names.
- **Yale Bright Star Catalog (BSC5)**: 9,110 stars, complete to V≈7 mag. Canonical host: tdc-www.harvard.edu/catalogs/bsc5.html (mirror: HEASARC bsc5p). Binary file 291,548 bytes; ASCII (`ybsc5.gz`) also available. No explicit license on the Harvard/Yale page itself; third-party mirror github.com/brettonw/YaleBrightStarCatalog relicenses its packaging as **MIT**.
- **ESO Milky Way panorama** (eso0932a, GigaGalaxy Zoom, credit "ESO/S. Brunier", 2009-09-14): publicly downloadable at **6000×3000 px (18 MP)**; the ~800 MP gigapixel original is not distributed (available only on request from the photographer). License: ESO's current general policy (eso.org/public/outreach/copyright) states **CC BY 4.0** — note the individual image page's own meta tag still has stale "CC BY 3.0" wording, so treat the copyright policy page (4.0) as authoritative and double-check before commercial reuse.
- **NASA SVS "Deep Star Maps 2020"** (svs.gsfc.nasa.gov/4851, published 2020-09-09, updated 2022-08-12): 1.7 billion stars (Hipparcos-2/Tycho-2/Gaia DR2 + Yale BSC/UCAC3/XHIP), equirectangular OpenEXR half-float, **5 resolutions**: 4K (4096×2048, 34.3 MB), 8K (8192×4096, 124.5 MB), 16K (16384×8192, 422.9 MB), 32K (32768×16384, 1.4 GB), 64K (65536×32768, 3.8 GB). Public domain per NASA/GSFC standard media policy.

---

## 10. Meteor showers & constellation lines

- **IMO (imo.net)**: no JSON/CSV/API found — only an annual **PDF bulletin** (e.g. `imo.net/files/meteor-shower/cal2026.pdf`) plus plain HTML per-year landing pages. (Site was in maintenance mode at fetch time 2026-09-11.)
- Machine-readable alternative: **stellarium-addons** (github.com/Stellarium/stellarium-addons) ships `addons/src/modules/MeteorShowers/showers.json` — per-shower designation, generic + year-by-year ZHR, radiant RA/Dec (`radiantAlpha`/`radiantDelta`) + drift — effectively a JSON port of the IMO Working List of Visual Meteor Showers. Repo license field is **null** (no explicit license) — verify before commercial use.
- **Stellarium skycultures** (github.com/Stellarium/stellarium/tree/master/skycultures): whole repo is **GPL-2.0**; default culture renamed `western`→`modern`, lines stored as JSON arrays of Hipparcos star-ID pairs (not GeoJSON). No separate permissive license for the data — inherits GPL-2.0, a real copyleft concern for a closed-source commercial app.
- **d3-celestial** (github.com/ofrohn/d3-celestial, Olaf Frohn): **BSD-3-Clause**. npm `d3-celestial` latest `0.7.35` (2020-11-05, stale but functional). Constellation lines/DSOs/Milky Way outline shipped as **GeoJSON**. Star data from XHIP (Extended Hipparcos Compilation) cross-referenced with HD-DM-GC-HR-HIP-Bayer-Flamsteed + Gliese; constellation lines/boundaries from Stellarium skycultures + IAU data + Davenhall & Leggett boundary catalog; Milky Way outline from Vieira's catalog; DSOs from Saguaro Astronomy Club DB v8.1. d3-celestial's own packaging is permissively licensed (BSD-3), though upstream academic VizieR/CDS sources have their own (generally attribution-friendly) norms worth a quick check if redistributing verbatim.

---

## Recommended stack

| Concern | Choice | Why |
|---|---|---|
| Astronomy engine | **astronomy-engine** (npm 2.1.19, MIT) | Only lib with rise/set/transit, twilight, moon phase/illumination, built-in galactic-coordinate rotation, and full eclipse search — ~47 KB gzipped, zero deps |
| Map renderer | **MapLibre GL JS** (6.9.0) | Native globe projection, raster-dem terrain, hillshade, sky/atmosphere, CustomLayerInterface — all free/open, no vendor key |
| Offline map tiles | **PMTiles** (4.5.0) + Protomaps basemap builds + `@protomaps/basemaps` style (5.7.2) | Single-file offline archives, `pmtiles extract` for bbox regions, ODbL data / CC0 style / BSD-3 code |
| Offline terrain | **Mapterhorn** PMTiles terrain (Terrarium-encoded) or AWS `elevation-tiles-prod` | Single-file offline DEM compatible with MapLibre raster-dem + hillshade, mostly permissive licensing (check regional attribution) |
| Supplementary 3D widget | **Three.js** (0.186.0) | Lightweight standalone celestial-sphere/viewfinder panel; not the main map renderer |
| 3D Tiles (if ever needed) | **deck.gl** `Tile3DLayer` interleaved with MapLibre (9.4.0) | Only realistic path to OGC/Cesium 3D Tiles without adopting full CesiumJS |
| Framework | **SvelteKit + Svelte 5 runes** (svelte 5.57.0 / kit 2.70.3) | Compiled fine-grained reactivity fits frequent canvas/map redraws; larger ecosystem than SolidStart |
| Build/PWA tooling | **Vite** (8.3.0) + **vite-plugin-pwa** (1.3.0, wraps Workbox 7.4.1) | Standard, framework-agnostic offline/PWA pipeline |
| Language/test/E2E | **TypeScript** 7.0.2, **Vitest** 5.0.0, **Playwright** 1.63.0; **Bun** 1.4.2 as pkg manager/runner | Current, actively maintained tooling |
| Offline tile storage | **OPFS** for tile bytes + **idb** (8.0.3) for metadata index | OPFS ~3–4x faster for bulk binary blobs; idb keeps a lightweight queryable key index |
| Geocoding | **Photon** (self-hosted, offline JSON dump) or **Pelias** (self-hosted Docker) | Both fully offline-capable, actively maintained, avoid Nominatim's 1 req/sec public-API cap |
| Offline gazetteer fallback | **GeoNames cities15000/cities5000** | CC BY 4.0, few MB, good enough for place search without a full geocoder index |
| Timezone lookup | **geo-tz** (8.1.8) | Boundary-accurate (timezone-boundary-builder polygons), worth the ~70 MB for correct twilight times near borders |
| Horizon/elevation profile | Custom-built: reuse **maplibre-contour**-style DEM decode + from-scratch radial sweep (HeyWhatsThat method) | No existing library does this; must be built |
| Tide data | **NOAA CO-OPS** harmonic constituents (`harcon`) + **`@neaps/tide-predictor`** (0.11.0, MIT) for offline US prediction; live **WorldTides**/**UK Admiralty** calls for non-US coverage | Free, offline-capable for US; ToS blocks caching non-US providers' data |
| Star catalog | **HYG v4.1** (CC BY-SA 4.0) + Yale BSC5 mirror (MIT repackaging) | Standard, well-attributed, ~34 MB |
| Milky Way texture | **NASA SVS Deep Star Maps 2020** (public domain, pick 8K/16K resolution) | Public domain avoids ESO CC BY 4.0 attribution bookkeeping; higher max resolution available if needed |
| Meteor showers | **stellarium-addons** `showers.json` (verify license) or manually transcribe IMO's annual PDF | No clean machine-readable public-domain source exists |
| Constellation lines | **d3-celestial** (BSD-3-Clause) | Only permissively-licensed GeoJSON option; Stellarium's own data is GPL-2.0 |
