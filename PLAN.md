# Scape — Plan

Working name: **scape** (rename freely). A local-first, offline-capable web app for
planning outdoor photography around sunlight, moonlight and starlight. Goal: the map +
timeline clarity of The Photographer's Ephemeris (TPE) Web v4 combined with the feature depth
of PlanIt! Pro, without PlanIt's UI clutter.

Research inputs live in `docs/research/` (TPE feature inventory, PlanIt inventory, tech
research with versions and licenses, TPE screenshots).

---

## 1. Product principles

1. **Map is the document.** One camera location drives every number on screen. Drag the camera,
   scrub time, and everything updates live. No confirm steps, no modes to remember.
2. **One shared world state.** Simulated date/time, camera location, target location, gear and
   active overlays feed every module (PlanIt's best architectural idea). The simulated clock
   is visually distinct from "now".
3. **One consistent colour language.** Sun = amber/orange, Moon = blue, Milky Way = violet,
   terrain/geodetics = green, alerts = red. Same on map lines, chart curves, timeline icons.
   Rise = lighter shade, set = darker shade (TPE convention).
4. **Pure geometry, honest boundaries.** Compute astronomy, optics and terrain exactly; never
   fake weather. Link out to weather/cloud sources instead (PlanIt's boundary).
5. **Offline first, no account.** All user data lives in the browser (IndexedDB) with
   export/import. Map, terrain and sky data are downloadable by region and updated when the
   user says so. The app shell itself is a PWA.
6. **Fast.** Sub-frame updates while scrubbing. Heavy work (horizon sweeps, searches) in
   Web Workers. Astronomy calls are memoised per (camera location, day).

## 2. Feature scope (best of TPE ∪ PlanIt)

Legend: T = TPE has it, P = PlanIt has it, ★ = our improvement.

### Core (Phase 1)
- Map with draggable camera location; coordinates / time zone / elevation badges (T)
- Date bar: prev/next day, ±week, calendar, "now", typeable date; time zone auto from the camera location
  with manual override and confidence hint (T, P)
- Timeline of the day: astro/nautical/civil twilight, sunrise/set, golden hour bounds,
  sun/moon transit, moonrise/set with phase + illumination, Galactic Centre rise/set (T)
- Altitude chart (sun, moon, GC) with drag-to-scrub, keyboard nudge, twilight shading (T)
- Map lines: thick daily-event azimuth lines (rise/set), thin live sun/moon azimuth lines,
  sun shadow line; drawn as geodesics (T)
- Place search (online Photon; offline gazetteer later) and coordinate paste in DD/DMS (T, P★)
- URL-encoded view state for sharing (★ — TPE lacks share links)
- Settings: units, time format, theme, twilight/golden-hour thresholds (P★ user-adjustable)
- PWA shell; visited tiles cached automatically

### Terrain & geodetics (Phase 2)
- Target location, geodetic line: distance, bearing, elevation angle, elevation profile,
  line-of-sight colour (green/yellow/red) (T, P)
- Elevation from Terrarium DEM tiles, client-side decode, cached (T)
- 360° terrain horizon profile from DEM (radial sweep in a worker); "true" rise/set behind
  terrain and horizon curve on the altitude chart (T MAX, P)
- Hillshade / terrain layers; map style variants (grayscale etc.) (T)

### Plan & composition (Phase 3)
- Plan model: camera location + target location + date/time + composition (focal length, azimuth,
  elevation, orientation) (P)
- Photo gear: cameras (sensor size) + lenses; FOV cone drawn on map as great circles, with
  draggable edges to change azimuth / focal length (T, P)
- Depth-of-field and panorama calculators drawn on the map (P)
- Markers with categories, rating, notes, height/width, "show in viewfinder" flag; KML/GPX/
  GeoJSON import/export (P, T)
- **Viewfinder VR** (Three.js): synthetic view from the camera location — terrain silhouette from
  DEM, markers, sun/moon/GC paths, FOV frame, star field (P, T FPV)
- Library: locations, plans, searches, lists, favourites; export/import (T)

### Night (Phase 4)
- Milky Way core visibility windows (darkness × moon × altitude), band orientation in the
  viewfinder; NASA Deep Star Map texture (T, P)
- Star catalogue (HYG), constellation lines (d3-celestial data), Polaris alignment aid (P)
- Star-trail simulation and max-shutter rules (500 / NPF) (P)
- Meteor showers calendar with radiant tracking (T, P)
- Light-pollution overlay when a permissively licensed source is confirmed (T, P)

### Finders (Phase 5)
- Generalised constrained search engine (worker): "when is body X within azimuth×altitude
  window W over date range D, filtered by moon phase / day of week / darkness" (P Finder,
  T Visual Search)
- Sun/Moon finder, Milky Way seeker, tide-height search hook (P)
- **Shot alignment**: reverse problem — heatmap of camera positions that put a target behind
  a landmark, LOS-aware, with Align and Time modes (T MAX)
- Visibility / viewshed map for a body at a time (T MAX)

### Offline data manager (Phase 6)
- Download basemap (Protomaps PMTiles) and terrain (Mapterhorn PMTiles) by drawn region and
  zoom range into OPFS; import existing `.pmtiles`; per-archive size, date, update, delete
- `navigator.storage.persist()`, quota display, Safari eviction warning
- Offline gazetteer (GeoNames cities) and offline time-zone lookup (already bundled)

### Extras (Phase 7)
- Exposure: EV100 calculator, scene mode from world state, ND calculator (P)
- Time-lapse / sequence calculator and simulation in the viewfinder (P)
- Light & shadow: object shadow length (✔ 2026-09-12), light-reach on terrain, auto light-source switch (P)
- Rainbow geometry (42° antisolar), cloud-distance calculator (P)
- Tides: NOAA harmonic constituents + offline prediction for US stations (P)
- Eclipses (✔ calendar marks 2026-09-12; local circumstances later), 3D terrain orbit view (MapLibre
  terrain), Moon simulator (T)

Explicitly out of scope: accounts/sync server, AR camera overlay (no reliable web compass),
Google Street View / photorealistic tiles (paid, non-relightable).

## 3. Architecture

```
src/lib/
  core/        pure TS, no DOM, unit-tested
    astro/     wrappers over astronomy-engine: positions, day events, phases, GC
    geo/       geodesy (great-circle, destination, bearing), coordinate parsing/formatting
    time/      local-day bounds per IANA zone, formatting, tz lookup
    optics/    FOV, DoF, panorama, star-trail rules, EV
    terrain/   DEM decode, point elevation, profile, horizon sweep (worker-friendly)
    search/    constrained ephemeris search engine
  data/        storage & sources: idb library, OPFS tile store, PMTiles sources,
               Terrarium tile fetcher, gazetteer, geocoder
  state/       Zustand stores: world (time, camera and target, tz), settings, overlays, gear
  ui/          components: Map, DateBar, Timeline, AltitudeChart, panels, Viewfinder
  workers/     horizon sweep, finders, region downloader
src/routes/    TanStack Router file routes: / (map), /library, /gear, /settings
               (the offline data manager is the map panel's Offline tab, not a route)
```

Rendering: MapLibre owns the map canvas; overlays are GeoJSON sources updated in place
(cheap) plus a CustomLayer for heatmaps later. The altitude chart is a 2D canvas. The
viewfinder is a separate Three.js canvas. Nothing re-renders the DOM per frame. deck.gl is
dynamically imported only by features that need it (heatmaps, large point sets) and interleaved
into MapLibre's GL context, so the 2D map stays a single canvas and a plain map view never
pays for deck.gl or Three.js.

State: Zustand stores living outside React. Components subscribe with selectors, so a time
scrub re-renders only the readouts whose values changed; the map controller and the chart
subscribe to the store directly and never go through React. Derived astronomy is memoised per
(camera location, day, tz); heavy sweeps run in workers. URL sync is debounced through the router's typed
search params.

## 4. Stack (verified 2026-09-11, see docs/research/tech-research.md)

| Concern | Choice | Notes |
|---|---|---|
| Framework | React 19.3 + React Compiler (official Babel plugin via `@rolldown/plugin-babel`), Vite 8 SPA | user's decision 2026-09-11; compiler auto-memoises, store discipline keeps hot paths out of React; `eslint-plugin-react-hooks` v7 enforces compiler rules |
| Routing / URL state | TanStack Router 1.170, file-based, typed search params | route-level code splitting keeps Three.js / deck.gl out of the initial bundle |
| State | Zustand 5 | selector subscriptions in React; direct subscriptions for map and chart |
| Language / build | TypeScript strict, Vite 8, Bun for scripts | |
| Astronomy | astronomy-engine 2.1.19 (MIT) | ±1′; rise/set/twilight/transit, phases, galactic frame, eclipses |
| Map | MapLibre GL JS 6.9 always; deck.gl 9.4 lazy-loaded only where a feature needs it | globe, raster-dem terrain, hillshade, custom layers; "don't pay for what we don't need" |
| Basemaps | User-selectable layer list: OpenFreeMap vector styles (default), OSM raster, any PMTiles archive (remote URL or local file) | keyless; PMTiles is first-class, not an offline afterthought |
| Offline basemap | Protomaps PMTiles builds + `@protomaps/basemaps` style | ODbL data, CC0 style |
| Terrain | Mapterhorn 512 px lossless-WebP terrarium tiles (z0–17), decoded with WebCodecs `ImageDecoder`; AWS Terrarium as fallback | best open national DEM per region (0.5 m Switzerland); canvas decode is lossy for terrarium, attribution per region |
| Time zone | `@photostructure/tz-lookup` (86 KB, CC0) + manual override | geo-tz is 70 MB, too big |
| Storage | IndexedDB via `idb` (library, settings); OPFS for tile bytes | persist() requested |
| PWA | `vite-plugin-pwa` 1.3 (Workbox) | precache shell, runtime-cache tiles |
| Geocoding | Photon public API online; GeoNames cities offline | |
| 3D viewfinder | MapLibre terrain under the 2D canvas: camera placed at the eye (`calculateCameraOptionsFromCameraLngLatAltRotation`, pitch to 180°, vertical FOV = frame), DEM sweep for skyline, occlusion and sky | Three.js unused |
| Sky data | HYG v4.1 (CC BY-SA), NASA SVS Deep Star Maps (PD), d3-celestial lines (BSD-3) | built into `public/sky` by `scripts/build-sky.ts`; sources listed in `public/sky/README.md` |
| Light pollution | NASA GIBS VIIRS Black Marble raster (PD) | Falchi's atlas and the usual tile sets are CC BY-NC, so night lights stand in for now |
| Tests | Vitest for core; Playwright later for UI smoke | pure unit tests, no I/O |

## 5. UI layout

```
┌──────┬───────────────────────────────────────────────┬───────────────┐
│ nav  │ date bar · search · badges (coords, elev)     │ panel tabs    │
│ rail │                                               │ Timeline      │
│      │                    MAP                        │ Layers        │
│ 56px │                                               │ Geodetics     │
│      │                                               │ FOV / Plan    │
│      ├───────────────────────────────────────────────┤ Bodies        │
│      │ altitude chart (sun/moon/GC) · scrub · play   │ Finder        │
└──────┴───────────────────────────────────────────────┴───────────────┘
```

- Slim icon rail instead of TPE's 290 px sidebar: more map.
- Right panel tabs mirror TPE's rail; collapsible. On narrow screens the panel becomes a
  bottom sheet and the chart shrinks to a strip.
- Dark chrome, light map by default (planning is often done at night; the map must stay
  legible). Tabular numerals for all angles and times. Values are colour-coded: computed
  (default), live-now (green), editable (accent underline) — PlanIt's convention.
- Timeline rows are one-click time bookmarks; the active row is highlighted and the chart
  cursor follows.

## 6. Data model (IndexedDB)

- `locations`: id, name, lat, lon, elev?, tz?, notes, tags[], createdAt, updatedAt
- `plans`: id, name, camera{lat,lon,agl}, scene?{lat,lon}, time, tz, composition{focal,
  sensorId, azimuth, elevation, orientation}, gearIds, notes
- `markers`: id, name, category, lat, lon, height?, width?, rating, notes, showInViewfinder
- `searches`: saved finder definitions
- `gear`: cameras{sensor w/h mm, name}, lenses{focal range, aperture}
- `settings`: single document
- `archives` (metadata for OPFS tile archives): id, kind (basemap|terrain), bbox, zooms,
  bytes, sourceUrl, downloadedAt

Everything exportable as one JSON (`.scape.json`) plus KML/GeoJSON for points.

## 7. Phases and acceptance

| Phase | Deliverable | Done when |
|---|---|---|
| 0 | Research + this plan | ✔ |
| 1 | Core map/timeline/chart app, PWA shell | Drag the camera anywhere on Earth, events match NOAA/USNO within 1 min, chart scrubs at 60 fps, works after reload with network off |
| 2 | Terrain & geodetics | Target profile + LOS colour; horizon curve on chart; rise "behind terrain" times |
| 3 | Plan, gear, FOV, markers, Viewfinder VR, Library | FOV cone matches TPE FOV tool; viewfinder silhouette matches real photo at a known spot |
| 4 | Night | GC windows match TPE; star field renders 9k stars at 60 fps |
| 5 | Finders + shot alignment | Full-moon-behind-landmark search reproduces a known TPE result |
| 6 | Offline data manager | Region download, airplane-mode full function, update/delete |
| 7 | Extras | Each calculator cross-checked against PlanIt worked examples |

Phase 1 shipped on 2026-09-11 (the elevation badge moved to Phase 2 alongside the DEM work).
Phase 2 shipped on 2026-09-11: elevation badge, target location with sightline (distance, bearing,
elevation angle, profile chart, clear/marginal/blocked colouring), 360° terrain horizon swept in a
worker from Terrarium tiles (0.5° azimuth steps, zoom ladder 14→8 out to a configurable range),
terrain rise/set events for sun, moon and Galactic Centre, skyline on the altitude chart, hillshade
and 3D terrain toggles.
Phase 3 shipped on 2026-09-11: composition store (sensor, focal length, aperture, orientation, aim);
FOV cone on the map with draggable tip and edge handles, depth-of-field arcs and panorama outline;
markers with categories, height/width, rating, notes, KML/GPX/GeoJSON import/export; plans and a
full `.scape.json` backup in the Library; the viewfinder route, a 2D canvas that ray-marches the DEM
per column (worker `View` request, layered visible ridges, distance haze) and projects sun/moon/GC
paths, target and markers through a rectilinear camera model.
Phase 4 shipped on 2026-09-11: bundled sky data built by `scripts/build-sky.ts` (HYG stars to magnitude
6.5 as a 107 KB binary, d3-celestial constellation lines, NASA Milky Way map at 2048 × 1024); star
field, constellation figures, pole marker, Milky Way texture, star trails and meteor radiants in the
viewfinder, all through the same camera model and terrain occlusion; Milky Way core windows computed
in the astro worker (dark sky × core altitude or skyline × moon rule) with a Night tab and a chart
band; 500/NPF rules from the camera's pixel pitch; IMO shower list with peak dates from solar
longitude; Polaris clock positions; NASA VIIRS night-lights overlay. The Frame tab gained a searchable
camera and lens catalogue (185 bodies, 346 lenses) that sets sensor, pixel count, focal range and
aperture.
Viewfinder 3D (2026-09-11): a second MapLibre instance under the viewfinder canvas shows the map's
terrain, textured with the current basemap, from the camera location with the frame's exact field of
view; the canvas leaves the ground transparent and keeps the swept skyline, sky, stars and overlays.
Phase 5 shipped on 2026-09-12: a constrained-search engine (`core/astro/finder.ts`) that lists every
stay of the sun, moon or Galactic Centre inside an azimuth × altitude window over a date range:
altitude bands from exact crossing searches refined against the refracted position, azimuth steps
bounded by the sidereal rate so no pass is skipped, bisection at the window edges, an optional terrain
skyline, then sky, moon-illumination, moon-down and weekday filters; it runs in a worker in 14-day
chunks with progress. The Find tab sets the window from the target location or the frame, has
full-moon and dark-sky presets, results that set the time, CSV export and saved searches (Library and
backup). Shot alignment and visibility heat layers come from a second worker over the DEM
(`core/align/`): Align and Time around the target location (camera cells that put the body behind it
within a tolerance during the time window, sightline checked; picking a cell moves the camera and the
time), Visible (cells where the body clears the terrain at the moment) and Viewshed (ground seen from
the camera). The viewfinder gained landmark solids (box, cylinder and spire markers drawn as
flat-shaded prisms), a height ruler at the target distance and a sun/moon header. Acceptance
cross-checked on 2026-09-12 against TPE Web's Visual Search (Zermatt 46.0207 N 7.7491 E, moon, azimuth
233–237°, altitude 15–19°, one year from 2026-09-11): all 23 TPE passes are reproduced to the minute with
matching illumination; Scape also lists 2026-10-22 01:14–01:33 CEST (80 %), which TPE omits and JPL
Horizons confirms (azimuth 233.1→237.3°, altitude 18.6→15.9° over 23:15–23:35 UTC).
Phase 6 shipped on 2026-09-12: offline data. Regions are drawn on the map or taken from the view and
downloaded in a worker into OPFS as PMTiles archives with a JSON sidecar — basemap tiles cut out of
the Protomaps daily build over HTTP range requests, terrain packed from the Terrarium PNG tiles —
with estimates before the download, progress, cancel, update, rename, export and import of any
`.pmtiles` file. Saved basemap archives join the Layers list; the map and the viewfinder read local
tiles first and fall back to the network. The Offline tab shows the quota, asks for persistent
storage and warns about Safari's eviction. Place search keeps Photon first and falls back to a
bundled GeoNames `cities5000` index (`scripts/build-gazetteer.ts`) when offline or unanswered.
The service worker's tile cache route, dead since Phase 1 because it referenced a config-time
variable, now works and also keeps the Protomaps sprites and glyphs. Acceptance was run on
2026-09-12 against the production build served on localhost:3000 with the browser offline and its
HTTP cache cleared: the shell, an offline basemap with labels, elevation, terrain events, the
viewfinder inside the region, and place search all worked; update, export/import and delete too.
UI iteration on 2026-09-12 from the user's review after the PlanIt cross-check: the map and the
viewfinder stay in step across browser tabs (`state/crossTab.ts` — persisted stores announce their
writes on a BroadcastChannel and the other tabs rehydrate; the "viewfinder shows Zermatt" report was
a second tab keeping its own in-memory stores); compact share URLs on both routes
(`state/urlState.ts`); the viewfinder is the picture alone — the user cut the coordinate, distance
and bearing readouts, the tick rulers and the time label the next day ("completely unusable" on a
phone), leaving one line under the frame for focal length, field of view and load status, and the
Frame tab's Open viewfinder button went with them; the bottom chart scrubs with a horizontal trackpad swipe; the side panel collapses; the
basemap list is a tree, collapsed; the Timeline shows TPE's rows with a Details toggle; the Night
tab is grouped by topic with `core/astro/night.ts` giving the night and moon-free windows; the Frame
tab lists camera bodies apart from sensor formats, hides the controls a body or a prime fixes, and
saves kits; gear search splits letters from digits ("z8" finds the Nikon Z 8); the date bar's
calendar marks principal moon phases and eclipses visible from the camera location
(`core/astro/calendar.ts`); the sun shadow has its true length at the camera and target locations.
Found in passing: offline terrain tiles at low zoom were skipped because only the tile centre was
tested against the region; the footprint is tested now.

