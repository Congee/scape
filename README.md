# Scape

Plan outdoor photography around sunlight, moonlight and the Milky Way. Scape combines the map and
timeline clarity of The Photographer's Ephemeris with the feature depth of PlanIt! Pro, runs
entirely in the browser, and works offline once installed as a PWA.

Status: Phase 5. Core map, timeline, altitude chart, search, settings, library and PWA shell
(Phase 1); terrain: elevation badge, target location with a line-of-sight profile, 360° terrain
horizon with rise/set behind terrain, hillshade and 3D terrain (Phase 2); composition: gear and
field-of-view cone, depth of field and panorama, markers with KML/GPX/GeoJSON import and export,
plans, and a viewfinder that renders the terrain from the camera location (Phase 3); night: star
field, constellations and the Milky Way in the viewfinder, Milky Way core windows, star-trail
exposure rules, meteor showers, polar alignment and a night-lights map layer (Phase 4); finders:
sun, moon and Milky Way search over a date range, saved searches, and shot-alignment, visibility
and viewshed heat layers on the map (Phase 5).
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
src/lib/core      pure TypeScript, unit-tested: astronomy (events, star frames, Milky Way windows, meteor showers, Polaris, the finder search), geodesy (incl. heat grids and landmark solids), optics (FOV, DoF, projection, star-trail rules), terrain (DEM decode, sightline, horizon and view sweeps), alignment and visibility grids, points I/O, time zones
src/lib/data      basemap catalogue, PMTiles protocol, Terrarium tile cache, geocoder, IndexedDB, camera and lens catalogue
public/sky        bundled star catalogue, constellation lines and Milky Way texture (see public/sky/README.md for sources and licences)
src/lib/state     Zustand stores: world (camera and target locations, clock, tz), settings, composition, gear, markers, plans, searches, day data, terrain, finder and alignment (worker-fed), sky data, library
src/lib/ui        React components plus the framework-free Map, Chart, Profile and Viewfinder controllers
src/lib/workers   ephemeris worker, terrain worker (elevation, profile, horizon, viewfinder wedge, marker ground), finder worker, alignment worker (heat grids)
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

The Frame tab holds the gear: search the bundled catalogue of cameras and lenses to pick your body
(sensor size and pixel count) and lens (focal range and widest aperture), or choose a sensor format
by hand; with a lens selected the focal length stays inside its range and the aperture list starts at
its maximum. Then focal length, aperture and orientation. The field of view is drawn on the map as a cone from the camera
location; drag its tip to aim and set its length, drag its edge to change the focal length, or tick
"Aim at the target location". Depth of field (near, far, hyperfocal) and a panorama frame count come
from the same numbers; the DoF limits are arcs across the cone and the panorama is a dashed outline.

Markers are landmarks (peaks, buildings, trees…) with height, width, rating and notes. Add them by
Alt-clicking the map or from the Markers tab, import KML, GPX or GeoJSON, and export the same. A
marker can also be a solid (box with depth and rotation, cylinder, or spire) that the viewfinder draws
as a flat-shaded prism at its exact angular size, so a moon or sun disc can be placed against it.

The viewfinder (camera icon in the rail) renders what the lens sees from the camera location: the
map's 3D terrain (the current basemap draped over the elevation model) seen from eye height through
the frame's field of view, under a skyline swept from the DEM at the frame's resolution; the sky for
the simulated time; the sun, moon and Galactic Centre with their day paths and hour marks (dimmed
where a body is behind the skyline); the target; and markers. The 3D ground appears as soon as the
page opens and follows the camera and target as they move on the map; the "3D" chip swaps it for
shaded terrain layers when tiles are unavailable. Drag to aim, scroll to zoom, double-click to centre a point; the compass and
altitude rulers run along the frame edges; with a target location set, the left ruler reads heights
above sea level at the target's distance and a strip above the frame gives the sun, moon and Galactic
Centre positions and the moon phase. Esc returns to the map. Entering the viewfinder, or placing or
moving the target location, re-aims the frame at it; dragging the frame or the cone tip releases that
lock, and the "Aim at target" chip shows and restores it.

## Night

Once the sun is far enough down the viewfinder shows the sky: 8,920 stars to magnitude 6.5 with
colour and the brightest names, constellation figures, the celestial pole, and NASA's Milky Way map
projected through the same camera model, all hidden behind the terrain skyline where it stands in
the way and faded by moonlight. Star trails over a chosen span and the radiants of the active meteor
showers are optional layers.

The Night tab lists the Milky Way core windows for the day (dark sky, core above a minimum altitude
or the terrain skyline, moon down or thin, all adjustable), the 500 and NPF shutter rules for the
current gear and aim, meteor showers active on the date with their radiant position and the next
maxima, and where Polaris sits around the pole for polar alignment. The core windows also appear as
a violet band on the altitude chart. The Layers tab can overlay NASA's VIIRS night-lights image as a
light-pollution proxy.

Sky data sources and licences are listed in `public/sky/README.md` (HYG database, CC BY-SA 4.0;
d3-celestial, BSD-3-Clause; NASA SVS Deep Star Maps, public domain).

## Find

The Find tab answers "when is the sun, moon or Galactic Centre inside this window?": choose the body,
an azimuth and altitude window (typed, taken from the direction to the target location with a
tolerance, or from the frame's field of view), a start date and duration, and filters for the sky
(daylight, golden or blue hour, twilight stages), moon illumination (with full-moon and dark-sky
presets), moon below the horizon and weekdays; the window may also require the body to be above the
terrain skyline. The search runs in a worker with exact rise/set-style crossing searches, streams
results as it goes, and lists every pass with its best moment; clicking one sets the time. Results
export as CSV and a search can be saved (with or without its camera location) to the Library, which
also puts saved searches in the backup file.

The same tab drives the heat layers on the map. Align shows, around the target location, the camera
positions from which the chosen body stands behind the target (within a tolerance, at some moment of
the time window, with the sightline checked against the terrain); Time colours those positions by
whether the moment comes before or after the set time. Clicking a cell shows the candidate's numbers
and "Move camera here" moves the camera location and the clock to it. Visible marks where the body
is above the terrain at the set moment, and Viewshed marks the ground the camera location can see.
Elevation data is about 30 m, so confirm the framing in the viewfinder.

A plan (Library or "Save plan" in the Frame tab) stores camera, target, moment and composition. The
Library also exports and imports everything as one `.scape.json` file.
