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
- Light & shadow: object shadow length, light-reach on terrain, auto light-source switch (P)
- Rainbow geometry (42° antisolar), cloud-distance calculator (P)
- Tides: NOAA harmonic constituents + offline prediction for US stations (P)
- Eclipses (astronomy-engine), 3D terrain orbit view (MapLibre terrain), Moon simulator (T)

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
| Terrain | AWS Terrarium tiles online; Mapterhorn PMTiles offline | attribution per region |
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
- **Heat grids live in normalised Mercator.** Cells are square on the ground, the image source maps
  onto the map without resampling, and one topocentric RA/Dec per time sample plus per-cell trig
  (`core/astro/fastHorizon.ts`) keeps a 64 × 64 × 240 grid under a second; the error stays below 0.02°
  within 60 km of the reference observer.
- **Terrarium, not HGT.** PlanIt reads SRTM `.hgt` tiles; Terrarium already merges that SRTM with 3DEP
  and EU-DEM and is fetched per tile. Its ~30 m ground resolution bounds alignment precision, which is
  why the Align mode has a tolerance and the panel says to confirm the framing in the viewfinder.
- **Landmark solids before 3D models.** Box, cylinder and spire markers give exact angular geometry
  from height, width, depth and rotation on the existing canvas. glTF/OBJ model import and OSM
  building extrusion are possible follow-ups; both are stack decisions left to the user.
- **Naming**: the two pins are the **camera location** and the **target location** in every user-facing
  string and doc; code keeps the short `pin` / `pin2` identifiers. Enum-like unions are `as const`
  objects with PascalCase members (`EventKind.TerrainRise`), never bare camelCase literals.
- **Terrain regions are packed from the AWS Terrarium PNG tiles, not Mapterhorn**: Mapterhorn is WebP
  and only canvas decoding is available for it, which is lossy for Terrarium; Mapterhorn archives can
  still be imported for the map's own terrain rendering.
- **Basemap regions are client-side range extracts of a PMTiles planet build.** The default source is
  the Protomaps daily build, whose CORS allowlist covers only local development origins
  (localhost:5173, localhost:3000), so it serves dogfooding but not a deployed origin; the source URL
  is editable. For deployment the candidate is packing OpenFreeMap's per-tile PBFs (CORS `*`) the way
  terrain is packed, with the Liberty style, sprites and glyphs cached alongside; that is an open
  decision.
- **OPFS is the source of truth for archives** (each `<id>.pmtiles` with an `<id>.json` sidecar);
  IndexedDB stays for the library.
- **Name**: "scape" is a placeholder.
