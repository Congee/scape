# Scape

Plan outdoor photography around sunlight, moonlight and the Milky Way. Scape combines the map and
timeline clarity of The Photographer's Ephemeris with the feature depth of PlanIt! Pro, runs
entirely in the browser, and works offline once installed as a PWA.

Status: Phase 2. Core map, timeline, altitude chart, search, settings, library and PWA shell
(Phase 1), plus terrain: elevation badge, target location with a line-of-sight profile, 360° terrain
horizon with rise/set behind terrain, hillshade and 3D terrain (Phase 2).
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
src/lib/core      pure TypeScript, unit-tested: astronomy, geodesy, terrain (DEM decode, sightline, horizon sweep), time zones
src/lib/data      basemap catalogue, PMTiles protocol, Terrarium tile cache, geocoder, IndexedDB
src/lib/state     Zustand stores: world (camera and target locations, clock, tz), settings, day data and terrain (worker-fed), library
src/lib/ui        React components plus the framework-free Map, Chart and Profile controllers
src/lib/workers   ephemeris worker, terrain worker (elevation, profile, horizon)
src/routes        TanStack file routes: / (map), /library, /settings
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
