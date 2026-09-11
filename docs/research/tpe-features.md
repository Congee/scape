# The Photographer's Ephemeris (TPE) — Web App v4 Feature Inventory

Compiled from public help-center articles (photoephemeris.com/en/help/tpe-web/*), three news posts, and the standalone FOV tool page. Uncertain / not explicitly stated items are marked (?). Where the help center itself declines to publish a detail (e.g. exact tier pricing), that is noted rather than guessed.

Sources used: help articles — welcome-to-tpe-web, navigating-the-home-page, getting-started-with-tpe-web, customizing-the-map-display-in-tpe-web, using-the-tpe-web-timeline-and-altitude-chart, using-the-library-in-tpe-web, creating-and-setting-up-your-tpe-web-account, choosing-and-purchasing-a-tpe-web-subscription, managing-your-tpe-web-subscription, finding-and-saving-locations-in-tpe-web, setting-up-your-photo-gear, using-3d, how-to-explore-the-night-sky-with-celestial-targets, checking-graphics-compatibility, locations-is-now-named-library, 3d-buildings-availability, troubleshooting-search-results-in-tpe-web, terrain-vs-photorealistic-in-fpv-mode, using-viewshed-and-horizon-profile, using-the-shot-alignment-tool (20 of 20 articles in the TPE Web v4 help category); news posts — "TPE Web 4.0 Launches Today" (Jul 2 2026), "Say Hello to the TPE Web v4 Preview" (May 2 2026), "Photorealistic 3D Tiles in TPE Web" (Sep 9 2026); tools/fov page.

---

## 1. Version / Release Timeline

- May 2, 2026 — public preview of v4 launched in parallel with production v3 (separate URL, next.photoephemeris.com), feedback via forum.photoephemeris.com.
- Jul 2, 2026 — TPE Web 4.0 officially launched (full public release).
- Aug 21, 2026 — Photorealistic 3D shipped as a point release, "TPE Web 4.5" (per a referenced YouTube video title and the 3D-tiles post).
- Sep 9, 2026 — "Photorealistic 3D Tiles in TPE Web" post recaps the Aug 21 feature.
- v4's stated core change vs v3: full UI redesign + "swapped out the core mapping library for a more modern alternative" (name of new library not stated (?)).

---

## 2. UI Layout

- **Left-hand sidebar** (collapsible via a control at its lower-right corner): navigation between app pages (Map, 3D, Library/Locations, Celestial Targets, etc.) plus account/subscription access. Replaces v3's top nav bar.
- **Map** (center): primary canvas. Shows the pin(s), sun/moon direction lines, shadow lines, and whichever overlays/layers are enabled.
  - Top-left: Date/Event controls (calendar dropdown ±10 years, prev/next-day buttons, "Now" button, typeable date field) and Data Badges showing lat/long, time zone, and elevation of the primary pin.
  - Top-right: Map Control Buttons (e.g. enable secondary pin/geodetics).
  - Bottom: Scale, Map Zoom, and Attribution controls.
- **Timeline** (v4 change: moved from below the map in v3 into the **right-hand sidebar**). Lists the day's sun/moon/twilight events in sequence, each with time + azimuth.
- **Altitude chart**: sits at the bottom of the screen (below/near the map), separate from the Timeline list. Plots Sun (orange) and Moon (blue) altitude/elevation-angle vs. time-of-day; click-drag to scrub, live legend shows azimuth + altitude for the dragged time.
- **Right-hand sidebar**: tabbed tool panels — Map panel (map type/layers/style), Bodies and Targets panel (which bodies/targets appear on Timeline/chart/map lines), FOV panel, Shot Alignment / Visibility panel, etc. Top icon row = panel tabs; bottom has modal-launching buttons plus a collapse/expand toggle.
- **Pins**:
  - **Primary (red) pin** — "the location for which the displayed data is calculated"; freely draggable; all sun/moon/timeline/altitude data derives from its position; TPE auto-resolves time zone/DST for wherever it's placed.
  - **Secondary (gray) pin** — optional, enabled via a Map Control Button; used for geodetics (point-to-point sightline) calculations; also auto-placed by the Shot Alignment tool onto a chosen landmark.
- **Sun/Moon direction lines on the map** (color coding, from getting-started/timeline articles):
  - Sunrise azimuth line — **yellow**.
  - Sunset azimuth line — **orange**.
  - Moonrise azimuth line — **light blue**.
  - Moonset azimuth line — **dark blue**.
  - Thinner "live" azimuth lines for the Sun/Moon position at the *currently scrubbed* time (distinct from the fixed daily-event lines above) — colored to match the altitude-chart series (Sun = orange, Moon = blue); these rotate live as you drag the altitude chart. (Minor inconsistency across two source pages on exact thin-line color vs thick-line color scheme — noted, not resolved.)
  - **Sun shadow line** — dark/brown line overlaid on the sun azimuth extension line; shortens as the sun climbs higher; length is a relative visual guide only (not a measured distance).
  - **Moon shadow line** — dark blue.
  - **Sun azimuth extension line** — thin line through the pin showing the direction sunlight travels (opposite the forward azimuth), used to reason about what's lit.
  - Technical cap: shadow/azimuth lines are capped at **200 miles** length.
  - No stated dedicated Milky Way direction *line* color on the 2D map (Milky Way appears as a 3D-page feature — see §11) (?).
  - No legend/key overlay is described for these lines beyond the live azimuth/altitude readout in the altitude-chart legend.

---

## 3. Map & Pins — Geodetics / Sightlines

- Secondary (gray) pin's entire purpose is to enable **geodetics**: a point-to-point sightline between primary and secondary pin.
- Confirmed to exist and be referenced repeatedly (Library controls only show "Set secondary pin to this location" when geodetics is enabled; Shot Alignment auto-enables geodetics and drops the secondary pin on the landmark).
- The actual computed outputs (distance, bearing/azimuth, elevation angle, units) are **not detailed in the fetched v4 help pages** — the v4 docs link out to a legacy v3 article ("geodetics-and-sightlines") and to "Understanding Azimuth, Altitude, Elevation, and Other TPE Terms" for this detail, which was not part of the v4 category and wasn't fetched. **(?) Mark as: geodetics/sightline distance-bearing-elevation computation exists, but exact mechanics/units are unconfirmed from v4-specific docs.**
- Shot Alignment's own doc recommends cross-checking a candidate alignment against "the geodetics sightline chart," implying the sightline has its own chart/inspector UI (not just a map line) (?) — detail not confirmed.
- Term definitions that *are* confirmed (from the Timeline article, general TPE terminology):
  - **Azimuth** — compass bearing measured clockwise from true north (0°=N, 90°=E, 180°=S, 270°=W).
  - **Altitude / elevation angle** — angle of a body above the horizon, signed (+/–) to distinguish from azimuth values.
  - **Transit / culmination** — moment Sun or Moon crosses the local meridian, typically also its highest altitude.

---

## 4. Map Overlays & Layer Choices

- Opened via the **Map panel** (Map button in right-sidebar toolbar): Map type, Map type options, Map layers, Map style.
- **Map type**: "Default Maps" (TPE's own, various styles, some free/some gated) vs **Google Maps** (Road map, Satellite, Hybrid, Terrain — requires PRO or MAX). Some layers only work with Default Maps, not Google Maps.
- **Map layers** (add data over the base map; availability depends on subscription tier *and* chosen map type):
  - **Hillshade** — simulates light/shadow across terrain to emphasize ridges/valleys.
  - **Light Pollution** — relative artificial night-sky brightness, for comparing dark-sky vs. bright areas.
  - **3D Buildings Layer** — building footprint outlines over the map; no shadow-casting; useful for checking when the sun/moon clears a building's footprint; not available with Google Maps as the base; free on **all tiers** (Free/Supporter/PRO/MAX).
  - **Elevation** and **Aspect** map overlays — free tier and up (per 4.0 launch post).
  - **Dynamic Hillshade Layer** — free tier and up.
  - **Dynamic shadows/hillshading** (real-time, vs. static hillshade) — **PRO+**.
  - **Slope maps** — **PRO+**.
  - **Solar irradiance overlay** (dynamic) — **MAX only**.
  - **Target Visibility maps** — shows where a target (e.g. the Moon) is visible from, accounting for topography + a user-configurable altitude offset — **MAX only**.
  - Page text notes "other available layers provide additional information about terrain, sunlight, shadows, and visibility" without itemizing further (?).
- **Map style** (cosmetic only, no new data): Normal, Grayscale, Desaturated, Contrast boost, Invert grayscale, Invert desaturated, Lightened. Grayscale specifically called out as making TPE's colored sun/moon/sightline lines easier to read against the base map. "Available map styles are subject to change."
- **Milky Way position/visualization** as a map-overlay-level feature — free tier and up; higher-resolution Milky Way/star rendering reserved for paid tiers (see §12/§13).

---

## 5. Timeline & Day/Twilight Events

- Lives in the right-hand sidebar; lists the day's events in order, each with time + azimuth.
- Example event sequence walked through in docs: moonrise → astronomical twilight (start) → nautical twilight (start) → civil twilight (start) → sunrise → golden hour → moon transit → sun transit → (evening sequence mirrors, not explicitly enumerated in source).
- **Twilight definitions** (exact, sun-below-horizon angle bands):
  - Astronomical twilight: Sun 12°–18° below horizon.
  - Nautical twilight: Sun 6°–12° below horizon.
  - Civil twilight: Sun 0°–6° below horizon.
- **Golden hour**: from sunrise until the Sun reaches +6° altitude (and, in the evening, from +6° down to sunset).
- **"Blue hour" is explicitly called a myth/informal term** by TPE's own docs — not a discrete computed event; actual twilight duration varies by season/latitude.
- **Transit/culmination**: moment Sun or Moon crosses the local meridian, usually its highest altitude of the day.
- Twilight events carry an **azimuth** too ("the brightest point on the horizon"), not just a time — Timeline shows twilight azimuth alongside start/end time.
- Moonrise/moonset event entries show: time, azimuth, **moon phase**, and **illumination %**; extra info appears at New/Full Moon (unspecified what).
- Not every day has a moonrise or moonset event (moon rise/set times drift ~50 min/day and can skip a calendar day).
- Clicking a Timeline event jumps the altitude chart's selected time to that event (and shows the event's title in the chart legend when they match exactly).
- Small-screen behavior: scroll within the Timeline panel if not all events fit.

---

## 6. Altitude Chart / Sun-Moon Info Panel

- Plots **Sun (orange)** and **Moon (blue)** altitude/elevation angle across the selected day.
- Interaction: click in the chart, then drag left/right to change the time of day; legend updates live with azimuth + altitude (signed, e.g. "+32°") for both bodies.
- Keyboard: after clicking into the chart, **left/right arrow keys move time in 10-second increments** — the one explicit keyboard shortcut documented for time-scrubbing.
- Chart position is linked to the map: thick map lines = fixed daily sunrise/sunset/moonrise/moonset azimuths; thin map lines = live Sun/Moon azimuth at the chart's current scrub position, rotating as you drag.
- No explicit mention of a dedicated "Milky Way info panel" separate from the Bodies and Targets panel and 3D-page Milky Way settings — Milky Way appears to be handled as a selectable "body/target" rather than having its own info-panel section (?).
- Moon phase/illumination % is shown in the Timeline's moonrise/moonset event boxes, not confirmed as a separate chart series (?).

---

## 7. Date Navigation

- Three methods, all in the Date/Event control cluster (top-left of map): (1) click the date selector and pick from a calendar widget (±10 years range mentioned in one article); (2) type a date directly into the text field and press Enter; (3) prev/next-day buttons for single-day stepping; a "Now" button jumps to the computer's current date/time in the primary pin's time zone.
- App explicitly supports navigating both backward and forward from any date.
- No mention of date deep-linking via URL in the fetched pages (though the Shot Alignment article's example URLs contain query parameters like `vshd=mode:...`, implying at least some app state, e.g. viewshed mode, is URL-encodable) (?) — explicit date-in-URL support not confirmed.

---

## 8. Keyboard Shortcuts (all explicitly documented instances found)

- **C** — move/center the red (primary) pin to the current map center.
- **Shift-C** — center the map on the red (primary) pin.
- **Left/Right arrow keys** (after clicking into the altitude chart) — step the time of day in 10-second increments.
- **Arrow/cursor keys** (in 3D First-Person View mode, after clicking into the scene) — walk the camera around to fine-tune position.
- No other keyboard shortcuts (e.g. for date stepping, search focus, panel toggling) are documented in the fetched articles (?).

---

## 9. Search / Geocoding

- Search box opened via a search button above the map.
- Supported input types: place names, street addresses, postal/ZIP codes (explicitly noted that numeric postal codes can also match places in Poland/Italy, not just the US), and **GPS coordinates in Decimal Degrees (DD) only** — Degrees-Minutes-Seconds (DMS) is explicitly **not** supported.
- **what3words** three-word addresses supported — **requires Supporter/PRO/MAX** (gated).
- Entering coordinates also reverse-geocodes to surface a nearby named place.
- **Autocomplete-as-you-type**: PRO/MAX subscribers see live suggestions while typing; other tiers must press Enter/click Search to see results. Autocomplete suggestions can differ from clicking "Search" (autocomplete = best-guess matching; Search = exact/specific matches).
- Results are influenced by device region/language settings and prioritize places near the user by default; results can vary by platform.
- Underlying geocoding data source: **OpenStreetMap**, explicitly cited as the reason result sets can shift over time (OSM data changes).
- Documented troubleshooting tips: search broad-to-specific; try name variants (plural/singular, upper/lower); use full addresses not fragments; search a nearby well-known place instead of an obscure one; try alternate keyword combos; double-check spelling; as a last resort, enter decimal-degree coordinates directly and save + rename the point manually.
- Result actions: click "Go" (or a red-pin icon on a result) to move the primary pin there; click a Save icon to send the result straight into the Library.
- Disambiguation: may need to add county/state/country to a place name (e.g. "there's Paris, and there's Paris, Texas").

---

## 10. Saving Locations, Library & Sharing

- The **Locations** page was renamed **Library** in v4 "to reflect the broader range of data that can now be saved."
- Library holds three item types:
  - **Locations** — saved places (position, map zoom level, elevation and time zone stored as reference data, title + optional notes).
  - **Shot Plans** — a full planning setup: location, date, time, and settings such as field of view and photo gear.
  - **Visual Searches** — a saved set of search conditions (e.g. "when can I see a full moon above the Matterhorn?") that can be re-run against a new date.
- Views/filters: All items, Locations, Shot Plans, Visual Searches, Upcoming Shot Plans, Favorites; each has its own search field (distinct from the main map search — this one searches saved title/notes text).
- **Favorites**: heart-icon toggle on any item; aggregated Favorites view; favorites explicitly sync bidirectionally with TPE for iOS.
- **Lists**: user-created folders that can mix all three item types; an item can belong to multiple Lists; List has name, optional description, color, and icon; drag-and-drop reordering of items within a List (via a left-side handle) and of Lists themselves.
- **Multi-select / bulk operations**: bulk add-to-List, bulk remove-from-List, bulk delete; "bulk archive documents to the new `.tpe` format" (per the rename announcement).
- **Import formats**: KML, KMZ, GPX, GeoJSON, PlanIt (`.pft`), and native `.tpe`; Shot Plans specifically can also import PhotoPills `.kmz` files. Drag-and-drop or file-picker upload, one file at a time; imported batch is auto-filtered/timestamped for review.
- **Export formats**: KMZ (interoperable with Google Earth) and native `.tpe` (documented, typed JSON w/ published JSON Schema, for scripting/external tools). Export respects the currently active filter (filter first to export a subset).
- **Sync**: auto-syncs to the server "every few minutes while the Library is open," plus on entering/leaving the page; manual Sync button turns blue when local pending changes exist; conflict rule is **last-change-wins** — recommended habit is "edit, then sync" before switching devices.
- **Sharing**: no public share-link / permalink-to-a-saved-view feature is described anywhere in the fetched docs (?) — sharing appears to be limited to file export/import (KMZ/GeoJSON/etc.) rather than a live shareable URL.
- Recommends discretion when sharing location data (links to naturefirst.org principles).
- No documented numeric caps on saved Locations/Shot Plans/Visual Searches/Lists count by tier in the help docs (?) — likely shown only in the in-app upgrade/comparison screen.

---

## 11. 3D View — Orbit & First-Person View (FPV)

- 3D page has exactly two modes, toggled top-right: **Orbit** and **First-Person View (FPV)**.
- **Orbit mode** (free, all tiers): outside/overview view of terrain around the primary pin, "rather like an old-fashioned armillary sphere or orrery." Controls: click-drag to rotate; two-finger drag or mouse wheel to zoom; Cmd+drag to pan. Shows sunlight/moonlight effects as time changes; Free/Supporter get hill-shading only, **PRO/MAX add true cast shadows** for Sun and Moon.
- **FPV mode** (requires PRO/MAX): places a virtual camera at the primary pin at a set height above ground level; drag to look around, arrow/cursor keys to walk (after clicking into the scene for focus). If the FOV panel is active, the view is field-of-view-aware to the configured camera/lens (a field-of-view-aware virtual viewfinder).
- **3D Settings panel** (gear icon, bottom-left): Body Size (×1/×2/×4/×8 — Sun/Moon marker + line thickness), Worklight toggle (forces full daylight regardless of simulated time, for inspecting a night map), 3D Terrain Quality (low/med/high — mesh density; highest levels PRO/MAX only), Milky Way Resolution (higher = sharper, most useful in FPV at long focal lengths — up to a claimed sharp rendering at 600mm with high-res tiles), Milky Way Markers (symbolic spheres marking the Milky Way band, mainly useful in Orbit mode), Viewing Distance (how much terrain loads around the pin — larger = lower resolution).
- Sunlight/moonlight simulation accounts for distant/off-screen terrain, Earth curvature, and atmospheric refraction (example given: sunlight can linger on a prominent summit like Mt. Shasta after the sea-level sunset time, due to horizon-dip effects).
- **3D Buildings** rendering tiers (from the dedicated 3D-buildings article):
  - Maps-page 3D Buildings Layer (footprints only, no shadows): free on all tiers.
  - 3D-page **Standard Buildings** (OSM-derived, opaque 3D objects with lighting/shadow casting, fused/simplified geometry, limited metadata): **PRO+**.
  - 3D-page **Enhanced Buildings** (OSM + Overture Maps–referenced enhancement data; decomposed into individual building parts; extra metadata; material/specular rendering for some buildings): **MAX only**.
  - Explicit disclaimer: neither Standard nor Enhanced buildings are high-fidelity models — both are "schematic approximations" trading per-building detail for broad coverage.
- **Photorealistic mode** (MAX only, FPV only): see §11a below.

### 11a. Photorealistic 3D Tiles (MAX only)

- Technology: **Google Photorealistic 3D Tiles**, explicitly named, built from Google's DEM + digital surface data, high-res satellite imagery, and photogrammetry — renders precise building geometry down to individual trees/shrubs.
- Fuses terrain + buildings + vegetation into a single mesh with photographic textures.
- Key limitation: lighting is "baked in" at the imagery's capture time, so it **cannot be accurately re-lit/re-simulated** for a different time of day — TPE's own Terrain mode is recommended instead whenever accurate sun/moon lighting simulation matters.
- Best suited for: precision alignment against buildings/complex structures, confirming line-of-sight isn't blocked by vegetation, "assess exact shooting options... before you even travel to location."
- Coverage: "available for locations all around the globe, with more being added over time" — i.e. global but incomplete/expanding, not uniform (?) exact coverage boundaries not stated. Example cities named: Denver, Rio de Janeiro (Christ the Redeemer), London (the Shard), plus Delicate Arch/Arches National Park.
- Subject to Google's "reasonable use limits" — docs warn against repeatedly reloading the page to avoid hitting rate limits.
- Rendering/UX behavior differs from Terrain mode: Terrain mode keeps ground and building geometry separate (walking passes through buildings at constant height above ground); Photorealistic mode is one unified mesh (walking goes *over* buildings/trees — no walk-through). This can shift FPV camera height unexpectedly (e.g. pin dropped on a tree canopy); TPE has a local "ground detection" warning for this, and recommends zooming out to visually check your footing.
- Photorealistic-mode quality slider: Performance / Balanced (default) / High — trades bandwidth/rendering cost vs. detail.
- **Flatten Foreground** slider (Photorealistic only): flattens surrounding terrain rendering to see past mesh artifacts or decluttered foreground vegetation; deliberately **not persisted** across sessions, so users don't mistake a flattened view for confirmation of a genuinely clear sightline.
- Released initially Aug 21, 2026 as part of "TPE Web 4.5."
- No performance/hardware requirement is explicitly stated for Photorealistic mode specifically (?), though the general graphics-compatibility article lists the 3D page overall as a hardware-demanding feature.

---

## 12. Visual Search / Celestial Sphere

- **"Visual Search"** is the name of TPE's existing tool for the "**forward**" problem: fix a camera position/composition, then search for **when** a celestial target aligns with it (also called "position search" in the shot-alignment doc). It is the counterpart to the newer Shot Alignment tool (§14), which solves the reverse problem.
- The fetched docs do **not** describe an immersive/AR-style "celestial sphere" or sky-dome visualization by that name — no page in the TPE Web v4 help category details Visual Search's own UI mechanics in depth; it's only described contextually against Shot Alignment (?).
- Tier gating (from the Photorealistic 3D news post): **Visual Search is available to all users, but limited to the Sun for free accounts** — paid tiers presumably unlock Moon and other celestial targets within Visual Search (exact per-tier breakdown of which targets unlock at Supporter vs PRO vs MAX not stated) (?).
- A Visual Search can be saved to the Library as its own item type (§10) and re-run later against a new date; a Shot Plan's circumstances can also be converted into a new Visual Search (e.g. take a captured "Full Moon at 90° azimuth / 2.5° altitude" moment and search for the next time it recurs).

---

## 13. Celestial Target Planning

- **Celestial Targets page**: curated target lists for astrophotography/nightscape/deepscape planning, plus a lookup tool to search for any celestial target of interest. Supports viewing one or multiple targets at once, each with an **Info** view and a **Calendar** view (annual + monthly visibility).
- Named starter/curated lists: "Celestial Landmarks" (pole markers, bright orientation stars, Southern Cross pointers, Galactic Center anchor, Magellanic Clouds), "Northern Hemisphere Beginner Targets," "Southern Hemisphere Beginner Targets."
- Target info shown: common names, catalog IDs, coordinate data, and more (summary in list view, full detail on click).
- **Favorites**: heart-icon toggle, saved to account, dedicated favorites collection on the home page, **capped at 100 favorite targets per account**.
- Selectable target types generally (confirmed via Shot Alignment doc, which shares target selection with Celestial Targets/Visual Search): **Sun, Moon, Planet, Galactic Center, DSO (deep-sky object, e.g. M42/Orion Nebula), Star**.
- Tier gating (from 4.0 launch post): Free/Supporter get the basic Celestial Landmarks list + visibility calendars. **PRO** adds all 7 planets (Mercury–Neptune) with opposition/elongation events, full lookup of any star/galaxy/DSO with local visibility times, and multiple additional curated target lists. **MAX** adds "Celestial Target Position Windows" — specify an azimuth/altitude *window* a target must pass through, aimed at deepscape planning (aligning a DSO with a foreground landmark) but usable for astrophotography with constrained sky access too.

---

## 14. Shot Alignment Tool (MAX-tier flagship feature)

- Solves the "**reverse**" alignment problem: you know the foreground landmark and the celestial target you want in the same frame, but not where to stand — contrasted explicitly with Visual Search, which solves the "forward" problem (fixed position, find the time).
- Shares its sidebar panel with a separate "Visibility" tool (shows where a body is visible above terrain at a given time, hatch-shaded where line-of-sight is blocked) since both use the same inputs.
- **Workflow**: (1) select a celestial target (Sun, Moon, Planet, Galactic Center, DSO, Star, etc.) from the loaded Bodies/Targets; (2) optionally set an azimuth/altitude offset (e.g., place the Moon above-and-left of the landmark); (3) tune settings — output updates in real time; (4) output is a **color heatmap overlaid on the map** of camera positions that would achieve the alignment, **line-of-sight aware** (occluded points excluded); (5) click the heatmap to inspect a candidate (shows a timeline/tolerance inspector), then "Select alignment" to commit.
- **Inputs/settings**: Camera Height Above Ground Level (default ~5 ft, independent of the pin's normal AGL setting); Angular Tolerance (degrees of allowed misalignment — e.g. 0.25° for tight compositions, 2–3° for large/loose targets); Time Window (± minutes around the selected date/time); Maximum Distance from the map pin the heatmap renders (max **184 miles**; smaller = higher sightline resolution); Samples (more samples = less banding on large heatmaps, at a performance cost); Opacity of the heatmap.
- **Two modes**: **Align Mode** — heatmap shows where the alignment is achievable within tolerance; **Time Mode** — heatmap color-codes *when in the time window* the alignment occurs (yellow = in-tolerance/good, blue = earlier, red = later, white = transition near the central selected time) — aimed at fast-changing-light scenarios (e.g. moonrise near sunset).
- Selecting an alignment: (1) moves the primary pin to the alignment position; (2) auto-enables geodetics and drops the secondary pin on the original landmark; (3) sets the date/time to the alignment instant; (4) heatmap thereafter draws relative to the secondary (gray) pin.
- Explicit safety disclaimer: "use the heatmap as a planning guide only — indicated areas may not be safe, legal, or practical to access." Recommends cross-checking with the geodetics sightline chart.
- Example use cases cited: Diamond Mt. Fuji at sunset in January; full moonrise behind Mt. Lick Observatory; Orion Nebula deepscape with Factory Butte, Utah.
- Called "perhaps the single most powerful addition in TPE Web 4.0" in the launch post; emphasized for real-time responsiveness ("drag and drop the map pin, or adjust the time, and everything updates" in milliseconds, no long-running computation wait).

---

## 15. Viewshed & Horizon Profile Tools (MAX-tier)

- **Viewshed**: the full area of terrain visible from an observation point (term borrowed from "watershed"); can contain visibility "islands" cut off by intervening terrain. Rendered as a map overlay (colored visible/occluded shading). Positioned as a quick way to check whether a location has line-of-sight to a landmark/valley without committing to one exact point-to-point sightline (contrast with Geodetics + secondary pin, which is single-point-to-point). Can be combined with the Field-of-View overlay to see exactly what would be framed.
- **Horizon Profile**: the set of points marking the visibility limit around an observer in all directions — a simplified subset of the full viewshed (easier to read, less information). **Downloadable as GeoJSON or KML** (e.g. for Google Earth) — a capability not offered for the full viewshed. Useful for checking whether a celestial target clears the terrain horizon, and can be combined with the celestial visibility calendar to find, e.g., which nights of the year a target sets behind a specific ridge.
- Both tools are described as "extremely quick to use and update," enabling assessment of several candidate locations within a couple of minutes.
- Inputs: not fully itemized in the docs (no explicit "observer height" or "radius" field named) (?); example scenario URLs show a DEM (digital elevation model) selector and an opacity parameter, implying the underlying computation is DEM-based and configurable, but the full input UI isn't documented.
- Gating: MAX-only per the 4.0 launch post ("Viewshed and Horizon Profile tools ... MAX" tier); the standalone viewshed/horizon help article itself doesn't restate the tier restriction explicitly.

---

## 16. Field of View (FOV) & Photo Gear

- **Photo Gear setup**: users add camera bodies and lenses to their account profile for use in FOV calculations/visualizations. Backed by an internal camera/lens knowledge base; if a model isn't found, a "Search the Web" fallback looks up specs automatically (reviewed/editable before saving). Mount-adapter compatibility is not modeled — any lens can be paired with any camera regardless of real-world mount fit. Multi-sensor devices (phones, drones) must be added as two separate parts (a "camera" + a "lens" entry). **Number of cameras/lenses you can save depends on subscription tier** (exact free-tier cap not stated in these docs (?); PRO gets "additional camera and lens allowance" per the launch post).
- **In-app FOV visualization**: once gear is configured, field of view is shown directly on the map (drawn using "geometrically correct great circles," explicitly to avoid misleading straight lines at high latitude/long distance) and in the right-hand sidebar as detailed FOV data. A **field-of-view-aware 3D Virtual Viewfinder** (FPV mode tied to the configured lens) is a **PRO+** feature.
- **Standalone FOV Tool** (https://photoephemeris.com/en/tools/fov): described as "our free Field of View Tool" — a separate, presumably no-login marketing/utility page. Computes a **3D visualization of field-of-view coverage** for a given camera/lens combo, accounting for sensor/film format, showing coverage range by azimuth and altitude, and accounting for camera orientation and pitch angle. (The interactive calculator itself is client-side/JS-rendered; specific input fields — e.g. sensor picker, focal length entry, aspect ratio — and exact numeric outputs, e.g. H/V/diagonal FOV in degrees, are not present in the static page content and thus unconfirmed (?).)

---

## 17. Account, Login & Offline Behavior

- Account is **optional** — TPE Web is usable without signing in, though an account is recommended to "access more tools and save your locations" (a de facto anonymous/guest mode, not labeled as such explicitly).
- Signup: short form, appears to be **email + password only** — no social login (Google/Apple/Facebook) mentioned anywhere in the docs (?). Requires email verification via a confirmation link before continuing to use the site.
- Sign-in: email + password; "Forgot password?" reset flow available.
- **Platform support**: designed for desktop/laptop, also usable on tablets; on phones you can sign up or reset a password but **cannot access the web app itself** (explicit lockout).
- **Cookies are mandatory** — the docs state the site "will not function correctly if cookies are disabled ... or you are using a private browser window, ad blocker, or content blocker."
- Account page: change name, change password, change registered email (re-verification required), delete account (blocked while a paid subscription is active — must cancel first). Changing the account email does not propagate to the marketing mailing-list address or the Paddle billing email (three separate email records).
- Supported UI languages (as of doc publish date): English, German, Spanish, French, Italian, Korean, Polish.
- **Offline behavior: not supported.** No PWA install, offline mode, service-worker caching, or local-only mode is mentioned anywhere in the fetched docs — the only "no install" language found is that "TPE Web runs in your web browser, so there is nothing additional to download or install," framed purely as a convenience, not offline capability. Combined with the mandatory-cookies requirement and the explicit "cannot access on mobile phones" note, TPE Web reads as strictly online/desktop-browser-only. **(?) — absence of evidence, not a found "no offline mode" statement per se, but no offline features are described anywhere across ~20 articles.**

---

## 18. Subscription Tiers — Free vs. Paid

**Important caveat from the help docs themselves**: TPE explicitly does **not** publish an exact feature-matrix or price list on the website/help center. Quote: "Select the UPGRADE badge in TPE Web to view the current comparison of Free, Supporter, PRO, and MAX. The subscription screen shows which features and limits are included with each level," and prices aren't listed externally because they vary by "currency, billing location, and applicable taxes." The tier breakdown below is reconstructed from incidental gating statements scattered across help articles and the 4.0 launch news post — treat as the best available reconstruction, not an official published matrix.

- **Four tiers**: **Free**, **Supporter**, **PRO**, **MAX** (badges shown as SUP/PRO/MAX next to account name).
- Tier taglines (verbatim): Free = "core tools you need to begin using TPE Web and planning your outdoor photography"; Supporter = "a simple way to support continued development ... with a few useful extras included as our thanks"; PRO = "advanced Sun, Moon, Milky Way, terrain, map, and weather planning for photographers who need more precision and flexibility"; MAX = "discover better photo opportunities in less time ... evaluate more viewpoints, compositions and celestial alignments in minutes instead of hours."

**Free / Supporter (baseline, largely overlapping):**
- Core map, timeline, altitude chart, date navigation, search (without autocomplete-as-you-type on Free), coordinate/address/postal-code search.
- 3D Buildings Layer (map layer, footprints only), Elevation & Aspect map overlays, Dynamic Hillshade layer, Map Styling options (grayscale/desaturated/invert/etc.).
- Camera & Lens gear management + map-based FOV visualization.
- 3D page **Orbit mode** with hill-shading light effect (no true shadows, no buildings rendered in 3D).
- Milky Way position/visualization (map-level).
- Celestial Landmarks target list + basic visibility calendars.
- Visual Search — usable, but **limited to the Sun** as a target.
- Standalone FOV tool (fully free, no login implied).
- Supporter adds "a few useful extras" over Free — specific extras not itemized (?); what3words search format requires at least Supporter.

**PRO adds:**
- Search autocomplete-as-you-type.
- Google Maps as an alternate base map type (Road/Satellite/Hybrid/Terrain).
- Dynamic (real-time) shadows and hillshading; slope map overlay.
- All 7 planets (Mercury–Neptune) as targets, with opposition/elongation events; full lookup of any star/galaxy/DSO with local visibility times; multiple additional curated celestial target lists.
- 8k-resolution Milky Way/stars in the 3D page.
- FOV-aware 3D Virtual Viewfinder (FPV mode) with true Sun/Moon shadows in 3D.
- 3D page **Standard Buildings** (OSM-derived, opaque with shadows).
- Additional camera/lens gear allowance (implies Free/Supporter has a cap).
- Higher 3D Terrain Quality settings.

**MAX adds (top tier):**
- Dynamic solar irradiance map overlay.
- **Viewshed and Horizon Profile tools.**
- **Target Visibility maps** (topography-aware visibility of a target, with altitude offset).
- **Shot Alignment tool** (the reverse-alignment heatmap feature).
- High-resolution **tiled** Milky Way/stars ("sharp up to 600mm focal length").
- **Celestial Target Position Windows** (azimuth/altitude window constraint for deepscape planning).
- 3D page **Enhanced Buildings** (richer building metadata/materials) and **Photorealistic mode** (Google Photorealistic 3D Tiles).
- Migration note: existing PRO subscribers got complimentary MAX-feature access for a ~2-week grace window after the 4.0 launch (July 2–16, 2026) before presumably needing to upgrade to keep those features.

**Billing mechanics** (from managing-subscription docs):
- Monthly and/or annual billing, depending on tier (not all combinations guaranteed); annual said to offer "significant savings."
- Payment processed by **Paddle** (merchant of record) — TPE only sees card type, last 4 digits, and expiry.
- Auto-renews unless canceled; canceling retains paid access until the end of the current billing period (no stated refund).
- **Pause/resume** supported for monthly plans only (not annual) — useful for seasonal users; a subscription left paused >9 months may be auto-canceled as dormant.
- Changing plans applies immediately (charges any prorated amount right away) and **drops any active discount code** — recommendation is not to change plans mid-discount.
- Order-history/invoices available via an emailed link on request.

---

## 19. Data Sources Cited

- **Base map geocoding/search**: **OpenStreetMap** — explicitly named as the source underlying place search results (and cited as the reason result sets can shift over time).
- **Alternate base map**: **Google Maps** (Road, Satellite, Hybrid, Terrain styles) — PRO/MAX only; offered alongside TPE's own "Default Maps" (no separate tile vendor named for TPE's own default map styles) (?).
- **3D building geometry**:
  - Standard Buildings — **OpenStreetMap**-derived.
  - Enhanced Buildings — OSM **"enhanced with other data sources,"** referencing **Overture Maps'** published Buildings Guide as the closest documented analogue/enhancement source (not stated as the literal data pipeline, just cited as a reference) (?).
- **Photorealistic 3D**: **Google Photorealistic 3D Tiles** — explicitly named, combining Google's digital elevation + digital surface models, high-resolution satellite imagery, and photogrammetry (multi-photo-derived 3D reconstruction), covering terrain, buildings, and vegetation in one mesh.
- **Elevation/terrain (Hillshade, Elevation/Aspect/Slope overlays, viewshed/horizon, "Terrain mode" 3D)**: implied to be **some DEM (digital elevation model)**, but no specific DEM provider (e.g. SRTM, USGS 3DEP, ASTER) is named anywhere in the fetched docs (?). Example scenario URLs reference a `dem:` parameter (e.g. `dem:matterhorn`) suggesting multiple selectable DEM datasets exist, but the provider(s) behind them are not identified.
- **Payments**: **Paddle** (Paddle.com) is the merchant of record / payment processor for subscriptions.
- **Core map rendering engine**: v4 "swapped out the core mapping library for a more modern alternative" — vendor/library name **not disclosed** in any fetched source (?).

---

## 20. UX Patterns Worth Copying

- **Drag the primary pin directly on the map** to relocate it — every computed value (times, azimuths, chart, timeline) updates live as you drag; no separate "confirm" step.
- **Click-and-drag on the altitude chart** to scrub time of day, with a live legend (azimuth + altitude, signed °) following the drag — then **arrow keys for fine 10-second-increment nudges** once the chart has focus. This two-tier interaction (coarse drag, then fine keyboard nudge) is a nice pattern for any time-based scrubber.
- **Click a Timeline event to jump straight to that moment** — turns a passive event list into a set of one-click "time bookmarks."
- **Two-tier map lines**: thick/solid lines for the day's fixed events (sunrise/sunset/moonrise/moonset azimuth), thin lines that rotate live with the scrub position — lets a user see "today's plan" and "right now" simultaneously on the same map without separate toggles.
- **Color-linked chart-to-map legend**: Sun always orange, Moon always blue, consistently across the altitude chart, the live azimuth lines, and (separately colored) shadow lines — a single consistent color code reduces the need for a separate legend widget.
- **One-click search-result actions**: a red-pin icon on a search result moves the primary pin there; a separate Save icon sends it straight to the Library — two distinct affordances per row instead of a single "select" step, avoiding a save/discard modal.
- **Reverse-search "Shot Alignment" heatmap**: instead of manually iterating candidate spots, the user sets tolerance/time-window/max-distance and gets a live-updating occlusion-aware heatmap of viable positions, clickable to drill into per-point timing — reframes a normally trial-and-error planning task (stand somewhere, check alignment, repeat) as a single continuous-parameter search.
- **Time Mode heatmap color language** (yellow = in-tolerance "now," blue = earlier in window, red = later, white = transition) — encodes a third dimension (time) into a 2D map via color without needing an animation/scrubber.
- **Selecting a computed result auto-configures the rest of the tool**: choosing a Shot Alignment heatmap point simultaneously moves the pin, drops a secondary pin on the original landmark, enables geodetics, and sets the date/time to match — one click configures four dependent pieces of state instead of asking the user to do it manually.
- **Deliberately non-persistent "cheat" controls**: the Photorealistic-3D "Flatten Foreground" slider intentionally resets each session so a user can't mistake a temporarily flattened view for a genuinely confirmed clear sightline — a good pattern for any "temporarily simplify the view to inspect something" control that could otherwise create false confidence.
- **Graceful gear lookup fallback**: type any camera/lens name; if it's in the internal knowledge base, auto-fill specs; if not, trigger an automatic web search to find + propose specs for user confirmation, rather than forcing manual spec entry.
- **Great-circle-correct FOV rendering**: field-of-view cones/lines on the map are drawn using true great circles rather than naive straight lines, explicitly to stay accurate at high latitudes/long distances — a subtle correctness detail worth replicating for any bearing/FOV line drawn on a web map projection.
- **Export respects active filters**: exporting from the Library exports whatever the current filtered view shows, so users can export a subset just by filtering first rather than needing a separate multi-select-and-export flow.
- **Collapsible left nav + right sidebar**, both independently toggleable, to reclaim map space on small/short (16:9 laptop) screens — cited as a deliberate v4 redesign goal.

---

## 21. Notable Gaps / Unconfirmed Items (?)

- Exact geodetics/sightline computation details (distance units, bearing convention, elevation-angle output, any inspector chart) — referenced but not spelled out in v4-specific docs; v4 pages defer to older v3 articles not fetched here.
- Exact input fields and numeric outputs of the standalone FOV tool page (client-side widget not present in static HTML).
- Exact per-tier numeric caps (e.g. free-tier camera/lens gear count, free-tier saved-Location/List limits, exact "Supporter extras" beyond what3words search).
- Official published price list (deliberately not published outside the app).
- Whether Visual Search's non-Sun-target gating differs between Supporter/PRO/MAX specifically, or is a single Free-vs-paid cutoff.
- Exact DEM/elevation provider(s) and TPE's own default-map tile vendor (name withheld/not stated).
- Whether Photorealistic 3D has specific browser/GPU/WebGL version requirements (graphics-compatibility article only points to an in-app diagnostics tool, no numeric specs given).
- Whether any date/view state is shareable via URL beyond the observed viewshed-mode query parameters seen in example doc URLs.
