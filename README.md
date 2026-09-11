# Scape

Plan outdoor photography around sunlight, moonlight and the Milky Way. Scape combines the map and
timeline clarity of The Photographer's Ephemeris with the feature depth of PlanIt! Pro, runs
entirely in the browser, and works offline once installed as a PWA.

Status: Phase 1 (core map, timeline, altitude chart, search, settings, library, PWA shell).
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
src/lib/core      pure TypeScript, unit-tested: astronomy, geodesy, time zones, formatting
src/lib/data      basemap catalogue, PMTiles protocol, geocoder, IndexedDB
src/lib/state     Zustand stores: world (pin, clock, tz), settings, day data (worker-fed), library
src/lib/ui        React components plus the framework-free MapController and ChartController
src/lib/workers   ephemeris worker
src/routes        TanStack file routes: / (map), /library, /settings
```

Sharing a view: the map URL carries `lat`, `lng`, `z`, `t` (ISO instant) and `tz` (only when
overridden), so any state can be bookmarked or pasted.