Later the same day, against a PlanIt screenshot of the full moon rising behind 30 Hudson Yards
from Hoboken at 400 mm, the user said ours "looks like nothing". The causes were not missing
models: the viewfinder's raster pass painted the sky opaque over the MapLibre canvas, hiding the
building extrusions that were already there; the night dim on that canvas turned what did show
near-black; the target had no height, so the aim framed the shoreline; and the Milky Way texture,
sampled nearest-neighbour, showed as a diamond hatch across a 5° field. A first fix patched the
MapLibre view (transparent sky, light extrusions, a floor on the night dim), and the user's next
zoom to 300 mm showed floating overzoomed slabs: MapLibre's camera model fails at pitch ≥ 90° (§8).
The MapLibre view was removed the same day and replaced by Scape's own building rasteriser fed by
z14 OpenStreetMap tiles (§8), the target takes the building's height for the aim and its label, and
the texture is sampled bilinearly. Still open: the phone layout gives the viewfinder canvas about a
quarter of the viewport.

## 8. Risks and decisions taken

- **Time zone accuracy**: tz-lookup mismatches near borders. Mitigation: the date bar's zone
  selector shows "Auto · zone" with a one-click override, and remembers overrides per saved location.
- **Terrarium tile licensing** is mixed (mostly PD, some CC BY). Show attribution per region.
- **Never decode DEM PNGs through a canvas.** Chromium's image pipeline nudges isolated channel
  values by one, and one unit of red is 256 m in Terrarium; the result was 170 m phantom cliffs
  next to the camera location. Tiles are decoded by hand (`core/terrain/png.ts`), canvas is only a fallback.
