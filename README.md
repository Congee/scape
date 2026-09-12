# Scape

Plan outdoor photography around sunlight, moonlight and the Milky Way. Scape combines the map and
timeline clarity of The Photographer's Ephemeris with the feature depth of PlanIt! Pro, runs
entirely in the browser, and works offline once installed as a PWA.

Status: Phase 3. Core map, timeline, altitude chart, search, settings, library and PWA shell
(Phase 1); terrain: elevation badge, target location with a line-of-sight profile, 360° terrain
horizon with rise/set behind terrain, hillshade and 3D terrain (Phase 2); composition: gear and
field-of-view cone, depth of field and panorama, markers with KML/GPX/GeoJSON import and export,
plans, and a viewfinder that renders the terrain from the camera location (Phase 3).
See `PLAN.md` for the roadmap and `docs/research/` for the competitive inventories.

## Run

```sh
bun install
bun run dev                 # http://127.0.0.1:5173, hot reload
bun run build && bun run preview   # production build with the service worker, for offline dogfooding
```

Other scripts: `bun run check` (tsc), `bun run lint` (oxlint), `bun run test` (vitest).

## Stack

React 19 + React Compiler on Vite 8, TanStack Router, Zustand, MapLibre GL JS (deck.gl only where a
feature needs it), PMTiles, astronomy-engine, IndexedDB via `idb`, Workbox via `vite-plugin-pwa`.

## Layout

```
src/lib/core      pure TypeScript, unit-tested: astronomy, geodesy, optics (FOV, DoF, projection), terrain (DEM decode, sightline, horizon and view sweeps), points I/O, time zones
src/lib/data      basemap catalogue, PMTiles protocol, Terrarium tile cache, geocoder, IndexedDB
src/lib/state     Zustand stores: world (camera and target locations, clock, tz), settings, composition, gear, markers, plans, day data and terrain (worker-fed), library
src/lib/ui        React components plus the framework-free Map, Chart, Profile and Viewfinder controllers
src/lib/workers   ephemeris worker, terrain worker (elevation, profile, horizon, viewfinder wedge, marker ground)
src/routes        TanStack file routes: / (map), /viewfinder, /library, /settings
```

Sharing a view: the map URL carries `lat`, `lng`, `z`, `lat2`/`lng2` (target location), `t` (ISO
instant) and `tz` (only when overridden), so any state can be bookmarked or pasted.

## Terrain

Elevation comes from the public Terrarium tiles (Mapzen, AWS Open Data), fetched per tile in a
worker and cached by the browser and the service worker. Shift-click the map (or use the Geodetics
tab) to drop the target location; the line turns green, yellow or red for a clear, marginal or blocked
sightline. The terrain horizon is swept around the camera location out to 50–200 km; rise and set behind the
skyline appear as extra timeline events and the skyline is drawn on the altitude chart along the
sun's path (filled) and the moon's path (dashed). Everything terrain-related can be switched off in
Settings.

## Composition

The Frame tab holds the gear: a sensor format (built-in list plus your own sizes from Settings), focal
length, aperture and orientation. The field of view is drawn on the map as a cone from the camera
location; drag its tip to aim and set its length, drag its edge to change the focal length, or tick
"Aim at the target location". Depth of field (near, far, hyperfocal) and a panorama frame count come
from the same numbers; the DoF limits are arcs across the cone and the panorama is a dashed outline.

Markers are landmarks (peaks, buildings, trees…) with height, width, rating and notes. Add them by
Alt-clicking the map or from the Markers tab, import KML, GPX or GeoJSON, and export the same.

The viewfinder (camera icon in the rail) renders what the lens sees: terrain layers swept from the
DEM at the frame's resolution and shaded by distance, the sky for the simulated time, the sun, moon
and Galactic Centre with their day paths and hour marks (dimmed where a body is behind the skyline),
the target, and markers. Drag to aim, scroll to zoom, double-click to centre a point; the compass and
altitude rulers run along the frame edges.

A plan (Library or "Save plan" in the Frame tab) stores camera, target, moment and composition. The
Library also exports and imports everything as one `.scape.json` file.
