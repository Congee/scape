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
4. **Pure geometry, honest boundaries.** Compute astronomy, optics and terrain exactly. Weather
   is a forecast (Open-Meteo, 2026-09-24): always shown with its model, age and attribution,
   never drawn into the viewfinder, never shown as clear when data is missing. We stay a maps + 3D viewfinder app: deeper weather and
   dark-sky detail links out to windy.com and darkhours.app.
5. **Offline first, no account.** All user data lives in the browser (IndexedDB) with
   export/import. Map, terrain and sky data are downloadable by region and updated when the
   user says so. The app shell itself is a PWA.
6. **Fast.** Sub-frame updates while scrubbing. Heavy work (horizon sweeps, searches) in
   Web Workers. Astronomy calls are memoised per (camera location, day).
7. **Quiet.** Normal use must never spin a laptop's fan: an idle app (nothing moving, no load in
   flight) draws no frames and burns ~0 % CPU, and interaction work stops when the input stops.

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
Google Street View / photorealistic tiles (paid, non-relightable); a bring-your-own-key
Google 3D Tiles viewfinder backdrop is ultra-low priority (2026-09-24). Apple 3D / Look Around:
MapKit JS offers only its own Look Around view, no camera or FOV control, no mesh access. A native macOS shell could drive MKMapCamera (picture-only, fixed FOV); deferred
(2026-09-24).

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
| Light pollution | NASA GIBS VIIRS Black Marble raster (PD) | Falchi's atlas and the usual tile sets are CC BY-NC; estimated Bortle and mag/arcsec² at camera and target come from our own scattering model on VIIRS radiance (2026-09-24) |
| Tests | Vitest for core; Playwright later for UI smoke | pure unit tests, no I/O; `@maplibre/maplibre-gl-style-spec` (devDependency, pinned to maplibre-gl's copy) evaluates and validates our style expressions (user, 2026-09-25) |

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
the texture is sampled bilinearly. On phones (≤ 900 px) the nav rail is a bottom toolbar and the collapsed
panel keeps its tab row as a peek bar (`a6ed48e`, user's choice): the canvas at 390×844 went 19% → 57%
collapsed, and the 844×390 landscape phone, which had a 0 px canvas row, starts collapsed at 32%.

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
  P1 landed 2026-09-24 (`975c0b3`): models as per-triangle surfaces in the prism pass, "Model this
  building" seeded from Overture rows, part editor, db v4 store, Overture suppression by footprint,
  target height from the model apex. Design and phases P2–P4 in `docs/research/precise-models.md`.
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
them. **14** and **18** were measured and closed unfixed, **8** is a watch rather than a task, and
**22** is fixed, which also closed both of **21**'s open defects — the empty canvas was 22's own
doing, and the thin dark lines turned out to be real rock gullies.

**Waiting on the user (2026-09-24, overnight run).** Each has a default shipped or a task held:

- Basemap source for a deployed origin: OpenFreeMap per-tile PBFs packed into PMTiles, Liberty style,
  sprites and glyphs cached (merged 2026-09-24). Joins the terrain download by default up to 100 tiles;
  Liberty's shaded relief is dropped offline.
- Official LoD2 buildings (merged 2026-09-24): 3DBAG (meshopt), swissBUILDINGS3D and PLATEAU Tokyo 23 wards (Draco, decoder lazy-loaded only for those tiles); worker-built BVH occluder. PLATEAU heights use a user-imported GSIGEO2011 `.asc` (OPFS, bilinear per vertex; never bundled, GSI 測量法); without it, 36.7 m and a note.
- Target height on a model: apex (A/B pick 2026-09-25).
- Tools tab (Phase 7 calculators, merged): name "Tools" after Night; tab min width 62 px so 9 tabs
  fit two rows; Rainbow overlay off by default; RAW size 14-bit uncompressed (worst case); rainbow
  behind terrain drawn dim and dashed, not hidden; Earth-shadow cloud light without refraction
  (~0.5°, a few minutes short); cloud heights above the camera's ground; time-lapse playback capped
  at 30 Hz and looping. Twilight and moonlight scene EVs are estimates awaiting field readings.
- Offline buildings (merged): z14 only, "download with the terrain" on by default up to 100 tiles
  (~30 MB dense city; NYC 50 km = 686 tiles / 146 MB); separate Estimate/Download too. Open: should
  one click also fetch the basemap for the region? Yes, up to 100 tiles.
- Hidden buildings (or terrain off, or the viewfinder closed) stop both building streams: queued fetches dropped, on-wire ones aborted, no redraws; showing them reloads (smoke `coldtiles.sh`).
- Models P1 (merged): a hidden model does not suppress Overture rows, nor the map's fill-extrusion
  under it (`models-fill` hides it under a visible one); "Model this building" seeds from every z14
  tile the building spans; `.scape.json` export omits models until P3b.
- Tides and eclipses (merged): NOAA harmonic (1251) and subordinate (2242) stations; a closer subordinate station wins; Timeline tide row landed later; lunar eclipse moon tinted by umbra coverage (the map's live Moon line too) (moon-free window and Milky Way status count an eclipsed Moon as dark (user, 2026-09-25));
  eclipses via astronomy-engine (within 30 s of NASA), no Besselian elements.
- Light extras (moon simulator, auto light source, first/last light, orbit) merged at `aa61568`. Defaults:
  moon shade on the map neutral grey (A/B pick 2026-09-25); first/last light counts terrain only; earthshine under 35 % lit;
  orbit pitch 65° (max 80°), 6°/s, not saved.
- Terrain waste at long focal lengths: dropped (merge `6a54ad2` reverted). It cut built blocks 6–21 % at
  200–2400 mm, but DEM tiles and frame/build times were unchanged, so there was no measurable gain. The follow-up
  (uncapped eye leaves, `coneDepthRange` skipping them; `wip/conedepth`, 2026-09-25) was dropped as well: it saved
  only 5–9 of ~140 DEM fetches at 600/2400 mm, build and frame times stayed within noise, and shadows moved (AE up
  to 385 px at 2400 mm). `viewNearM` was already 1 here; the change came from the coarse eye leaves' own heights.
- Firefox smokes (`scripts/smoke/bidi.ts`, checked on Firefox 156, 2026-09-25): Firefox allows one BiDi session, keeps it
  when the client's socket drops, and serves no `/session/<id>` for a session made over BiDi, so it cannot be rejoined. SIGINT,
  SIGTERM, SIGHUP and crashes end it; a SIGKILLed or hard-crashed smoke wedges that Firefox until it restarts.
- Model sharing (P3b core, merged): exported models are named `<name>.glb`; a Drawn model's export
  carries its parts, so re-import gives an editable model; `.scape.json` Replace also wipes models.
- Models P2 (merged `a45a27d`): selection and outline in accent #5aa9ff; a drawn building starts at
  10 m (nearby Overture median later?); arrow-key nudges only behind the "Arrow keys adjust it"
  checkbox; long-press 600 ms deletes a vertex; "Set target to model top" replaces "Use as target";
  phone sheet folds away while drawing and reopens with the model in view. Follow-ups (`wip/modelsfu`):
  meshes are closed (a floor under every part); terrain and buildings in front hide the outline on the
  map and in the viewfinder, and on the map other models in front do too (layer order: selected, others,
  buildings); covered vertex handles dim to 0.2, checked on idle.
  On the map the selected model's outline is white over a thin dark casing, so it reads against the
  accent part (user, 2026-09-25); other models keep the model-colour outline.
- Models P4 (photo overlay + model occlusion): photo controls live in the viewfinder chips panel;
  the photo is kept in memory only (IndexedDB per plan?); a photo without EXIF locks to the current
  lens's field of view; nudges step 0.002 photo widths / 0.1°; a body behind a building stays
  ghosted at 35%.
- Models P3b (import sheet, export, imported render): "On a building" keeps a highlighted Overture
  selection until "Place on this building"; a file carrying `extras.scape` is placed on pick; the
  Height nudge is off for Imported models.
- Models ground fix: a drawn model whose ground is unknown at save (offline/timeout) is saved at
  sea level and healed on the next load, with an editor warning naming the cause ("Try again" when
  online, "terrain not downloaded" offline) until healed.
- LoD2 follow-ups: buildings at night dimmed to the ground's moonlit level, 0.23 of day (A/B pick 2026-09-25); swissBUILDINGS3D stays
  pinned to v1/20260520 (vs following latest); PLATEAU beyond the Tokyo 23 wards not started.

**Precision audit (2026-09-24, pinned by `horizons.test.ts` and `geodesy.test.ts`).** Sun/Moon are
within 0.003° and 4 s of JPL Horizons, stars within 25″, LoD2 roofs within 1.3 cm of source. The
visible errors are design choices, each waiting on a decision (recommendation in brackets):

- Fixed 2026-09-24 (ellipsoid): WGS84 geodesics (GeographicLib port) and an exact ENU pin frame on
  every placement path; terrain, buildings and horizon agree with the Sun to 1e-6° (was 0.03–0.19°).
  The vertical stays a spherical drop with k = 0.13 (≤0.5 % of the drop).
- Fixed 2026-09-24 (astrofix): refraction tapers to zero by −3° (≤24″ vs Horizons below the
  horizon, was ≤39′); stars and the Milky Way are refracted; catalogue stars carry aberration and
  proper motion to 2025 (<1″ vs astropy, was 15–20″); rise/set use sampled ground plus eye height
  (0.1 s at 3000 m, was 44 s); Tokyo fallback 37.0 m. Near the −1.775° taper the apparent Sun is
  3.5′ off Horizons.
- Fixed 2026-09-24 (astro2): viewfinder, star and Milky Way refraction scale by air density at the
  eye (ERFA within 0.2 % above 10°); constellation vertices snap to the brightest catalogue star
  within 120″ (were 13″ median, 95″ max off).
- Fixed 2026-09-25 (airdensity): last light, moon view, map light, light probe, finder/align workers
  and fastHorizon refract in the eye's air too; the rise/set threshold is `riseApparentDeg(ρ)`
  (−0.247° at 3000 m, was −0.215°); fastHorizon at 3000 m matches the viewfinder to 1e-6° (was 0.1°).
  Follow-up 2026-09-25 (firstlight): first light and alpenglow share one observer and lit-span pass (equal to the ms);
  Calendar eclipse visibility stands on the pin's ground (was sea level).
  Follow-up 2026-09-25 (plannerrho): planner rise/set and the map night band refract in the eye's air too
  (threshold 0.045° higher at 2000 m ground + 1000 m eye, was the ground's ρ).
- Rise/set times come from 0.5° horizon columns, so a jagged near ridge can put the viewfinder's
  Sun/Moon flip up to ~30 s off the listed time (Zermatt 1–6 s). Finer azimuth steps around the
  rise/set azimuths [leave for now].
- Safari/iOS (AWS terrain) reads ground up to 197 m low (1.1° at 10 km). Software WebP decode (new
  path or dependency) or accept.
- Fixed 2026-09-24 (astro2): Mapterhorn ground below sea level reaches eye and mesh (Zuidplaspolder
  eye −4.53 m, was 1.60 m); AWS Terrarium negatives are seabed and clamp to 0, so on Safari polders
  and the Dead Sea read 0 [accept]. Mapterhorn flattens hydro water to −1.5 m, so the Hudson sits
  1.5 m below sea level [accept now, water mask later].

**Nothing else in this register is waiting on a decision.** **19** and **20** were answered on
2026-09-23 and are closed below. **2** is closed: the fine region is bounded to what the frame draws
(merged `763a99b`). **21**'s extent cap was re-measured after 2 and closed unshipped
(below).

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
   opposite of what a long lens wants. So the next step is not a finer constant on its own.

   **What the 0.5 m surface actually looks like** (2026-09-18). Before designing around the budget,
   the reference picture was rendered: `BASE_CELL_M` 0.5, `MAX_LEVELS` 11 *and* the triangle cap lifted
   to 12 M, so nothing binds and the mesh reaches its own 0.41 m posts. Zermatt village to the
   Matterhorn at 8.55 km, landscape, aimed at the target. The floor reached 0.5 m at every focal and
   `dataLevel` — the DEM itself — is what stopped it; DEM zoom reached z17 with no missing tiles.

   It is a large difference, and it is on the subject's faces rather than its outline. Pixels past a
   1% channel delta: 31% of the frame at 2400 mm, 15% at 1200 mm, 6% at 600 mm, and **0.1% at 24 mm
   portrait — indistinguishable**. The sky/terrain boundary moves a median of 4 px and at most 23 px
   across a 0.9° frame, i.e. 0.0024° median and 0.014° worst, so at most ~3% of the changed pixels are
   silhouette; the rest is surface. At 2 m the summit is smooth modelling clay with a few soft shadow
   blobs; at 0.5 m it is rock — vertical fluting down the west face, a stippled field of small
   shadowed notches over the crest and east face. The softness was the DEM's, not the renderer's.

   **Both limits bind, at different rungs, and the GPU is not either of them.** On master the *constant*
   stops the ladder: 2400 mm settles at `minCellM === BASE_CELL_M === 2` having built 2.18 M of the 3 M
   cap, with the headroom unspendable. Lifting only the constant (the reverted experiment above) then
   runs into the *budget* at the next rung down. So the 0.5 m picture needs the constant **and** about
   2.5× the cap — 7.57 M triangles at 2400 mm, 10.11 M at 600 mm — and neither alone does anything.
   The GPU shrugged at that: no context loss or allocation failure at ~10 M, `gpuMs` 1.9 → 2.24 ms at
   2400 mm, shadow raster 1.3 → 2.7 ms, and the 24 mm frame if anything got faster. The frustum culls
   nearly all of it — at 2400 mm, **1 516 blocks are built and 52 are drawn**.

   The whole cost is CPU selection, mesh build and DEM fetch: time to first level 407 → 2 489 ms at
   2400 mm, and to the last level 2 404 → 10 230 ms at 600 mm. That is what is unshippable, not the
   triangles.

   So bounding the fine region to the subject's neighbourhood is the enabling work, and the prize is
   now known: roughly 85% of the built blocks touch neither the frame nor its shadow cascades, so
   cutting the fine region to the subject should recover most of the latency and leave the picture
   intact. It composes with a finer constant rather than replacing it, and it still changes what the
   foreground looks like — a picture decision, not a number. Raising the cap alone is not worth doing — at long focal it is already slack, and where it does bind (600 mm) bounding is the
   cheaper answer.

   **Closed** (2026-09-23, merged `763a99b`). Blocks are Frame, Caster (floored at 2 m, the cascade
   texel) or Coarse; balance runs only on Frame–Frame seams, so the gradation ring is gone. Every
   selection is held to master's balanced coarse-bound cost, and the z13/z14 detail bound is loaded
   only where `detailMayPay` says it could buy a finer frame. Floor per view, master → now: 600l
   2 → 0.5 m, 1200l 2 → 1 m, 1200p 2 → 0.5 m, 2400l 2 → 1 m; 24/70/200 and 600p unchanged and
   pixel-identical. Missing shadows vs a 0.5 m reference halve at 1200–2400 (2400l 12:00: 2.79 →
   1.13%). Warm latency within noise of master everywhere; cold is bimodal (~1 s modes) in both arms.
   2400 at 0.5 m would need 442 blocks against a 331 cap — left as the latency trade-off.

   Two things the experiment turned up that are not about the floor. `KEY_HALF` in `mesh.ts` was
   hardcoded for a level-8 root and would have silently folded a level-10 root's keys onto their
   neighbours; it is now derived from `MAX_LEVELS`, by shift so it stays a smi (computing it with `**`
   boxes the constant as a double and costs 2× on the whole selection). And `planHeightBound` stays
   metrically unchanged when pinned to a 2 m base, but `buildPyramid`'s lookup then has to clamp to the
   pinned level and index via the covering ancestor — looser, never unsafe.
   **The floor also costs the foreground, not just the subject** (2026-09-18). Aiming downward from a
   summit — Gornergrat at 3109 m, eye 1.6 m up — a 200 mm frame at −17° is filled edge to edge by a
   single untextured facet, because the sightline meets the ground about 5 m away and the mesh's
   finest cell there is 4 m. At −30° it is 2.8 m away and 18 blocks cover the whole frame. That much
   is geometry, not a defect: a 4 m floor cannot show anything at 3 m. But it means the floor's cost
   is not only a soft distant subject, it is a blank near field on any downward shot, which a
   frame-derived floor would fix from the same end.

   A hard-edged near-white band across that frame turned out to be **the Gornergrat observatory's
   roof**, 16 m from the camera, and not a defect at all. Recorded because the identification came
   from the colour and is a usable technique: the band measured exactly `srgb(224,224,226)`, which
   is `prismGl`'s `BASE` of (244,244,246) times `ROOF_SHADE` 0.92 with haze negligible at that
   range — an exact match, where the terrain shader's brightest possible output is about
   (165,187,220) and stays blue-dominant. **One real trap surfaced on the way**: the viewfinder's
   prism gate reads `compositionStore.showBuildings`, while the map's Layers tab writes
   `settingsStore.showBuildings`. Toggling the settings one hides nothing in the viewfinder and
   leaves `__scape.prism.buildings` unchanged, so it is easy to "eliminate" buildings as a cause
   while they are still being drawn. That cost a wrong conclusion here; check the composition store.

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
14. **Cancelling a superseded request's queued tile fetches** — measured, then closed unfixed. The
    framing assumed a drag posts many mesh requests; `syncMesh` is on a 250 ms trailing debounce, so
    a continuous drag posts *one*. Twenty aims at 200 ms produced 2 requests, 1 supersede and 2%
    wasted bytes. Supersedes need a stepwise "nudge, look, nudge" pattern where each pause clears the
    debounce but the next nudge lands inside the 1.5–5 s build.

    Even then the cancellable half is the smaller half. Half to two-thirds of a stale working set is
    tiles a *later* request also wants — prefetch, not waste — and of the genuine waste, more is
    already past `acquire()` than still queued: 335 KiB of 5.21 MiB (6%) on a realistic 900 ms nudge
    scrub, 2.4 MiB of 10.3 MiB on an artificially stepwise one, nothing at all on a real drag.
    Recovering the running half would need `AbortController` on the shared in-flight fetch, which
    saves only the untransferred remainder and thrashes connections. Head-of-line delay recoverable
    by cancelling is bounded by the waste entries ahead in the FIFO — about 2 of 12 slots, ≈0.1 s of
    a 1.5 s first post. It does not compound either: a superseded request stops issuing at its next
    `latest.Mesh !== req.id` check, so it contributes at most one level's tiles and the stale set
    stays near one working set (peak 14 seen).

    What the fix would have cost: per-key waiter refcounting threaded through `load`/`loadAll` and
    the `fetchTile` parent recursion, plus a liveness set so Elevation/Profile/Horizon/View/Points
    tiles stay uncancellable — because `inflight` shares one promise per tile, and dropping one a
    live caller awaits turns that tile into sea level with no error (see 17's silent-failure mode).
    Not worth it for 6% of bytes on a pattern the debounce mostly prevents.
15. **`selectBlocks` cost** — landed, 3.7–5.4× faster. Nobody had measured it: the budget ladder
    throws away its leaf map and rebuilds from the roots at every rung, and the worker-shaped case
    (600 mm, 100 km range, 0.41 m posts, height bound) took 17 ms over 8 walks, the worst table case
    24 ms. That is pure latency before the first tile fetch starts, on every aim change. `balance()`
    was 78–85% of it, and the cost was building the leaf-map keys, not the fixpoint.

    Two changes, both inside the leaf map. `blockKey` packs `(level, ix, iy)` into one small integer
    instead of a template string; the field width is derived from `MAX_LEVELS` by shift, so a deeper
    tree cannot fold keys onto their neighbours and the constant stays a smi — computing it with `**`
    boxes it as a double and costs 2× on the whole selection. And `balance()` skips the upward scan when a
    same-level neighbour is already in the map: the leaves tile the root square, so that neighbour
    *is* the covering leaf and the old scan to the root could only come back empty.

    Bit-identical by construction — same descent predicate, same fixpoint, same insertion order — and
    checked as such over 1 633 cases (the `EXPECTED` shapes, long-lens and wide-angle frames, the
    worker-shaped case, and 1 600 randomised option sets across range, DEM post, focal, pitch,
    azimuth, triangle budget and synthetic ridge bounds): zero mismatches. The invariant both changes
    lean on is now a test — the leaves stay one partition of the root square, so no two blocks share
    a key and at most one level carries the leaf over any edge neighbour's cell.

    Not attempted: reusing the previous rung's leaf map, and predicting the reach instead of halving
    to it. Both hinge on the balanced leaf count being monotone in `reachM`, which only held
    empirically, and both would have to reproduce the exact rung sequence to keep the same `reachM`.
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
18. **Midtown cascade allocation — measured in the app, and the answer is no** (2026-09-18).
    `CASCADE_COUNT` is 4. This started as an offline sweep of `fitCascades` against the Midtown scene
    the tests use, which put N=6 ahead at 24 and 50 mm. **That sweep was wrong in its headline**: it
    assumed `scene.halfM` was 20 km, and the running app reports 49 km. The bound sets every practical
    split, so the whole table moves. What the sweep did get right is that N is not monotone and that
    the outermost cascade is the same at every N.

    Re-measured from `__scape.prism.shadow.info`, which reports the real fit — Midtown rooftop, eye
    120 m, camera 40.7484 N 73.9857 W to the WTC 4.7 km out, 09:00 EDT with the sun at +23.5°. Worst
    shadow texel a receiver inside 5 km can get, i.e. the texel of the slab that holds 5 km:

    | worst texel ≤5 km | 24 mm | 50 mm | 200 mm |
    |---|---|---|---|
    | N=4 (today) | **5.66 m** | **4.36 m** | 3.83 m |
    | N=6 | 10.37 m | 7.66 m | **1.92 m** |

    **N=6 is 1.8× worse at 24 and 50 mm** — exactly the wide angle it was proposed for — and 2× better
    only at 200 mm. Adding cascades subdivides the interior, and with a 49 km far bound the new
    boundaries land such that 5 km falls at the far end of a deeper slab than it did at N=4. The last
    cascade is identical either way: far 49152 m, texel 32.0 m at 24 mm, at both N.

    **Cost did not decide it, because at this scene it cannot be measured.** `shadowPass` has no cache,
    so a clock scrub re-renders every cascade every frame; over 600 rAF frames the GPU timer gives p50
    6.35 / 6.03 / 5.36 ms at N=4 against 6.64 / 5.68 / 5.43 ms at N=6 (24/50/200 mm), i.e. one arm wins
    at two focals and loses at one. Turning shadows off entirely at 24 mm gives p50 5.65 ms against
    5.05 ms with them on — a whole 13.4 M-triangle shadow pass inside the noise, so
    `EXT_disjoint_timer_query_webgl2` on ANGLE/Metal cannot resolve this on an M1 Max. The earlier
    "~2.6 ms" was inferred from the cascade count, not measured; drop it. The 34 MB of extra depth
    array (2048² `DEPTH_COMPONENT32F` per layer, 67 → 101 MB) is real regardless.

    **And nothing changes on screen.** N=4 against N=6 is AE 4951 / 4644 / 1100 pixels of 3.95 M
    (0.13% / 0.12% / 0.03%), and a 3× crop of the largest shadow edge in the 24 mm frame is
    indistinguishable between them: the PCF kernel is already wider than the texel step at the ranges
    that fill that frame, so the predicted stair-stepping is not visible at either N.

    **Closed: N stays at 4**, and this is no longer a user decision. Caveat kept honest — one scene,
    one sun elevation, a near-level frame. The mechanism generalises; the exact numbers do not.

    **21's extent cap is not the lever here.** Cherry-picked onto master and measured at the same three
    focals, it changes nothing at Midtown: same 314 / 329 / 272 blocks, same cascade fit to the metre,
    same 49 km far bound. It closes at long focal *pitched off the relief*, which a Midtown frame
    aimed 0.6° below level never is. Its case remains 21's own — the mesh it builds and never draws.


21. **Most of the mesh serves nothing, and that is true on shipped master** (2026-09-18). Every
    selected block was classified against the renderer's own `sphereVisible` and `boxCastsInto`
    calls — not a reimplementation — and cross-checked: the audit's drawn totals match
    `__scape.prism.terrain.blocks` exactly. Zermatt village to the Matterhorn, warm:

    | master, 3 M cap | blocks | drawn | drawn or casting | neither | warm build |
    |---|---|---|---|---|---|
    | 600 mm | 394 | 21 | 113 | **71%** | 1.04 s |
    | 1200 mm | 475 | 24 | 116 | **76%** | 1.28 s |
    | 2400 mm | 436 | 19 | 74 | **83%** | 1.19 s |
    | 24 mm portrait | 499 | 217 | 475 | 5% | 1.34 s |

    The fine config of 2 (0.5 m, 12 M) has the same shape at three times the size — 1 189 blocks and
    82% waste at 2400 mm — so the reference render does not create this, it makes an existing problem
    expensive enough to feel. `selMs` is 3–125 ms after 15, so selection is not the cost; `buildMs` is
    the warm cost and `fetchMs` is the whole cold-to-warm variance, swinging 10×.

    **The cause is `balance`'s gradation, not `COARSE_TARGET_RAD`.** Classifying each unserved coarse
    block by how many rungs coarser the pure coarse rule would have allowed: only 13% sit at the rung
    the coarse target asks for. The other 87% are finer than needed by up to 8 levels — 256× — and
    exist only because `balance` walks the ten-level step from the fine wedge out to the 512 m coarse
    field one rung at a time, nesting a ring per level around the wedge. At 24 mm, where the wedge
    covers the frame and there is no step, the over-refined population is 3 blocks. It is concentrated
    near the camera because the rings nest around the wedge and the wedge crosses the near field on
    its way to the subject: at 2400 mm, 364 of 700 unserved coarse blocks sit within 2 km.

    Also established: `reachM` does not bound the mesh's extent at all. `descend` walks every root
    block and each one becomes a leaf or splits, so the mesh always covers the full ±49 152 m root
    square in every direction; `reachM` only gates whether a block may use `fineRad`. The outer field
    is cheap in blocks (levels 8–10: 51 blocks at 2400 mm) but not in cold latency — z7–z9 cost
    ~800 ms of fetch at 600 mm for blocks that are neither drawn nor casting.

    Caster reach is set exactly by the last shadow cascade's far plane: ~10 km at long focal, where it
    is `lensFar`, and the whole mesh at 24 mm, where it clamps to `scene.halfM`.

    Three reductions, in the order they are worth doing:

    - **Cap the mesh's extent** where nothing can be served — built, verified, and **held, not
      shipped**. The cap is the union of what the frustum can reach and the last cascade's far plane,
      fed back from `fitCascades`; it cannot be a distance constant or the cascade plane alone,
      because at this site the furthest drawn block is 9.2 km only because the subject is, and a
      frame containing a 40 km peak must still build it. It works: a 1200-case randomised A/B puts
      the `descend` refactor at **875 cap-open cases / 0 mismatches**, so the restructuring is exact,
      and 325 cap-finite cases drop 222 blocks. Two objections raised against it were both wrong. The
      low-sun one — that the cap would silently drop distant casters — has the right premise
      (`casterTris` falls by up to 44 928 at low sun; midday is bit-identical) and the wrong
      conclusion: **AE 0 at 05:40, 06:00, 06:20 and 07:00**, every frame lit and shadow-textured. The
      cone-drift one was real but fixable, and the fix found a second rounding: the window quantizes
      focal onto a quarter-octave ladder while `cascadeSplits` uses the camera's own, worst case 6%
      tighter, and the pitch is rounded onto a `meshElPadDeg` grid that pulls `|pitch|` toward level
      by the full pad. Both are absorbed conservatively at zero cost. **It is nonetheless not worth
      shipping**: warm build 887 → 885 ms, −24 blocks of 529, −3 DEM tiles of 54 — not a performance
      change. What is left is an occasional budget re-spend (14 of 325 cases change reach, 5 change
      cell size), bought with a new GL→terrain module edge and a failure mode that silently removes a
      shadow, which is the app's core promise and is verified at one site only. Reverted and kept as
      a patch; it should be revisited if the fine wedge is ever bounded to the subject (below), which
      would make the outer field the dominant cost rather than a rounding error.
    - **Let `balance` take a two-level step** — landed in `ed2b167`. `skirtDepth` is derived from the
      step (`3·cellM·2^k`, which at k=1 reproduces the shipped `6·cellM`), so the slope the seams
      tolerate is unchanged at 6. Verified against master at the same site: at 900 mm both trees pick
      the same configuration and the same 236-block fine level, and the picture is **AE 0** while the
      total falls 580 → 454 blocks; 1200 mm and 2400 mm are likewise AE 0 at −24% blocks and ~−25%
      warm build. Where the freed budget changes the configuration the picture improves: 600 mm buys a
      2 m cell in place of 4 m, and 200 mm buys reach 7813 → 8594 m, which finally puts the 8.55 km
      subject inside the fine wedge at all. Neither failure mode appeared, and an 8× deeper skirt is
      AE 0, so nothing in any captured frame is a seam gap.
    - **Bounding the fine region to the subject** — 2's parked decision — is worth more than either,
      and now has a second reason: shrinking the wedge-to-coarse level gap collapses the gradation
      ring that the two-level step attacks from the other side. A wedge bottoming out at level 4
      outside the subject's range cuts the step from ten rungs to six.

    **Re-measured after 2 (2026-09-23): the cap stays unshipped.** On `9c83ff4` the unserved share
    is 35% / 51% / 60% at 600 / 1200 / 2400 mm (5% at 24p), but spread across every level — ~70 of
    2400's 160 lie within 2 km — so the outer field is not dominant. Re-derived on
    `wip/mesh-extent-cap-2` (`7bdc1d9`): −12 to −24 blocks and −1 to −3 tiles on narrow frames, warm
    last ≤ 50 ms, first level unchanged, cold within noise; AE 0 over 33 shots and ≤ 3.5 px at 1° sun.
    No shadow lost, no real win.

    Raising the triangle cap is not on this list: at long focal it is already slack (2.18 M of 3 M at
    2400 mm), and where it binds, these reductions are the cheaper answer.

    A fourth, orthogonal to all of them: **the worker fetched levels strictly in series** —
    `await cache.loadAll(want)`, build, post, next level — so a pass paid the *sum* of every level's
    fetch rather than the longest. Landed in `20f197c`: the union of all levels' tiles is issued up
    front, unawaited and unretained, which warms the cache without disturbing anything. Each level's
    own `retain` + `loadAll` still runs before `buildLevel`, so a prefetched tile evicted in the
    meantime is re-fetched rather than read as sea level, and FIFO order keeps the finest level first.

    Measured on the fixed base `25d8855`, per-tile latency instrumented to 250 ms so the serialized
    fetch is visible at all, medians of n=5–6 with the arms rotated:

    | arm | cold first | cold total | cold tail | warm first | warm total | warm tail |
    |---|---|---|---|---|---|---|
    | before | 2311 | 6146 | 3818 | 4253 | 5727 | 1469 |
    | **eager (shipped)** | 2329 | **3246** | **844** | 4268 | **4995** | **733** |
    | deferred | 2244 | 3380 | 1126 | 4254 | 5239 | 985 |

    Cold total −47% and tail −78%; warm total −13% and tail −50%; first post unchanged to within
    run-to-run spread. One eager cold run in six came out before-like (tail 3744 against the other
    five at 818–857) and could not be reproduced deliberately. On the real network at this site all
    three arms are inside noise — 54 tiles come back fast enough that there is no serialized fetch
    left to hide — so the instrumented arm is the one that carries the mechanism.

    **Both corrections recorded here earlier were themselves wrong, and item 22 was the reason.** The
    +313 ms first post attributed to decode contention does not exist on the fixed base: it was
    cross-request interference from 22's duplicate build, whose own prefetch backlog collided with the
    real request's first level. So "the first post cannot get slower" holds after all, and the
    "throughput-bound, so the prefetch cannot help cold" conclusion drawn from the same runs retires
    with it. Deferring the prefetch until after the first post was built and measured to fix a
    regression that had already gone; it is strictly worse in all four instrumented cells, and was
    discarded. The 16.7 s cold figure quoted before any of this remains unreproducible at this site —
    upstream and OS caches stay too hot behind a fresh browser profile — so it stays unverified.

    What the bullet predicted and still stands: a superseded request drags its whole union along, with
    no cancellation path in `DemCache`. Before 22 that cost was doubled cold, since the discarded
    pitch-0 build prefetched its own union too. It is a single backlog again.

    Supersede cancellation was not added: `DemCache.load` hands back a shared inflight promise and the
    semaphore has no cancel, so there is no cheap path that does not reintroduce 14's refcounting. A
    superseded request therefore leaves a larger stale backlog — 14's measurement, at a bigger volume.

    Two pre-existing defects surfaced while checking the step, both reproduced on master, neither
    caused by it, and both now closed:

    - **Thin dark lines down steep faces at a 2 m cell** — **they are the terrain.** One pixel wide and
      ruler-straight over hundreds of pixels at 600 mm, which is what made them look synthetic. Already
      ruled out: a seam gap (8× the skirt depth is AE 0, and rim normals are true central differences
      over a one-cell halo) and the block grid on spacing (the pair at 600 mm is ~8.5 m apart where a
      block is 96 m and a z15 DEM tile ~850 m).

      Settled two ways. In the source, over the Matterhorn's NE face: at the zoom a 2 m cell reads
      (z15, 1.66 m posts) 1.3% of posts sit more than 2 m below the mean of their four neighbours,
      while at z17 (0.415 m posts) there are **none at all** — because the same gullies are four posts
      wide there and no longer register as a one-post groove. And the pyramid is not aliasing them into
      existence: a z15 post against the 4×4 box average of its z17 children is **RMS 0.019 m**, against
      1.012 m for a decimation of the same children, so the coarser levels are true averages and the
      grooves survive the average because they are deeper than they are wide.

      In the render, the pair's separation scales with focal — 40 px at 600 mm, 83 px at 1200 mm, a
      ratio of 2.07 against the expected 2.00 — so they are fixed in the world, not in the raster,
      which is the one thing a rendering artifact could not do. At 1200 mm they also stop being
      one-pixel lines and resolve into irregular features with jagged tops and tapering ends. They are
      narrow rock gullies about 1.5–2 m wide, correctly drawn, and only visible once the cell is fine
      enough to resolve them, which the two-level step moved from 1200 mm to 600 mm. The speculative
      link to the balance audit's worst 3.72× seam overrun is void.
    - **A viewfinder URL for a fresh camera can render an empty canvas** — reproduced deliberately and
      **closed by 22**. The symptom was a flat sky with a correct mesh behind it: right eye, mesh-window
      azimuth matching the aim, fresh profile, no missing tiles, no error, and nothing in frame but the
      target marker, projecting to a plausible spot. The suspected mechanism was 22: the renderer draws
      `t.meshKey === meshKeyFor(world, settings, meshWindow) ? … : []`, so the moment the window's pitch
      moves off the fabricated 0 the built mesh stops matching it and *nothing* is drawn until the
      rebuild lands.

      Confirmed by A/B on two worktrees at once, `25d8855^` and master, same URL (Zermatt →
      Matterhorn, 600 mm), same procedure: load, wait for the mesh to settle, then nudge the clock one
      minute, which is the cheapest "unrelated store bump" there is. Pre-22 the window sits at pitch 0
      with 8 levels built and 20 blocks drawn; the nudge re-runs `ensureMeshWindow`, the profile is now
      there, the window jumps to pitch 18.29 — and for **1.1 s** `__scape.prism.terrain` is absent
      entirely while the store still holds all 8 levels. The screenshot taken inside that window is the
      bug report's picture exactly: flat blue, target marker, "behind terrain". On master the same
      nudge holds 37 blocks across every 100 ms sample with no gap at all, because the window was
      already at the true pitch and nothing had to be re-cut.

      The 35 blocks quoted in the original report are explained too: `__scape.prism` is not cleared
      when a frame draws nothing, it simply stops updating, so it kept the last good frame's numbers.
      Cold, the gap is the whole rebuild — seconds, not 1.1 s.

      Separately and definitely real: the same URL and focal gave zoom 15 / 2 m / reach 100 km on one
      load and zoom 14 / 4 m / reach 23 km on another, so an unguarded capture script cannot be trusted
      (22 is the cause) — `shot4.sh` and `shot1f.sh` now print the aim beside the configuration.

22. **Every cold `aimAtTarget` load aimed its mesh at the horizon** (2026-09-18) — fixed in
    `25d8855`. Found by reading the path, then measured in the browser. `aimFor` returns `elevationDeg: targetAngleDeg ?? 0`,
    and `ViewfinderController.ts:212` supplies that angle as `fresh?.los.targetAngleDeg ?? null`,
    where `fresh` is non-null only once the sightline profile for the exact current key has resolved.
    So until then the aim's elevation is a fabricated 0. `ensureMeshWindow` takes its pitch from that
    same aim. The mesh sync is on a 250 ms trailing debounce; the profile is not debounced but awaits
    a whole tile set along the sightline at up to z14, which cold cannot come back inside 250 ms. The
    result: a complete mesh is built and posted at pitch 0.

    **The measurement was worse than that.** Two builds would at least have converged. At HEAD in a
    detached worktree with cache and OPFS cleared, the cold load produced **exactly one mesh key, at
    4511 ms, with `pitch=0`, and never corrected it in 30 s** — with `profileKey` set,
    `targetAngle: 18.337`, `pin2GroundM: 4447.4` and `busy` false throughout. `ensureMeshWindow` was
    never subscribed to the terrain store at all; only `schedule()` was. So the fabricated window
    stayed committed until some unrelated store happened to bump it, and what a user sees on a cold
    load is a mesh cut for a band of terrain the camera is not pointing at. The same load after the
    fix: one build at 4560 ms with `pitch=18.290905764334017`, no second build, no latency cost. The
    before shot is the Matterhorn as a smooth featureless clay pyramid; the after has vertical
    fluting, shadowed notches and an articulated ridgeline, AE 94 542 over 7.3% of pixels.

    **The aim never needed the profile.** `analyzeSightline` computes `targetAngleDeg =
    elevationAngleDeg(total, targetM - eyeM)` from the endpoints alone — the 400-sample ground array
    serves occlusion and clearance only — over `eyeM = max(groundA,0) + eyeAboveGroundM` and `targetM
    = max(groundB,0) + targetAboveGroundM`. Those are the two pin elevations the terrain store already
    holds from the far cheaper `Elevation` request, and `ViewfinderController.ts:864` already computes
    exactly that shape as a fallback for another purpose. Deriving the aim from them instead makes the
    first committed window the right one. The "~0.007°" bound claimed here before was wrong: the
    profile samples at `demZoom(14)` ≈ 6.6 m posts while `Elevation` reads z17 at 0.41 m, so on a
    summit the two can disagree by tens of metres and the angles *can* cross the 0.25° pitch quantum.
    That costs at most one rebuild, in place of today's guaranteed wrong-band build.

    **`finder.ts:59` already does this**, preferring the profile's angle and falling back to the
    endpoint elevations. So this is not a fix to design but existing behaviour one call site is
    missing, and the expression now exists three times — there and twice in the controller.

    It probably accounts for both of 21's open defects, not just one: the empty canvas is the window
    changing out from under a built mesh, which the renderer answers by drawing nothing. And it
    subsumes the "unguarded capture script" note in 21: a pitch-0 mesh is coarser and shallower,
    and `zoom 14 / 4 m / reach 23 km` is what a capture taken before the rebuild sees. It also
    explains why 21's prefetch measured −28% warm but nothing cold — cold is dominated by the wrong
    build, not by serialized fetch, so it is worth more than all three of 21's reductions together and
    nothing else should be judged on cold numbers until it is in.

    **The fix**, in `25d8855`: `targetAngleFor` in `@state/terrain` is the one resolver, preferring a
    current profile and otherwise reading the two stored pin elevations, and `endpointHeightM` /
    `endpointAngleDeg` in `@core/terrain/los` are shared by it and by `analyzeSightline` itself, so
    the expression that existed three times now exists once. A `Scene.aimKnown` flag makes
    `ensureMeshWindow` return rather than cut a window for a placeholder, and a narrow
    `pinGroundM|pin2GroundM|profileKey` subscription bumps the controller when the ground lands.
    `finder.ts` keeps its sea-level default by passing it in.

    **The two panels followed** in `cf76192`. `FramePanel` and `NightPanel` rebuilt the aim from the
    profile alone and so read `+0.00°` for the ~1 s before it landed; both now call the shared
    resolver. Frame keeps the bearing, which never needed terrain, and says `…` for the angle alone
    — the GeodeticsPanel spelling, not a third one. Degrading the whole aim instead, the way the
    panels do when there is no target pin, was tried and rejected: it turns the readouts into editable
    inputs showing 0/0 while "Aim at the target location" is checked, and throws away an azimuth that
    is already correct. Cold, Frame now reads `234.80° SW` / `…` at 0.44 s and the true `+18.35°` at
    1.20 s, against `+0.00°` held to ~1.95 s before. Night has no natural place for a `…` — its
    declination feeds three sentences with the number embedded — so it keeps `aimFor`'s placeholder
    and simply gets the true angle at 1.05 s instead of 2.00 s.

    **Two things the panel work turned up, both recorded rather than fixed.**

    `startTerrainSync()` runs at module scope in `main.tsx:42` and fires the first `Elevation` request
    against whatever `worldStore` holds, while the URL's `camera`/`target` are applied in a
    `useEffect` inside `ViewfinderPage` (`routes/viewfinder.tsx:24-33`) after first render. So the
    first elevation answer of every load is for the pre-URL pin and is thrown away. Harmless today —
    with empty storage there is no `pin2`, so `pin2GroundM` lands null and the resolver correctly
    declines — but it is one wasted round trip on the critical path of exactly the cold load 21 and 22
    are about.

    `targetAngleFor` checks `profileKey` before trusting the profile but never checks `elevationKey`
    before trusting the two grounds, so on a re-target it briefly pairs the old pins' ground with the
    new pins' distance. **Deliberately left.** Guarding it would blank the angle — and, through
    `aimKnown`, freeze the mesh window — on every target drag, whereas the stale ground is wrong by
    only as much as the ground moved, almost always far inside the 0.25° pitch quantum, so it costs no
    rebuild. It is the placeholder 0 that was worth refusing, not an approximation that converges.
    Cold loads are unaffected either way: `elevationKey` is empty then and the grounds are null.

    **Verified over a matrix**, not the single setting the fix was found at, by recording every
    mesh-key transition from first paint rather than sampling the end state: 24/200/600/1200/2400 mm,
    both orientations, midday / dawn / night, and three sites chosen for the sign of the answer —
    Zermatt→Matterhorn at +18.3°, Hoboken→the Edge at −0.07°, and Gornergrat→Zermatt at −17.0°. In
    all ten cases there is **exactly one committed window and its pitch is already right** (+18.25 to
    +19.14 where the grid rounds it, 0 at the level site, −17.23 looking down). The profile landed at
    200–640 ms, i.e. after the 250 ms mesh debounce in nine of the ten, so nine of them would have
    committed pitch 0 before the fix.

23. **Quiet budget re-measured** (2026-09-25) — `scripts/smoke/idle.sh`, 44 cases, 30 s idle each
    after a 45 s settle, headless Brave at 1400×900 DPR 2. Scrub cases now start from a pinned
    instant (Rotterdam day, 2026-06-21 13:00 Z), so they sweep the same sky every run. Results:

    - 43/44 cases pass first time.
    - Renderer ≤ 0.5 % in every map case and ≤ 0.2 % in every untouched viewfinder case. GPU ≤ 0.2 %.
    - Hidden and pinned-time cases do nothing at all: 0 rAF, 0 timers, 0 fetches.
    - The live clock costs 1–4 GL frames per 30 s (one repaint a minute), which is within budget.

    One case is still over 2 %: **viewfinder after zoom** (1.9–2.8 % over four runs). A trace puts
    about 0.5 s of the 0.76 s it spends in V8 GC (background marking and a memory-reducing major
    GC) cleaning up after the zoom's mesh rebuild. Main-thread JS is 0.1 s. The one GL frame is
    the minute tick, not the zoom. **Open**: to cut this, the viewfinder mesh rebuild has to
    allocate less.

    **Baseline, time pinned** (2026-09-26, after strip re-stamps) — a minute tick landing a
    low-sun mask re-stamp failed cases at random, so every visible case is pinned at local noon
    (hidden cases stay live). One **live-tick** case (Rotterdam map, clock shifted to
    2026-06-21 19:00 Z, tick a quarter into the window) runs the real tick; its own budget allows
    one re-stamp: +8 s renderer CPU, ≤ 80 fetches. Two full passes, 45 cases, GPU lock per case:
    - 44/45 pass both times; renderer ≤ 0.3 % in every other case but one hidden viewfinder at
      1.0 %, GPU ≤ 0.1 %, 0 GL frames and 0 fetches wherever time is pinned.
    - Live tick: 1 re-stamp, 5.9 s CPU (19.7 % renderer), 65 fetches, 3 GL frames (3 runs before
      the passes: 4.6–6.2 s, 53–65 fetches).
    - Still over: viewfinder after zoom, 3.0 and 3.1 % (the open GC item above).

    **Note:** viewfinder rebuild reuses buffers, released after long idle; viewfinder fills a
    maximized window (user, 2026-09-25).
    **Note:** viewfinder fills the available space; the sensor frame is marked by a border (user, 2026-09-25).

    **Fixed:** the map's shadow mask re-stamped terrain and buildings (about 0.5 s of worker time)
    on roughly every third live-clock minute, because the moving sun changed the shape of the padded
    rect. It now keeps the current grid while that grid still covers the pad (`rectCovers`), so on a
    still map each tick only recomputes the shadows (4–14 ms).

    **Harness:** V8's post-load memory reducer runs GCs for about 45 s (up to 54 % renderer in the
    first 10 s). The old 20 s settle measured that instead of the app, so a cold phone case read
    18.9 %. The settle is now 45 s.

**Answered by the user**

19. **Variable zoom apertures — only the two ends** (2026-09-23, `97a55fe`). No per-focal database,
    so no interpolation: `maxAperture` (f/5.6) only at the short end, `maxApertureLong` (f/6.3) at any
    longer focal. Zooming in raises the f-number; zooming back never opens it. Gear persist v4
    re-derives the long value from the lens name for v0–v3 blobs.
20. **Hiding the Sun hides its glow too** — kept as shipped (2026-09-23), same `uSun.w > 0.0` branch.
21. **Alpenglow forecast source — Open-Meteo, not Windy** (2026-09-25). Open-Meteo approved, CC BY 4.0
    credit shown; Windy's API declined. No other new data source.
    Placement Weather tab, low-Sun limit shared with golden hour, sea of clouds a bonus badge (user, 2026-09-25).
    Alpenglow follows the target, else the pin; badge at ≥50 % low cloud, no fog (user, 2026-09-25).