- **Water is bathymetry** in Terrarium, so sightlines and the horizon clamp ground to sea level.
  Land below sea level (Death Valley, Dead Sea) is therefore treated as 0 m there.
- **Safari storage eviction** can purge OPFS after long idle. Warn, and make re-download easy.
- **OpenFreeMap vs Protomaps schema** differ, so online and offline styles will look a little
  different. Acceptable for dogfooding; can unify by serving Protomaps offline builds online
  later.
- **No web compass AR**: deliberately skipped; Viewfinder VR + picture-calibration covers it.
- **Viewfinder without Three.js.** The silhouette precision the acceptance test asks for comes from
  ray-marching the DEM per pixel column (`core/terrain/view.ts`), which a 2D canvas draws exactly; a
  mesh would only approximate it. The textured ground under that skyline is MapLibre's own terrain.
- **Star field on the 2D canvas.** 9k stars cost under a millisecond per frame once bucketed by colour
  and brightness; the terrain raster dominates the frame budget. Three.js stays unneeded so far.
- **Sky texture orientation.** NASA's equatorial maps put RA 0h at the centre with RA increasing to
  the left (viewed from inside); `public/sky/README.md` records it so the lookup is not re-derived.
- **Aim lock.** Placing or moving the target re-enables "aim at target"; a drag in the viewfinder or of
  the cone tip releases it. Without this the viewfinder looked out of sync with the map after one drag.
- **3D terrain in the viewfinder.** MapLibre 6.9 places its camera at a lat/lng/altitude with pitch to
  180° and a chosen vertical FOV, so the viewfinder shows the map's terrain from the eye at once and
  textured with the basemap, while the DEM sweep keeps the exact skyline, occlusion and sky. Known
  limits: MapLibre's near plane (about a fiftieth of the frame height, roughly 5 m at eye level) drops
  the ground at the camera's feet, which the canvas paints and fades in; Mercator has no earth
  curvature, so ridges beyond ~50 km sit up to 0.4° higher than the sweep, hidden under the canvas sky;
  the basemap's labels are stripped in the 3D view.
- **Finder searches exactly instead of sampling.** Band edges come from astronomy-engine's altitude
  search (refined by bisection, because that search ignores refraction while positions include it),
  azimuth is stepped no further than the sidereal rate allows at that altitude, and edges are bisected
  to the second. A brute-force 30 s scan is the unit-test oracle.
- **Altitudes are apparent while a body is up and geometric below the horizon**
  (`core/astro/refraction.ts`), PlanIt's convention: twilight thresholds are defined on geometric
  altitude, and astronomy-engine's tapered refraction below the horizon showed the sun at −11.7° a
  minute after nautical dusk. Cross-checked on 2026-09-12 against PlanIt Pro 10.7.29 (camera at Castle
  Point, Hoboken, 2026-10-26 evening): azimuths and the moon's altitude agree within 0.1°; PlanIt's
  Galactic Centre azimuth sits 0.35° east of Scape's and matches J2000 coordinates used without
  precession, so that one is PlanIt's error; its moon illumination reads 0.2 % high. The full
  record, including the one-year moon finder run (34 of 36 passes shared; PlanIt's extra row is a
  window-corner false positive, Scape's extra row a pass PlanIt misses) and the viewfinder match,
  is `docs/research/planit-crosscheck.md`. The check exposed two viewfinder bugs, both fixed: the
  moon's terminator was drawn inverted (a full moon painted as a sliver) and the sun and moon discs
  used a fixed mean semidiameter instead of the instant's topocentric one (5 % small at perigee).
- **Heat grids live in normalised Mercator.** Cells are square on the ground, the image source maps
  onto the map without resampling, and one topocentric RA/Dec per time sample plus per-cell trig
  (`core/astro/fastHorizon.ts`) keeps a 64 × 64 × 240 grid under a second; the error stays below 0.02°
  within 60 km of the reference observer.
- **Terrarium, not HGT.** PlanIt reads SRTM `.hgt` tiles; Terrarium already merges that SRTM with 3DEP
  and EU-DEM and is fetched per tile. Its ~30 m ground resolution bounds alignment precision, which is
  why the Align mode has a tolerance and the panel says to confirm the framing in the viewfinder.
- **Landmark solids before 3D models.** Box, cylinder and spire markers give exact angular geometry
  from height, width, depth and rotation on the existing canvas. What comes next is the open
  decision below.
- **3D building models — precise meshes still open** (user, 2026-09-12: "I absolutely
  need the precise 3D model"; it is why they left TPE for PlanIt). Facts: SRTM `.hgt` and Terrarium are both
  terrain-only height grids (Terrarium merges SRTM with 3DEP and EU-DEM); neither contains a
  building. PlanIt's models are meshes made by users, uploaded to PlanIt's server and downloaded
  on demand under a separate subscription (the shared "30 Hudson Yards" landmark: 327 vertices,
  13 KB, submitted by a user); no export function was found in the app or its documentation.
  Options: (A) footprints and heights from the OpenStreetMap `building` layer already in our
  vector tiles, extruded as prisms — automatic, worldwide, offline-capable, flat-roof accuracy;
  (B) user models imported from glTF/OBJ, anchored at latitude, longitude, ground altitude and
  heading, drawn on the existing viewfinder canvas by a small software rasteriser (exact
  projection and per-column terrain occlusion, no new dependency; deck.gl's ScenegraphLayer is
  the alternative already allowed as a lazy load); (C) in-app modelling — footprint polygon plus
  height and roof, extending the solids, exportable as GeoJSON or glTF for sharing.
  Recommendation: A, then B on the canvas, then C. Taken 2026-09-13 (user: the viewfinder "shall
  be able to replicate PlanIt viewfinder, though without precise 3D building models"; later "glTF
  or in-app modelling, I don't care. I only care about usability and precision"): A is the
  baseline, rendered by Scape itself. A worker fetches the z14 building tiles for the wedge the
  frame looks into (`@mapbox/vector-tile` + `pbf`, approved by the user), decodes them and reads
  the DEM under each footprint; the viewfinder extrudes the footprints to solids and rasterises
  them with the frame's own pinhole projection, depth-tested per pixel against the terrain sweep,
  at every focal length (`core/geo/prismRaster.ts`). The precise-model step is C, in-app modelling
  on the same rasteriser, with B as an import path; the user has delegated that choice.
- **Buildings come from Overture, drawn to the OSM Simple 3D rules.** Decided 2026-09-13 (user:
  "let's do it then") on the source research in `docs/research/3d-models.md`, replacing
  OpenFreeMap. The `buildings.pmtiles` archive of the Overture 2026-08-19.0 release is read live
  by HTTP range request: 180 GB on S3, never downloaded whole, ODbL, CORS open
  (`data/buildingTiles.ts`). Overture carries what OpenFreeMap drops — `building_part` rows keyed
  by `building_id`, so a parent tagged `has_parts` is replaced by its parts; `min_height` for
  volumes that start above the ground; `roof_shape`, `roof_height`, `roof_direction` and
  `roof_orientation`. `core/geo/roofs.ts` turns those into geometry (skillion, pyramidal, gabled,
  hipped, domed) against the footprint's minimum-area box, so 30 Hudson Yards keeps its sloped
  crown and the Edge deck, and the Empire State its setbacks and pyramidal spire. Height falls
  back through `height`, `num_floors × 3`, a per-class default, then 5 m; the ground under a
  building is the lowest DEM sample over its footprints. The target's height comes from the same
  archive, by a point-in-footprint query in the worker (395 m for 30 Hudson Yards against the
  387 m architectural height, kept as the data says; 443.2 m for the Empire State). Limits: no
  facade detail; a concave footprint can push a hipped ridge outside its walls, so a poor box fit
  reverts to gabled and then flat; building tiles are fetched live and are not yet part of the
  offline regions.
- **Ground shadows are a draped raster mask, not geometry.** Decided 2026-09-17. One march of a
  height grid along the sun's ground direction (`core/geo/sunCeiling.ts`) gives, per cell, the
  height at or below which a point is shadowed, which answers terrain→terrain, terrain→building,
  building→ground and building→building at once; the map's worker turns that field into an 8-bit
  mask (`core/geo/shadowMask.ts`) and the main thread hands it to a MapLibre `image` source drawn
  by a `raster` layer, and the viewfinder reads the same field. A `fill` layer of shadow polygons
  was rejected: MapLibre alpha-blends overlapping fills at exactly 0.65^n, measured, and a 5° sun
  over Manhattan reached ten layers deep and turned the map black. Unioning the polygons was
  rejected too — five libraries benchmarked on realistic input (polygon-clipping, polyclip-ts,
  martinez, clipper2-js, polybool), the fastest ≈870 ms per rebuild on an M1 Max at 18,371 rings
  and polybool throwing on every real set, and a union cannot drape on terrain anyway. A `custom`
  layer was rejected because MapLibre's `LAYERS_TO_TEXTURES` covers only `background, fill, line,
  raster, hillshade, color-relief`, so a custom layer floats above the terrain mesh instead of
  draping onto it; a `raster` layer drapes and composites exactly once, which makes the
  compounding structurally impossible. Mapbox GL JS 3.x, which renders this natively from a
  `directional` light with `cast-shadows` (this is how TPE does it), was rejected on licence: the
  SDK is granted "for use only with the relevant Mapbox product(s)" and only while an account is
  active, which does not cover Scape's Overture/Protomaps/Terrarium stack. The mask grid is laid
  out in a local Mercator frame scaled to ground metres at the rect centre, because an image
  source interpolates linearly in Mercator: a grid uniform in metres measured 30.6 m out of
  register at lat 60 on a 30 km rect, against a 14.6 m half-cell, while the frame costs ≤0.4%
  cell-size variation, which the metre-based march does not care about. Limits: the draped mask
  smears on near-vertical cliffs; water is shaded like ground; a cold build at a low sun takes
  several seconds, dominated by DEM and building tile fetches; and terrain shadows are still gated
  behind the buildings' `BLD_MIN_ZOOM = 14`, which is arbitrary for mountains.
- **MapLibre is not a first-person renderer.** The textured 3D terrain under the frame
  (`TerrainView.ts`, Phase 6) was removed on 2026-09-13. At pitch ≥ 90° — the frame aimed at or
  above the horizon, exactly the long-lens-at-a-tower case — MapLibre's camera model degenerates:
  the zoom jumps to 21, only the tiles under the camera load (the user saw the buildings beside the
  camera as floating slabs at 300 mm), terrain draws a garbage plane or nothing, and the building
  layer exists only at map zoom ≥ 14. Everything in the frame is drawn by the canvas rasterisers.
- **Accuracy over agreement with the reference apps** (user, 2026-09-12: "there's no reason to
  copy PlanIt's number… what we want is accuracy"). Where Scape and TPE or PlanIt differ, Scape
  keeps the physically defined convention and records the difference; no "match PlanIt"
  switches. Moon rise and set stay on the upper limb (USNO); PlanIt's centre rule sits 2–3 min
  away. A blue-hour band is not adopted from PlanIt's −4…−8°, which has no physical definition;
  the chart's twilight shading already shows that range.
- **Share URLs are compact**: `?camera=lat,lng&target=lat,lng&z=13.34&t=2026-10-26T23:01Z&tz=…`;
  the viewfinder route carries `f=` (focal mm) and `o=p` (portrait) instead of `z`. Never
  `lat=/lng=/lat2=/lng2=`.
- **Cameras are bodies, not sensors.** The Frame tab lists the user's camera bodies (catalogue or
  custom) and, separately, generic sensor formats; a body fixes the sensor, a prime lens fixes
  the focal length and a zoom bounds it, so those controls disappear once a kit (body + lens
  preset in the gear store) is chosen — TPE's model.
- **Concise by default, depth one click away** (user: TPE's UI is concise, PlanIt's is out of
  control). The side panel collapses; the basemap list is a tree, collapsed; the Timeline shows
  TPE's rows (twilights, sunrise and sunset, moonrise and moonset) with a Details toggle for
  transits, golden hour, terrain and Galactic Centre rows; the Night tab is grouped by topic
  (Sun, Moon, Milky Way, Stars, Meteor showers), each a one-line summary until opened. The
  viewfinder frame carries no rulers, time or coordinate readouts (user, 2026-09-13); PlanIt's
  azimuth and height rulers are deliberately not replicated.
- **The calendar marks only what matters**: principal moon phases and eclipses visible from the
  camera location (`core/astro/calendar.ts`), not every day's phase.
- **The sun shadow has a length**: `h / tan(altitude)` for an object of settable height at the
  camera location and for the target's own height at the target location, capped at 50 km; the
  readout gives the ratio (TPE's feature).
- **Naming**: the two pins are the **camera location** and the **target location** in every user-facing
  string and doc; code keeps the short `pin` / `pin2` identifiers. Enum-like unions are `as const`
  objects with PascalCase members (`EventKind.TerrainRise`), never bare camelCase literals.
- **Terrain comes from Mapterhorn, decoded with WebCodecs `ImageDecoder`** (2026-09-18). Its tiles are
  lossless WebP (VP8L) at 512 px, z0–17, terrarium-encoded, CORS `*`, carrying the best open national
  DEM per region — swissALTI3D 0.5 m over Zermatt, 0.25 m over Zürich, 1 m over the US. This reverses
  the earlier "canvas decoding is lossy, so pack AWS PNG instead" note: canvas *is* lossy, measured at
  ±1 on the red channel, which is ±256 m in terrarium; `ImageDecoder.copyTo` is byte-exact, so the
  objection was to the decoder, not the source. Canvas must never decode a DEM.
- **Terrain depth varies by region and 404s past it** (Zermatt z17, Yosemite/NYC z16, Nepal z12), so
  the sampler overzooms from the deepest tile that exists rather than assuming a global max zoom.
- **Basemap regions are client-side range extracts of a PMTiles planet build.** The default source is
  the Protomaps daily build, whose CORS allowlist covers only local development origins
  (localhost:5173, localhost:3000), so it serves dogfooding but not a deployed origin; the source URL
  is editable. For deployment the candidate is packing OpenFreeMap's per-tile PBFs (CORS `*`) the way
  terrain is packed, with the Liberty style, sprites and glyphs cached alongside; that is an open
  decision, deferred by the user on 2026-09-12.
- **OPFS is the source of truth for archives** (each `<id>.pmtiles` with an `<id>.json` sidecar);
  IndexedDB stays for the library.
- **Name**: "scape" is a placeholder.

## 9. Open work (2026-09-18)

Numbered items below are a register, not a queue; most are landed and kept for the measurements in
them. What is actually left, in order: **14** (cancel a superseded request's queued tile fetches),
then **15** (`selectBlocks` cost). **8** is a watch, not a task. **2**'s last step turned out to be a
picture decision rather than a constant, so it joins **18–20** as blocked on the user.

**Precision**

1. **Mapterhorn terrain source** — landed. `tiles.mapterhorn.com/{z}/{x}/{y}.webp`, 512 px, decoded
   with WebCodecs `ImageDecoder` (never canvas), overzoom past each region's max zoom, decode
   dispatched on container magic so archives written by either source still read, "© Mapterhorn"
   attribution, AWS as the fallback when `ImageDecoder` is absent. The mesh floor deliberately stays
   at 4 m; see 2.

   The fine zooms carry real data, not an upsample. Measured as the residual between each tile and a
   bilinear upsample of its own parent: over the Matterhorn, 2.45 m RMS at z14, 1.79 m at z15, 1.66 m
   at z16 and 0.52 m at z17, with single-post maxima of 78 m, 77 m, 68 m and 17 m; Eiger and Zermatt
   village are smaller but never zero. So stopping the mesh at z14 discards about 2.5 m RMS of genuine
   relief on the Matterhorn's faces, with metre-scale maxima on the cliffs. Over Switzerland the
   underlying source is swissALTI3D at 0.5 m (swisstopo, Open Government Data), so z17's 0.41 m posts
   are essentially native resolution and there is nothing deeper to reach for.

   But that detail is about how the picture looks, not about whether the answers are right. Across a
   ±2.5° fan of ridgelines around the Matterhorn, the skyline computed at z17 differs from the same
   skyline at z14 by 0.002° median, 0.010° at p90 and 0.044° worst — under a tenth of the 0.53° solar
   disc. The grazing-light times are already accurate at the current floor. What the finer surface
   buys is a subject that stops looking soft at long focal lengths.
2. **The mesh floor wants to be a function of the frame, not a constant.** `selectBlocks` reads
   `minLevel` off the DEM post size, then shrinks `reachM` all the way to `MIN_MESH_REACH_M` before it
   will coarsen `targetRad` at all. A finer floor therefore buys near-field detail by collapsing
   reach, which is backwards for a landscape camera: at 600 mm from Zermatt, letting the 0.41 m post
   unlock the 2 m cell took the Matterhorn at 9.5 km from 4 m cells to 64 m and reach from 11.25 km to
   5.6 km.

   What the floor is worth. `targetRad` is `4 · 24 / (focal · pxH)`, so the cell the design asks for on
   a subject 8.55 km out is 11.6 m at 70 mm, 4.1 m at 200 mm, 1.35 m at 600 mm, 0.68 m at 1200 mm and
   0.34 m at 2400 mm. The 4 m floor costs nothing below 200 mm and everything above it — which matches
   the 2400 mm frame looking soft.

   Measured against 3, now that the frame band frees the budget: a flat `MESH_MIN_CELL_M = 2` **fits at
   600 mm and longer** and halves the cell on the subject (4 m → 2 m) inside the 3 M budget — 2.13 M
   triangles at 2400 mm with reach still saturated at 100 km, 2.85 M at 600 mm with reach collapsing
   from 100 km to 8 594 m, which clears the Matterhorn at 8 550 m by only 44 m. **It is a regression at
   short focal lengths**, where the band frees nothing: 70 mm goes 32 m → 64 m on the subject with
   reach halved 5 078 → 2 344 m, and 200 mm goes 16 m → 64 m with reach halved 7 813 → 3 906 m. So the
   floor had to become conditional rather than flat.

   Landed as exactly that. `MESH_START_CELL_M = 4` is where the reach ladder runs, not a floor: once
   the reach has settled, `minLevel` descends one rung at a time toward the DEM's own post size for as
   long as the mesh still fits, and reach is never traded back for cell size. A long lens therefore
   reaches the 2 m cell on its own budget while 70 mm and 200 mm keep the reach they had.

   The 0.41 m post is still two rungs away. `buildLevel` picks its DEM zoom from the cell it is
   filling, so a 2 m cell reads z15 at 1.66 m posts, and z16 and z17 never reach the screen at any
   focal length.

   Taking `BASE_CELL_M` to 0.5 with `MAX_LEVELS` at 11 was tried and reverted. It is metrically clean:
   `levelHalfExtentM(MAX_LEVELS - 1)` and `blockSideM` are unchanged, the `EXPECTED` table moves its
   level labels two rungs and not one block, triangle, `targetRad` or `reachM`, and reach is identical
   at 24/70/200/600/1200/2400 mm in both orientations. `heightBound`'s pyramid has to be pinned to a
   2 m base or its grid goes 16× denser and undoes 12. What it does not do is deliver the post.
   Zermatt village to the Matterhorn, 8.5 km, aimed at the target: at 200, 600, 1200 and 2400 mm
   *nothing changes at all* — the floor stays 2 m and the DEM zoom 15, because the budget binds two
   rungs before the constant does. The 2400 mm selection is 436 blocks, 2.18 M triangles; one rung
   finer is about 8.7 M against a 3 M cap. The single case where the finer constant did bite is the
   one that wanted it least: portrait 24 mm went to a 1 m floor and z16, 499 blocks → 574, for 279
   changed pixels of 4.0 M.

   That asymmetry is the finding. `targetRad` is angular, so the cell a block may use scales with its
   distance and *every* in-band block ends up asking for the floor; dropping the floor a rung
   therefore costs ~4× across the whole cone, and the greediest consumer is the near field — the
   opposite of what a long lens wants. So the next step is not a finer constant. It is to bound the
   fine region to the subject's neighbourhood, so the rung is spent where the subject is instead of
   everywhere, which changes what the foreground looks like and is a picture decision rather than a
   number. **Needs a user decision.**
3. **Frame-elevation band in mesh selection** — landed. The wedge was azimuth-only, so a frame pitched
   up at a summit meshed the valley floor below it at full resolution. Blocks whose height bound cannot
   reach the frame's elevation band now fall back to `COARSE_TARGET_RAD` rather than being dropped, so
   the shadow map keeps its casters and a tilt inside the pad shows no hole. The bound has to exist
   before any height is fetched, so it comes from a coarse DEM prepass (`heightBound.ts`), dilated a
   post and padded for relief between posts; missing coverage leaves a block unbounded.

   Measured in the browser from Zermatt at the Matterhorn (bearing 234.8°, pitch 18.56°, range 100 km):

   | focal | blocks | triangles | reach |
   |---|---|---|---|
   | 70 mm | 580 | 2 895 360 | 5 078 m |
   | 200 mm | 556 | 2 775 552 | 7 813 m |
   | 600 mm | 394 | 1 966 848 | **100 000 m** |
   | 1200 mm | 307 | 1 532 544 | **100 000 m** |
   | 2400 mm | 295 | 1 472 640 | **100 000 m** |

   The win is not a smaller triangle count but reach: at 600 mm and longer it saturates at the full
   100 km while the budget drops to about half. Waste the band reclaims, measured against the
   azimuth-only selection: 0 % at 70 mm, 22 % at 200 mm, 62 % at 600 mm, 69 % at 1200 and 2400 mm — the
   70 mm frame really does hold everything. Safety was checked directly by ray-marching a 25×25 grid of
   image points against the real DEM for nine (focal, pitch) pairs: **0 of 625 rays per case landed in
   a coarser block**, so in-frame ground is never coarsened.

   Checked across the frame matrix in the app — 24/70/200/600/2400 mm, both orientations, aimed at
   the target and manually at +45°, +40° and −25°, midday, golden hour and night: no holes, no
   errors, and a repeat of the first case after the whole tour reproduced it exactly.

   Accepted caveat: ground below the band can still cast a shadow into the frame under a low sun.
   `MESH_EL_DOWN_PAD` widens the lower side; making the band depend on the sun would rebuild the mesh
   on every scrub of the timeline, which is far worse than a coarse caster.
4. **Terrain reads corrupted by the browser's canvas — the map, not the viewfinder** — landed.
   MapLibre decodes `raster-dem` tiles by drawing an `ImageBitmap` into a 2D canvas and reading it
   back, and on Brave canvas readback carries sparse anti-fingerprinting noise. Measured on Mapterhorn
   `17/68324/46642` against a WebCodecs decode of the same bytes: 258 of 262144 posts differed, and
   **94 of them by exactly ±256 m** (a ±1 in the red channel). It is not the codec — a synthetic opaque
   buffer through `putImageData` → `getImageData` loses bytes the same way, and so does re-encoding the
   tile as PNG. MapLibre guards against exactly this with `isOffscreenCanvasDistorted()`, but the probe
   writes 25 pixels and the noise is sparse enough to miss them. The viewfinder was never affected: it
   has decoded with WebCodecs since 1.

   `demSource.ts` registers a `scape-raster-dem` source type whose `loadTile` fetches and decodes
   through the same WebCodecs path the viewfinder uses, then hands the worker a plain `ImageData` —
   `RasterDEMTileWorkerSource` only rasterises what is an `ImageBitmap`, so nothing touches a canvas.
   The spec passed downstream still says `type: 'raster-dem'`, or hillshade's style validation and the
   tile manager's DEM backfill both refuse it. Where `ImageDecoder` is absent the spec falls back to
   MapLibre's own source.

   Verified in Brave, the browser that has the noise: **0 of 262144 posts differ** on each of three
   tiles at z16 and z17, `queryTerrainElevation` at Zermatt reads 1602.7 m against the viewfinder's
   1602.8 m, and the hillshade over the Matterhorn is clean. Cost is 4.3 ms → 9.4 ms per tile, 4.6 ms
   of which is `repairPosts` — work MapLibre never did, and the first thing to make optional if
   main-thread jank shows.
5. **Ridge sweeps read bilinear where the mesh draws cubic — measured, and not worth fixing.**
   From Zermatt the two surfaces put the skyline within 0.0025° of each other toward the Matterhorn
   and within 0.0012° on three near ridges, against a 0.53° solar disc. Individual posts differ by up
   to 6 m on the Matterhorn's steep face, but a skyline is set by locally smooth ridge crests, so the
   error does not reach the answer. The sweeps also cap at the same zoom the mesh actually uses today
   (the 4 m floor keeps the mesh at z14 everywhere), so there is no zoom mismatch either. Revisit only
   if the mesh floor drops far enough that the mesh reads z16 or z17 near the subject.
6. **The shadow mask's two disagreeing terrain surfaces — measured, and not worth unifying.**
   `fillFrameTerrain` fills the grid row-wise and bilinear at the mask's own zoom (z13, 7–9 m posts in a
   city), while `groundOf` puts roof bases on a cubic read at `BUILDING_GROUND_ZOOM` (z15, ~1.8 m). Over
   1.6 km squares the two agree to 0.05 m at the median and 1.9 m at worst in Manhattan, 0.06 / 2.3 m in
   San Francisco — 0.3 m of shadow length at the median and 13 m at worst with the sun at 10°, against a
   4–8 m mask cell. Zermatt reaches 30 m on a cliff face, but cliffs carry no footprints. The row-wise
   bilinear read is what keeps a 1024² grid affordable, so the mismatch stays.
7. **The alignment path reads bilinear where the mesh draws cubic — measured; the kernel is not worth
   fixing, but the grid's own zoom is the real error.** At the zoom single points actually use
   (`POINT_ZOOM`, 6.6 m posts at Zermatt) the two kernels agree to 0.06 m at the median, 0.67 m at p95
   and 1.22 m at worst over a 64-point sample — 0.0002° to 0.0039° of the angle to the Matterhorn,
   against a 0.53° solar disc and the 1° default tolerance. Same verdict as item 5: leave it bilinear.
   The worker is also already careful where it matters, reading the landmark top at `POINT_ZOOM` rather
   than the grid zoom (`pointZoomFor`), which costs only 6.2 m against a z17 cubic read.
   What does reach the answer is `alignGrid` reading every candidate's ground at the *grid* zoom. A
   default 20 km / 64-cell grid asks for 312 m posts and `zoomForResolution` rounds to z7, 425 m posts —
   coarser than asked. Against a z17 reference those grounds are off by 39 m at the median and 150 m at
   worst, moving the landmark angle 0.15° at the median, 0.46° at p95 and 0.77° at worst: most of a 1°
   tolerance band. The heat layer is only a screen — `pick` re-evaluates the chosen point at `POINT_ZOOM` —
   so this blurs the band's edge rather than lying outright, and a 625 m cell genuinely has no single
   ground height. Two candidate fixes: round `zoomForResolution` up rather than to nearest so a caller
   never samples coarser than it asked, or give the grid a min/max ground per cell instead of one post.
   The first looks like four characters but is not: the mesh asks for power-of-two cells, so whether
   `log2` lands above or below .5 is fixed by latitude alone — identical to `round` at Zermatt, a whole
   extra zoom (4× the tiles) at the equator. Any fix belongs at the align call site, not in `tiles.ts`.
8. **DEM outlier filter** — a corrupt band of 4+ consecutive rows would outvote the 7×7 median and
   survive. Seen 1- and 2-row bands so far; widen the neighbourhood if a 4-row band appears. No bad
   post has yet been found in Mapterhorn; the filter stays as a safety net over whichever source runs.
9. **The azimuth wedge assumed the frame was level** — landed. `ensureMeshWindow` passed the unpitched
   `hfovDeg`, but a rectilinear frame pitched up spreads its top edge wider in azimuth than
   `hfov / 2` — the ray azimuth goes as `atan(x / (f·cos p − y·sin p))`, and the denominator shrinks
   along the top edge. The elevation band added in 3 bounds its axis exactly; azimuth is the remaining
   approximation.

   The earlier note that `MESH_AZ_PAD` covers it was wrong, and only looked right because the frame
   matrix stopped at 40° of pitch. Half-width the wedge uses against the half-width the picture needs,
   full frame:

   | pitch | 24 mm land | 70 mm land | 600 mm land | 24 mm port |
   |---|---|---|---|---|
   | 40° | 59.0 vs 59.3° | covered | covered | 42.5 vs 60.4° |
   | 45° | 59.0 vs 64.8° | 23.1 vs 23.7° | covered | 42.5 vs 70.5° |
   | 60° | 59.0 vs 84.9° | 23.1 vs 36.2° | 2.75 vs 3.56° | 42.5 vs 180° |
   | 75° | 59.0 vs 180° | 23.1 vs 70.1° | 2.75 vs 7.14° | 42.5 vs 180° |

   52 of 98 (orientation, focal, pitch) cases are short, every focal length included once the pitch
   reaches 60°. It is not a hole — ground outside the wedge still meshes, at `COARSE_TARGET_RAD` —
   so the symptom is blocky terrain along the left and right of a steeply pitched frame, up to 1.2°
   per cell, which at 24 mm is about 60 px of a 1000 px frame.

   `frameAzimuthHalfDeg` in `optics/fov.ts` computes that exact half-width:
   `atan((w/2) / (f·cos p − (h/2)·|sin p|))`, and 180° once the denominator reaches zero, which a
   24 mm frame does at 63.4° of pitch. Carrying it through `MeshView` as a constant `azHalfDeg` was
   the first attempt, and it was a regression, not a no-op. The up-pitch matrix at Lauterbrunnen
   showed nothing, because `|sin p|` puts the widest rim on the sky side, which the height bound culls
   anyway; the down-pitch matrix at Zermatt lost a sunlit ridge outright. A constant wedge charges
   every block the near rim's splay — portrait 24 mm at −40° goes 27.9° → 77.5° — the budget ladder
   pays for it in reach, and distant terrain drops to the coarse mesh.

   The rim only splays at the elevations it tilts towards, so the wedge is now a function of them.
   `frameAzimuthHalfCurve` samples the frame's side edge once per view and answers
   `(elLo, elHi) → half-width`; `descend` asks it for the elevations the block and the frame actually
   share, so a block that only reaches the far rim is bracketed as tightly as a level frame would
   bracket it. `MeshView` carries `vfovDeg` in place of `azHalfDeg`. Reach measured on
   `plain(1000)`, portrait 24 mm, `rangeM` 100 km:

   | pitch | constant wedge | elevation curve |
   |---|---|---|
   | 0° | 100000 | 100000 |
   | −20° | 100000 | 100000 |
   | −40° | 37500 | 100000 |
   | −60° | 4297 | 100000 |

   Both matrices re-shot against a same-session HEAD baseline — 30 cells, Lauterbrunnen up-pitch
   (24/70/200 mm × 40/55/70° × both orientations) and Zermatt down-pitch (24/70 mm × −40/−55/−70°) —
   are pixel-identical bar a transient "Loading buildings…" toast, and four up-pitch cells build
   slightly fewer blocks because the curve is *narrower* than `hfov / 2` at a down-tilted frame's far
   rim. The added coverage near the splayed rim is invisible for the same reason it is cheap: a
   pitched frame's wide bearings land on close ground, which `COARSE_TARGET_RAD × d` already refines
   to the cell floor. The win is that the correct wedge is now affordable at any pitch.

   The pad stays keyed to the frame's own `hfovDeg`, which measures how far the aim may wander, not
   how wide the picture is.
10. **Hillshade overzoom** — landed. `demProtocol.ts` resamples from the deepest ancestor that resolves
    rather than throwing, so the map's DEM source can point at `TERRAIN_MAX_ZOOM` without holing every
    region whose coverage stops early — and it now does, in place of the old `demZoom(15)` cap.
    Ocean, absent at every level, stays an error rather than becoming a flat sea.
11. **`aim(az, el)` accepted non-finite input and persisted it** — landed. Calling it with a missing
    argument wrote `NaN` through `normalizeBearing`/`clamp` into the persisted composition, after which
    every wedge test failed, the mesh degenerated to its coarsest 100 blocks and the viewfinder
    rendered empty sky with no error. `aimPatch` is now a pure export that returns an empty patch for
    a non-finite angle, so the store keeps its last good aim.

**Performance**

12. **Height-bound prepass memo** — landed. The grid build was 494–611 ms of a 752–1183 ms warm mesh
    and ran on **every** rebuild, recomputing a bit-identical result, because it depends only on the
    pin and never on the view: 1027² = 1.05 M `elevationAt` samples at ~476 ns each. One most-recent
    entry keyed on (pin, source, zoom, post size, root level) removes it from every aim, focal and
    tilt change. Warm mesh at Zermatt is now 688 ms at 70 mm, 613–644 at 200, 257–276 at 600, 172 at
    1200 and 150 at 2400. A grid built while a tile was missing is not cached, since it would stay
    unbounded for good once the tile landed; a complete grid can never improve, so it is kept.
    Restricting the grid to the azimuth wedge would be the other lever, but it would make the result
    view-dependent and so defeat the memo, which is the much larger win.
13. **Frame time end to end — measured, and there is nothing to fix at 70 mm.** Scrubbing the clock a
    minute per frame, which moves the sun and so re-renders every shadow cascade, holds p50 8.2 ms,
    p99 10.4 ms, max 10.6 ms against an 8.33 ms vsync — the viewfinder is display-locked, not
    compute-bound. Still worth re-running at 2400 mm with a mesh rebuild in flight, which is the real
    stress case; `gpuMs` remains the only figure the app itself reports.
14. Cancelling a superseded request's queued tile fetches in `DemCache`. Priority lanes were the
    first framing, but the mesh already rebuilds from scratch on every aim change, so the queue's
    problem is work nobody is waiting for rather than work in the wrong order.
15. `selectBlocks` cost.
16. **Terrain shadows no longer ride on the buildings gate** — landed. The mask was always terrain plus
    roofs, but `requestShadows` bailed on `!showBuildings` and the raster layer lived and died inside
    `applyBuildings`, so ground shadows vanished with the roofs and nothing drew below `BLD_MIN_ZOOM`.
    `applyShadows()` now owns `sun-shadow` on `showSunShadows` alone and inserts under the extrusions
    whichever went up first; the buildings flag rides in `MaskRequest` *and* both dedupe keys, so a
    toggle cannot be served a stale roofed mask; `shadowBounds` takes a terrain pad pair (3 km at 40 km
    reach) since a wall throws far further than a 600 m tower. A new `SHADOW_MIN_ZOOM = 8` replaces the
    old floor: the mask's DEM load is uncapped, and two zooms below that the cell outgrows the coarsest
    DEM zoom and the tile count runs 12 → 108 → 1645, with `maskRect` finally returning a negative width.
17. **DEM tiles a mesh level was about to read could be evicted under it** — landed. `DemCache` held
    55 tiles against a working set of about 58 at Zermatt, and every `await loadAll(want)` in
    `terrain.worker.ts` was followed by a synchronous read of the same tiles: a competing request —
    the map page is enough — could evict them in between, and `buildLevel` then read zeros. The
    symptom was a flattened far field, not an error. Instrumented at 55 slots: `level=3 tiles=5
    gone=1 evictions=3`, 15 606 of 127 057 vertices at sea level, 9 of 10 rebuilds at 2400 mm
    affected. `DemCache.retain(coords)` now pins a caller's working set behind a refcount and
    returns an idempotent release, the eviction loop skips held keys, and the cache holds 80 tiles.
    After: 0 evictions, 0 tiles gone, 0 missing vertices across 600/1200/2400 mm × landscape/portrait.
    The pure part is `core/terrain/holds.ts`, so it unit-tests without pulling `localTiles` and its
    `BroadcastChannel` into the worker.

    The two follow-ups of the same shape are closed too. `DemCache.load()` went through the map
    directly, so a hit never moved the key and the LRU degraded to FIFO under `loadAll`; it now goes
    through `get`. And every one of the six `loadAll` sites in the worker — `groundAt`, `elevation`,
    `profile`, `horizon`, `view` and the mesh's two — now wraps its await in `retain`/`release`, not
    just the mesh.
18. Midtown cascade allocation (N=5 or 6, ~1.3 ms per cascade) — **needs a user decision**.

**Awaiting the user**

19. `maxApertureAt`'s interpolated interior: a real constraint, or a hedged display only?
20. Hiding the Sun — should its glow halo go with it? (Today yes, same `uSun.w > 0.0` branch.)
