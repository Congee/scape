# PlanIt! Pro — Consolidated Feature Inventory (from 10 User Guides)

Source: planitphoto.com PDF user guides 01–10. Compiled for a team building a competing web app.

---

## 1. Plan (base concept, map tools, files, elevation)

### Features
- Search box: geocode/locate by decimal degrees, DMS, D° M', sexagesimal with N/S/E/W, Plus Code / Open Location Code, Maidenhead Locator, MGRS, K Code (China only), or place name (any language, e.g. CJK).
- "Selected location": a single location (via long-press map, tap POI, tap marker, or tap camera/scene pin) that acts as the reference target for the Plan button and Quick Zoom even when camera/scene pins aren't set; tapping empty map deselects; map center is the fallback.
- Plan = 4 parts: camera location, scene location, date/time, composition (focal length + azimuth + elevation angle).
- 5 map "tools" (horizontal switcher): Location, Distance & View, Composition, Depth of Field, Panorama.
- Location tool: shows selected point's GPS coords (format-switchable, shareable as text) + on-demand elevation.
- Distance & View tool: distance, azimuth (bearing), and elevation gain between camera and scene pins; unit toggle (US/metric); line-of-sight color coding along the terrain profile — green = scene visible from camera, yellow = nearly blocked, red = blocked.
- Composition tool: shows/edits camera azimuth, focal length, orientation; draggable thick green lines on the map define/adjust the FOV cone directly (drag to change azimuth or focal length).
- Extended (thin, non-draggable) FOV lines project the same field of view ~500 km (310 mi) out when the camera pin scrolls off-screen, so users can check/mark distant background terrain.
- Quick Zoom Control: a spring-loaded slider (resets to center on release) for zoom; auto-zoom button either zooms to the selected location (circle icon) or fits both camera+scene pins (three-lines icon) when nothing is selected.
- Camera/Scene pins: drag to move (long-press to "lift"), snap to a marker's exact position on drop; rendered upside-down by default (toggle in settings) so the dragging finger doesn't occlude the map.
- Depth-of-Field tool: inputs aperture, focal length, focus distance; visualizes hyperfocal distance (gray line), focus distance (bright green line), and near/far DoF limits (dark green lines).
- Panorama tool: inputs total angle of view, focal length, orientation, shot overlap %; outputs number of shots and rotation angle between shots; visualizes each shot's FOV and the overlap zones on the map.
- Save/open Plan as a file; optional share-on-save; share existing plan files via OS share sheet or long-press/swipe in the Plans list; files also importable via a fixed device folder path (PFT/) as a fallback.
- Elevation: online via Google Elevation API by default (manual "tap to fetch" due to a 2,000-query/day quota); offline via user-supplied SRTM `.hgt` tiles (1°×1° tiles, ~90 m/3-arcsec resolution recommended; 1″ and 15″ resolutions unsupported), sourced from viewfinderpanoramas.org or USGS (US only), placed in a device folder; app shows a red-shaded overlay on the map marking areas with offline elevation coverage.
- Offline elevation unlocks: 3D terrain rendering in the viewfinder, instant (no-tap) elevation/elevation-gain values, instant line-of-sight coloring, instant Light-and-Shadow results, ground-contour markers, and fully offline operation.

### Formulas & Data
- Distance/azimuth/elevation-gain computed between any two lat/lon(+elevation) points.
- Line-of-sight visibility = terrain elevation profile sampled between camera and scene, compared against the straight sight line (drives green/yellow/red).
- FOV cone/rectangle geometry derived from focal length (crop/sensor factor established elsewhere in composition state); reference FOV reach ≈ 500 km.
- Depth of field from standard aperture/focal-length/focus-distance hyperfocal relationship (not spelled out numerically in the guide).
- Panorama shot count and per-shot rotation angle derived from total angle of view, per-shot FOV, and requested overlap %.
- Elevation source is swappable: Google Elevation API (quota-limited, online) vs. offline SRTM HGT tiles.

### UX Notes
- "Selected location" as a decoupled reference target (independent of camera/scene pins) is a clean, reusable abstraction.
- Color-coded line-of-sight (green/yellow/red) is an efficient at-a-glance terrain-visibility signal, worth reusing anywhere occlusion matters.
- Spring-back zoom slider plus context-sensitive auto-zoom icon (circle vs. three-lines) is a distinctive but learnable non-standard control.
- Draggable FOV lines directly on the map (vs. only numeric fields) is a good direct-manipulation pattern.
- Upside-down pins to avoid finger occlusion during drag is a deliberate touch-UI trick worth considering.
- The 2,000/day elevation-API quota forced an on-demand "tap to fetch" UX and a whole offline-data-file workflow — a web app should pick an elevation data source without a low daily cap (or self-host tiles) to avoid this complexity entirely.
- Local-file-based save/share/open (with a fixed folder convention) is a mobile-era pattern; a web app should replace it with account-based cloud storage and shareable links, not files.

---

## 2. Markers

### Features
- Marker = a point + metadata: name, category/type icon, 6-level rating, free-text note, optional width/height (for structures), viewfinder display mode (icon+name / name only / hidden).
- Add: from a selected location, or bulk-import placemarks from KML/KMZ (Google Earth/MyMaps); v1 import ignores tracks/paths (points only).
- Select/deselect by tap; multi-select by tapping additional markers (selected markers render filled/solid).
- Edit: rename, set category/rating/note, share location, delete — one marker editable at a time.
- Copy/paste: copy one marker's attributes, paste onto another marker, or onto all currently-selected markers at once — a batch-edit shortcut.
- "Select All" selects every marker currently visible in the map viewport (viewport-scoped, not global).
- Save selected markers only, or save all visible markers, to a marker file; load previously saved marker files.
- Marker detail panel: coordinates (format-switchable, shareable), distance/azimuth/elevation-gain to the camera location (only if camera is set), name (with an in-app Google search shortcut to find building height/info), category, viewfinder display flags, rating, note.
- Categories (6 groups, ~35 icons): General; Terrain (mountain/peak, volcano — both enable an "elevation profile"/ground-contour option; rock/arch; coast/seascape; water body; waterfall; snow; hot spring/geyser); Travel (overlook, scenic point, parking, trailhead, hiking, store, restaurant, café, gas, water supply, hotel, camping, restroom, sign, off-road, airport — excluded from viewfinder rendering); Building (skyscraper, big building, historical building, sculpture/statue, house, village, factory, bridge, tower, lighthouse, windmill); Nature (forest, conifer/deciduous tree, wildflowers, crop field, bird of prey, other birds, carnivore, herbivore, fish, insects); Number (custom numbered markers).
- "Show Ground Contour" per-marker flag renders that marker's terrain outline in the viewfinder (mountain/peak/volcano categories enable this by default).
- Height/width entry for man-made structures, plus a "height above sea level" flag to disambiguate structure height from a water-point's elevation (see below).
- Placement tips baked into the guide: for angled satellite imagery, place two assistant markers at the base's edge centers to derive the true base center; prefer the road-map layer (not satellite) to place markers precisely on man-made features (e.g., a bridge tower base), since road data must be accurate for turn-by-turn GPS.
- Save/share/import marker files, same file + folder-convention model as Plan files (viewport-scoped save).

### Formulas & Data
- Shares the Plan module's search/geocoding and distance/azimuth/elevation-gain calculations.
- Elevation for underwater points comes back as ocean-floor depth (negative), not sea level — the "height above sea level" flag on a marker is needed to tell the app a given height/elevation value should instead be interpreted relative to sea level (worked example: Golden Gate Bridge tower).
- KML/KMZ import supported (Google Earth/MyMaps interchange format); marker files are a separate proprietary shareable file format.

### UX Notes
- A ready-made ~35-icon taxonomy across 5 groups, mapped to real photographic subjects, is a good starting point for a marker category/icon set.
- Copy-attributes-to-all-selected is a clever low-effort batch-edit pattern.
- Viewport-scoped "select all"/"save visible" avoids needing folders/tags for casual use, but doesn't scale — the guide itself flags "search by rating" as a future gap. A web app should have first-class marker search/filter (category, rating, text, distance) from day one, not rely on map-viewport scoping.
- The sea-level-vs-ocean-floor elevation ambiguity is a real, non-obvious correctness issue — worth handling explicitly in the data model (store a raw elevation value plus an explicit reference-datum flag) rather than leaving it as a manual user checkbox.

---

## 3. Date, Time, Events, Calendar

### Features
- Date/Time bar: shows current (simulated) time; tap to set it to now; long-press to lock it; tap opens Events, long-press opens Calendar; swipe for prev/next event; shows any event within a 5-minute window of current time (can show several at once).
- Date/Time slider, 5 modes: Year, Month, Day (shows moon phase), Hour (shows a day/night color band + celestial elevation angles), Minute (adds seconds — only mode that does). Tap either end of the slider to jump the scale up/down a level; drag to scrub. While scrubbing, live sun/moon/star/Milky-Way-center curves appear and auto-hide after a few idle seconds.
- Time-zone indicator with 3 confidence colors: white = network-verified, yellow = inferred from location (possibly near a border, use with caution), red = rare, guessed purely from longitude (no network). Setting to show the offset only when it differs from the phone's own time zone.
- Drawer menu: save current plan/markers, change map type, jump to Ephemeris/Event/Calendar (also directly reachable without the drawer).
- Events list: cards colored by time-of-day (same palette as the Hour slider); moon info is shown alongside sun-related events only at full moon, but always shown for Milky-Way events (moon light matters a lot there); shows time-delta from the app's current (simulated) time, not device system time; a green border/tint intensity signals closeness to current time; prev-day/now/next-day buttons appear while scrolling; checkbox multi-select to copy/share event text.
- Calendar (long-press the Event button): month grid flags new/full/quarter moon, meteor-shower peak dates, perigee/apogee, solstice/equinox; per-night star rating (for star-trail/deep-sky work — target 2–3 stars) and a green-dot rating (for Milky Way nights).
- Ephemeris Pager: 18 swipeable pages, color-grouped by theme — orange = Sun & Moon, purple = Night photography, green = Special interests, blue = Meteorology & Oceanography; 18 small rounded-rect page indicators (tap to jump); swipe-down page chooser grid, organized by the same colors, for direct navigation.
- Ephemeris value text-color convention (used across all pages): white = calculated, tappable for an explanatory hint; green = a time value within 5 minutes of current time; grey = calculated and read-only (no hint on tap); light blue = an editable input value. Long-press any date/time value to set it as the app's current date/time; long-press an azimuth/elevation value (marked with dedicated icons) to set it as the target camera azimuth/elevation.
- Azimuth defined as compass bearing (angle from north to the vertical circle through the object); Elevation/altitude angle defined as signed angular height above the horizon (always shown with +/− and a ° suffix, with a distinct icon from azimuth).
- Icon system: sun/moon/Milky-Way-center icons recolor for above/below horizon and (moon) phase; meteor-shower icon variants keyed to Zenithal Hourly Rate bands (≥50 / ≥10 / <10); star icon size keyed to magnitude bands (<1 … <6).

### Formulas & Data
- Time zone resolved primarily from network+location; falls back to a longitude-only estimate when offline (explicitly flagged unreliable).
- The app maintains its own simulated "current time," independent of the device clock — all countdowns/highlighting are relative to this simulated time.
- Twilight/golden/blue-hour categorization (detailed in guide 5) is driven by sun elevation-angle thresholds, surfaced here via the Hour/Minute slider's day-night color band.
- Calendar highlights are derived astronomical events: new/full/quarter moon, perigee/apogee, solstice/equinox, meteor-shower peaks (sourced from an internal ephemeris/meteor-shower dataset).

### UX Notes
- A pervasive, consistent color language (sun=orange, moon=blue, night-photo=purple, special=green, meteorology=blue) is a strong, learnable system — though note blue is reused for both "moon" and "meteorology/oceanography," a minor collision worth avoiding in a redesign.
- The white/green/grey/light-blue text-color convention for calculated vs. live vs. read-only vs. editable values is an elegant, information-dense micro-UX pattern, directly portable to a web UI via a small set of semantic color tokens.
- Explicitly separating "app's simulated current time" from the device's real clock (with a lock affordance and a "green means live" icon) is important for a planning tool that constantly scrubs through arbitrary dates — must stay visually unambiguous.
- 18 flat swipeable pages is a lot of linear surface area; the color-coded jump grid mitigates it, but a web app has room (sidebar/tabs/search) to avoid this constraint altogether.
- A confidence-coded (white/yellow/red) indicator for any geo-derived-but-uncertain value (here, time zone) is a good general trust-signaling pattern.

---

## 4. Viewfinders

### Features
- 4 selectable viewfinder modes (vertical switcher): Streetview, Viewfinder (Picture), Viewfinder (AR), Viewfinder (VR).
- Shared overlay content across modes (subset varies by mode): scene location as a red dot, markers (icon and/or name and/or a rectangle sized by height/width), the scene's ground contour (if a marker's "Show Ground Contour" is on), and celestial/sky content driven by whichever Ephemeris page is currently active; sky color reacts to sun/moon elevation only on "live" pages, not on date/time-search pages.
- Viewfinder VR: fully synthetic 3D render, no photo/camera needed; drag vertical scale to set elevation angle, horizontal scale to set azimuth; optional device-orientation-sensor toggle to slew the view by physically rotating the phone. Positioned as the most accurate mode; requires the most setup (must add markers to build the scene); least visually realistic.
- Viewfinder AR: live camera feed with overlays; depends on the phone's orientation sensor (same class as a compass), which can be thrown off by nearby magnetic fields — recommends a figure-8 phone motion to recalibrate; explicitly caveated as rough-estimate only (never for precise alignment or safety-critical direction-finding); zero setup, must be on-site.
- Viewfinder Picture: loads a static photo (captured in-app on location, or an existing photo) as background. Requires 5 known parameters — location, focal length, azimuth, elevation angle (+ implicit orientation) — before overlays align. Workflow: auto-read GPS/focal length from EXIF when available; manually tune focal length/azimuth/elevation by comparing the rendered marker/ground-contour overlay against real photo features until they align; a red/white indicator flags whether the picture's calibration is confirmed/saved. Once solved, becomes a reusable, precisely-calibrated vantage point for repeated planning (sun/moon finder, star trails, Milky Way, moon-sequence/time-lapse — all previewed against the real photo).
- Streetview: uses Google Street View imagery as the background; shows sun+moon only (no stars/Milky Way — dataset judged too heavy for this view); coverage limited to roads/urban areas; more reliable than AR but less accurate than VR or a solved Picture setup.

### Formulas & Data
- Camera FOV cone/rectangle is derived from focal length (and sensor/crop factor established in the Plan/Composition tool); this same overlay is drawn in every viewfinder mode and on the map.
- Picture-mode calibration is essentially a manual 3-parameter camera-pose solve (focal length, azimuth, elevation angle) fit by eye against known marker/ground-contour ground truth — no automatic solver described.
- AR-mode accuracy is bounded by the phone's magnetometer/orientation sensor, explicitly called out as unreliable near magnetic interference.
- Ground-contour rendering relies on the same elevation/terrain data as the Plan module (including the sea-level-vs-ocean-floor caveat noted under Markers).

### UX Notes
- Presenting 4 fidelity/effort tradeoffs side by side (VR / AR / Picture / Streetview), each with an honest pros/cons callout in the docs themselves, is a good pattern rather than picking one "best" renderer.
- The Picture-mode "manually solve until the overlay matches, then save" workflow converts a one-time calibration effort into a durable, reusable asset — a good model: separate "raw photo" from "calibrated viewpoint," and let the calibration be saved/reused independently.
- Being explicit in-product about AR's unreliability (compass drift, do not use for critical navigation) is a good trust-building disclosure to copy.
- A visible confirmed/unconfirmed state indicator (red vs. white) for whether a calibration is saved prevents users from planning against stale/unverified setups.

---

## 5. Sun and Moon

### Features
- Rise & Set page: sunrise/sunset/moonrise/moonset times and azimuths for the current day; color-coded (sun = orange shades, moon = blue shades; lighter = rise, darker = set); handles moonrise/moonset landing on an adjacent calendar day via a "+1"/"1−" superscript; left position is always rise, right is always set.
- Perpetual-day/perpetual-night detection and display for polar latitudes (no sunrise or no sunset that day).
- Twilight page: civil / nautical / astronomical twilight start and end times, shown for both dawn and dusk, each defined by a sun elevation-angle threshold; sun's azimuth at each twilight moment is drawn on the map with transparency increasing as the sun goes further below the horizon.
- Named "special hours," each defined as a sun-elevation band: Golden hour = 0° to 6°; Blue hour = −4° to −8° (actual visible window shifts earlier/later depending on which direction relative to the sun you're looking); Night = below −18°.
- Sun/Moon Position page: live sun+moon elevation and azimuth; moon phase name and illumination %; a transparent icon marks a body below the horizon; scrubbing the time slider shows elevation "distance rings" (polar-style) so the icon's distance from center encodes elevation angle; toggle to show/hide the full sun/moon path arc; long-press an icon to re-center the viewfinder on that body.
- Sun/Moon Finder: searches a date range for every date/time the sun or moon (optionally restricted to a specific moon phase) falls within a target azimuth range × elevation-angle range. Target area can be typed numerically or dragged directly as a rectangle in the viewfinder (drag the whole box, or its 4 corners to resize). A degenerate case (elevation = 0°, any azimuth) yields a plain rise-time list, annotated with the sun's actual possible azimuth "fan" for that year.
- Finder results: shows total-result count vs. filtered-result count simultaneously; a filter panel narrows the list further; long-press clears all filters at once; prev/next navigation always shows both the pre- and post-filter index so list position is never lost.

### Formulas & Data
- Underlying ephemeris engine computes sun/moon rise/set/azimuth/elevation/phase/illumination for arbitrary date + location (specific algorithm not named in the guide text).
- Golden hour: sun elevation 0°–6°. Blue hour: sun elevation −4° to −8° (direction-dependent duration). Night: sun elevation < −18°. (Civil/nautical/astronomical twilight bands are referenced but their exact degree thresholds aren't restated numerically in the captured text.)
- Azimuth/elevation defined as in section 3 (compass bearing from north; signed angular height above horizon).
- The Finder is essentially an inverse-ephemeris range query: "list all times where (azimuth, elevation) of body X falls in region R, over date range D, optionally filtered by moon phase."

### UX Notes
- Turning fuzzy photography folklore (golden/blue hour) into precise, checkable sun-elevation bands is worth replicating exactly — and could be made user-adjustable.
- Offering both a numeric target-entry form and a live drag-a-rectangle-in-the-viewfinder input for the same search covers both power users and visually-oriented ones.
- Always showing "N total / M filtered" plus a stable original index during filtering avoids a common list-filtering UX failure (losing your place in the full list).
- Compact "+1"/"1−" superscripts for date-boundary-crossing events is a clean, low-noise convention.
- The polar elevation-ring overlay while scrubbing is an efficient way to convey an angle spatially instead of only as a number.

---

## 6. Night Photography

### Features
- Star/planet/constellation/nebula finder: shows positions at any time/location; filterable by object type and by an azimuth/elevation window (e.g., stay within 20°–70° elevation while excluding the light-polluted east side).
- Star-trail time picker: recommends a start/end window when the sky is dark enough, gated by moonrise/moonset (tolerance configurable in settings, e.g. allow a crescent moon); shows duration and a "star-trail swiping angle"; a viewfinder preview simulates the actual trail arcs so foreground alignment (e.g., aligning Polaris with a specific landmark) can be checked before shooting; a highlighted "visible period" bar for a selected star is cut short once the moon rises.
- Three selectable star-trail-avoidance exposure rules: 500 Rule (standard: max shutter ≈ 500 / effective focal length); 600 Rule (looser, recommended for slower apertures, e.g. slower than f/4); CoC Rule (the app's own invented rule, computing star movement against the sensor's circle of confusion; the strictest of the three; recommended for fast/prime lenses, e.g. faster than f/2, seeking maximum star sharpness).
- Milky Way Center (MWC) page: shows the visible-period start/end (with day-boundary superscripts), duration, and the elevation-angle range + azimuth range swept over that period, plus the live current az/el. Both a map view (also shows the moon's position, even when it's physically behind the camera) and a simulated viewfinder view (clearer for composition) are provided, each showing something the other can't.
- Milky Way Seeker page: searches a date range for all times the MW core is visible within a target az/el window; returns a large result list (e.g. "122 results" for a year), each annotated with the sun's elevation and the moon's phase/elevation at that moment; filterable by moon phase (e.g., restrict to No-Moon + waxing/waning crescent) and by day-of-week; meant to be cross-checked against external constraints (e.g., a park's seasonal opening dates) to find truly viable nights.
- Meteor-shower planner: catalog of 20+ named showers with start/peak/end dates (long-press a date to jump the app clock there); shows ZHR (Zenithal Hourly Rate) and r-value (magnitude distribution, 2.0=brightest to 3.0=dimmest; below 2.5 considered "bright") per shower; radiant az/el is plotted/tracked in the viewfinder across a session so the frame can include the radiant with margin, ideally also including Polaris (eases aligning stars when compositing multiple meteor frames into one image later).
- Dark-sky map: per-location light-pollution rating, default unit the Bortle scale (1–9, 1 = best); tap for definitions; alternate units selectable.
- Bortle scale reference (1 excellent dark-sky site … 9 inner-city sky) embedded in-app.

### Formulas & Data
- 500/600 Rule: max exposure (seconds) = constant (500 or 600) ÷ effective (crop-adjusted) focal length.
- CoC Rule: a proprietary formula computing angular star movement against the sensor's circle of confusion to derive the strictest max shutter speed of the three rules.
- Milky Way core is treated as fixed in the sky (like stars); its apparent daily "movement" is purely due to Earth's rotation. Uses the sidereal day (23h 56m 4.1s, vs. the 24h solar day) to explain why the MW appears ~4 minutes earlier each successive day. MW visibility search = a combined constraint solve over sun elevation (darkness), moon state, and MWC azimuth/elevation — same "Finder/Seeker" pattern as Sun/Moon Finder.
- Meteor-shower ZHR and r-value are standard per-shower meteor statistics (source dataset not named in the captured text).
- External data citation: Glacier Point seasonal opening/closing dates sourced from nps.gov (nps.gov/yose/planyourvisit/tiogaopen.htm), used in the guide as a worked example of cross-referencing MW Seeker results against real-world access constraints.
- Dark-sky layer defaults to the Bortle scale (1–9); other units selectable, implying an underlying quantitative light-pollution dataset not further detailed in the guide.

### UX Notes
- Offering 3 tunable star-trail "sharpness rules" (rather than one fixed formula) respects that photographers have different gear and quality bars.
- Deliberately keeping both a map view and a viewfinder view for MWC (rather than merging them) because each shows something unique is a reminder not to over-collapse superficially-redundant views.
- Result lists (MW Seeker, meteor showers) are annotated inline with auxiliary state (sun elevation, moon phase) so a result can be judged at a glance without drilling in or filtering first.
- Explicitly designing the workflow to be cross-referenced against real-world external constraints (e.g., a park's seasonal access dates) suggests an actual integration opportunity (import park hours/closures) rather than leaving it to the user's memory.
- Showing r-value alongside ZHR avoids recommending a shower that's numerically "busy" but actually mostly faint/invisible meteors.

---

## 7. Timelapse Sequence

### Features
- Time-lapse calculator: 4 linked values — total duration, interval between shots, number of shots, final clip length (via frame rate) — plus total storage estimate. Any one of the interdependent values can be long-press-marked "Auto" so it's computed from the other three.
- Interval picker offers scenario-based presets, plus free entry.
- Time-lapse simulation in the viewfinder: set a start time (type it, use the slider, or "use current time as start") and an end time (typed, or implied by picking a total duration); Play animates the sky/scene across that span before any real shooting happens.
- Camera-motion simulation: supports linear-only (v1) interpolation of azimuth, elevation angle, and focal length between a captured "starting settings" state and an "ending settings" state (each set via long-press-to-set-current-time, adjust composition, then "set current settings as starting/ending settings"); Play animates the combined celestial-plus-camera-move simulation; shot count is viewable.
- Sequence (compositing) tool: builds a fixed multi-exposure composite (e.g., solar/lunar eclipse sequences, sun/moon path composites) from a start time, end time, and interval (which derive the shot count); choose subject = Sun or Moon; viewfinder shows the resulting track/shape of the object's positions to check against a foreground.
- Sequence-shape-vs-location search: switching to "set camera location" mode and dragging the camera reshapes the projected sequence path live, letting the user search for a location that produces a visually ideal (e.g. symmetric) track for a given event (worked example: finding a city where an eclipse's moon-sequence path is centered/symmetric).

### Formulas & Data
- Time-lapse relationship: total duration = interval × number of shots; final clip length = number of shots ÷ frame rate (any one of {duration, interval, shot count, clip length-via-frame-rate} is solvable from the other three; the "Auto" flag marks the dependent one).
- Storage estimate = shot count × (an implied) per-shot file size.
- Camera-move ramp is pure linear interpolation of azimuth/elevation/focal length between two keyframes across the shot count — no easing (explicitly scoped as v1-only capability).
- Sequence composite path = the chosen body's (sun/moon) sampled azimuth/elevation positions at fixed intervals between start and end, projected into the camera view; the path's shape is a function of observer location and the date/time window, which is what makes location-dragging a usable search technique.

### UX Notes
- "Mark any one field as Auto / solve for it" is a clean way to generalize a calculator that has a circular dependency among its inputs, avoiding a separate mode per solved-for variable.
- Letting the user drag the camera location itself as a search variable to reshape a celestial path (not just searching over time) is a distinctive, non-obvious planning dimension worth carrying over.
- The explicit "only linear adjustments can be simulated (v1)" caveat is an honest scoping note — and a concrete opportunity for a competitor to support eased/keyframed camera ramps.
- The same "scrub or animate through time in the 3D/AR viewfinder, then Play" primitive recurs across star trails, Milky Way, and time-lapse/sequence — strongly suggests building one shared timeline-scrubbing/animation component rather than one per feature.

---

## 8. Exposure

### Features
- Exposure calculator (Manual mode): interlinked ISO, aperture, shutter speed, exposure compensation, and the resulting Exposure Value (always expressed as EV at ISO 100, i.e. "EV100" — the app's convention whenever it says "EV"); changing any exposure-triangle input recalculates EV, and the result is explained relative to a target scene EV (e.g., "1 stop over-exposed").
- Reference exposure "rules" surfaced as worked examples: Sunny 16 (ISO 100, f/16, shutter = 1/ISO on a sunny day → EV 14.6); Looney 11/8/5.6 (moon photography: f/11 for full moon, f/8 for gibbous/half, f/5.6 for crescent, shutter = 1/ISO); Milky Way rule (30s, f/2.8, ISO 3200 — can trade shutter time for aperture/ISO at the same EV to shorten exposure and reduce star trailing); Night Skyline rule (30s, f/8, ISO 100).
- EV lookup table: tapping the EV value opens a browsable list mapping typical EV100 values to real-world scenes (sunny day, sunset, moon, night skyline, overcast, stars, etc.); explicitly flags that e.g. full moon (EV14) vs. night skyline (EV1) is a 13-stop spread — beyond a modern camera's ~10–11 stop dynamic range — meaning both can't be correctly exposed in a single frame.
- ND filter calculator: pick a base shutter speed and an ND filter strength; get the resulting (longer) shutter speed with that filter applied.
- Scene Exposure Mode: auto-suggests an EV from the app's current date/time/location and the sun/moon elevation at that moment (reuses the same shared "world state" as the rest of the app); example EVs shown per condition (clear daytime EV15, clear sunset EV5.5, start of blue hour EV1.6, clear dark night EV−6, overcast variants, night skyline EV1, moon-as-subject EV14, stars-with-trails vs. stars-without both near EV−5).
- Built-in light meter: incident + reflective on Android (uses the phone's light sensor); reflective-only on iOS (platform doesn't expose a light-sensor API); explicitly flagged as not a substitute for a professional meter and inaccurate below EV 1.
- Picture (EXIF) mode: load an existing photo, auto-read shutter/aperture/ISO from its EXIF data, auto-compute EV; shows a clear message when EXIF data isn't available.

### Formulas & Data
- EV is always reported at ISO 100 (EV100) — standard exposure-value formula combining aperture and shutter speed, normalized to ISO 100 (formula itself not restated numerically in the guide; cites the general "EV" concept).
- ND filter conversion is a standard stops-based shutter-speed multiplier keyed to filter strength (not spelled out numerically in the guide).
- Scene-EV lookup table keyed by {sun/moon-elevation-derived time-of-day, sky condition (clear/overcast), subject} → EV100 value.
- Dynamic-range ceiling assumption of ~10–11 stops for "modern cameras," used to flag when two desired subjects' EVs can't both fit in one exposure.

### UX Notes
- Four modes (Manual / ND / Scene / Picture) sharing one page/layout serve very different mental models (pure calculator, context-aware suggestion, and reverse-engineering an existing photo) without needing separate top-level screens.
- Tying "Scene Mode" EV suggestions to the same global clock/location/sun-moon-elevation state used everywhere else (rather than a standalone calculator) reinforces a single shared "world state" driving every module — worth replicating architecturally.
- Presenting named historical exposure rules (Sunny 16, Looney 11, Milky Way rule, Night Skyline) as both a teaching aid and quick-start presets is good onboarding for less experienced users.
- Explicitly stating the light meter's accuracy floor (unusable below EV1) is an honest limitation disclosure worth keeping.
- Turning an abstract EV-gap number into a concrete actionable insight ("can't capture both in one frame, so bracket / shoot twice") is a good example of translating raw output into a decision.

---

## 9. Light, Shadow, Rainbow, Tide

### Features
- Shadow simulator: enter a subject's height, get shadow direction and length drawn on the map; can be cross-checked against a real satellite image's visible shadows to back-derive the sun's angle/direction at the moment that image was captured.
- Light-reach checker: place the Scene pin at a target point, scrub time, and see whether direct sunlight or moonlight actually reaches that point given surrounding terrain occlusion (e.g., for timing an alpenglow "red peak" shot).
- Light-reach detail chart: a terrain-vs-light-ray elevation profile showing exactly where the ray clears or is blocked, letting the user find a better date by comparing how the (seasonally shifting) sunset azimuth lines up with lower terrain in a more favorable direction.
- Manual light-source override: by default the "active" light source auto-switches — sun while up; moon once the sun is below −8° elevation and the moon is up; otherwise "starlight" (no meaningful light/shadow). A pinning override lets the user force the source to Sun or Moon regardless of which is naturally dominant, to check that one body's visibility/reach alone.
- Rainbow predictor: shows the predicted rainbow position (map and viewfinder) as time is scrubbed, driven by whichever body is the active light source; distinguishes rainbow varieties — post-rain rainbow, waterfall-mist rainbow, fog bow — each with stated necessary conditions; a settings toggle selects rainbow variant (double rainbow, circular rainbow). Worked example: place a marker at a waterfall's known mist zone, scrub date/time until the predicted rainbow band intersects that marker at a chosen focal length.
- Tide module: current tide state/height, distance to nearest tide station, a tide-station picker overlaid on the map, and a tide-height chart embedded directly in the date/time slider; high vs. low tide is distinguishable from the chart shape (3–4 tides/day typical).
- Tide search: search by a target tide height (e.g. exactly 1 ft), combined with lighting-condition filters (golden hour / blue hour / civil twilight) and day-of-week (e.g. weekends only), to shortlist good shoot dates from a large result set (worked example: 746 → 15 results).

### Formulas & Data
- Shadow length/direction: classic height ÷ tan(light-source elevation angle) relation; shadow direction = light-source azimuth + 180°.
- Light-reach/visibility uses the same terrain-elevation-profile occlusion check as the Plan module's line-of-sight coloring.
- Rainbow geometry: the rainbow sits at the antisolar point, ~42° radius from the point directly opposite the light source; visible only when the light source's elevation is below 42° (higher elevation → lower/no rainbow from ground level — only visible from an elevated vantage such as a mountain or aircraft above that point); supported for all moon phases, though moon-caused rainbows/fog bows are expected faint/near-colorless. Per-variant conditions: post-rain rainbow needs source elevation <42° and rain (or just-stopped rain) in the direction opposite the source; waterfall-mist rainbow needs source elevation <42° (or a full/gibbous moon) plus sufficient wind-blown mist; fog bow needs fog opposite the light source (sun or moon).
- The app explicitly does not forecast rain, mist, or fog itself — rainbow prediction is pure geometry, conditioned on the user independently confirming precipitation/mist/fog via an external weather app.
- Tide data implies a per-station tide-prediction dataset (source not named in the captured guide text) with 3–4 tides/day; tide search combines a target height with lighting-derived time windows and calendar (day-of-week) filters.

### UX Notes
- Cleanly separating "what the app can compute" (rainbow/light geometry, given a light-source position) from "what it can't" (actual rain/mist/fog) is an honest, well-scoped feature boundary — geometry/astronomy modules should stay pure-computation and link out to (not fake) weather data.
- Cross-referencing a computed light-ray/terrain chart against a real satellite photo's shadows to reverse-engineer a historical capture time is a clever secondary use of the same underlying chart.
- The "auto light source, with a pin-to-override" pattern (sun → moon → none) is a reusable idea for any "which celestial body matters right now" logic elsewhere in the app.
- Combining a physical target parameter (tide height) with lighting-condition filters and calendar constraints in one search is the same generalizable "constrained ephemeris search" pattern seen in the Sun/Moon Finder and Milky Way Seeker — reinforces building one shared filtered-search engine across modules instead of a bespoke one per feature.

---

## 10. Cloud Distance

### Features
- Cloud-height input row: enter heights for multiple cloud layers (e.g. high/medium bands), using built-in defaults or values looked up on external cloud-height maps (Windy, Meteoblue named explicitly).
- Cloud-blocks-subject checker: computes the horizontal distance from the camera, along the sun/moon/Milky-Way-Center direction, to where a cloud at a given height would sit at the horizon, and the furthest distance still within the "would-block" zone — used to judge whether a cloud seen (at some real-world distance) on an external cloud map would obscure the subject; supports explicitly checking one specific subject when several (e.g. sun+moon, or MWC+moon) are up simultaneously.
- Sunset/sunrise "burn" predictor: the same distance geometry reframed to predict colorful (red/gold) clouds during golden hour/twilight — shows, per cloud layer, the near "should-have-cloud-here" distance (blue tick icon) and the far cutoff distance beyond which a cloud is too far to be lit (red cross icon), plus the sun-elevation angle at which that far cutoff is reached (i.e., the latest/lowest sun angle at which that layer can still burn) — directly counters the common mistake of leaving right after sunset, since higher cloud layers can keep burning well into twilight.
- Near/far cloud-distance markers plotted on the map (blue tick / red cross icons) for direct visual cross-referencing against an external real-time or forecast cloud map.

### Formulas & Data
- Core geometry: distance ≈ cloud-base height ÷ tan(subject's elevation angle) — a right-triangle relation between cloud altitude, the sun/moon/MWC's elevation angle along the sightline, and horizontal ground distance; computed once for "at the horizon" (elevation ≈ 0°, the maximum distance still visible at the horizon) and once for the "furthest no-cloud" boundary tied to a specific low sun elevation.
- Worked examples given in the guide: 20,000 ft cloud → horizon distance 173 mi, furthest-no-cloud distance 519 mi, corresponding sun elevation −7.5°; 13,000 ft cloud → 140 mi / 419 mi / −6.1°. With multiple layers, only the lower layer's numbers matter once a higher layer is already accounted for (worked example shows the medium-cloud case superseding the high-cloud one).
- Named external data sources: Windy and Meteoblue for cloud-height/cover maps; sunsetwx.com cited as an existing (imperfect) automated sunset-quality predictor this feature is positioned alongside.
- The app does not ingest live cloud-cover data itself — it's a pure geometric calculator meant to be used side-by-side with an external cloud map, not a forecast in itself.

### UX Notes
- Same "app computes pure geometry, user supplies real-world observational/forecast data via an external tool" boundary as the Rainbow feature — a consistent app-wide philosophy of not pretending to forecast weather.
- Converts an expert-only skill (reading cloud maps + meteorology to predict a "burn") into a concrete numeric distance + elevation-angle threshold — the core value proposition, and the same "decode tribal knowledge into a checkable number" pattern seen in golden/blue hour and rainbow.
- Explicitly correcting a common practitioner mistake ("leaving right after sunset") with a concrete number (latest sun elevation for that cloud layer to still burn) is a good example of pairing a calculator with actionable guidance text, not just raw output.
- Naming and crediting specific external tools (Windy, Meteoblue, sunsetwx.com) directly in the docs suggests a real integration opportunity (API/deep-link) rather than requiring users to manually cross-reference a separate app/tab.

---

## Cross-cutting concepts

**The Plan.** The atomic unit of the whole app: camera location + scene location + date/time + composition (focal length, azimuth, elevation angle, orientation). Everything else — markers, ephemeris data, viewfinders, exposure, night-photography tools — is either an input to a Plan or an overlay computed from one. A lighter-weight "selected location" concept exists alongside camera/scene pins so tools always have *some* reference point to act on. Plans are persisted as shareable files (mobile-era pattern — a web app would use accounts + shareable URLs/cloud sync instead).

**Two orthogonal "mode" axes.** (1) *How you're looking at the world* — the 5 map tools (Location, Distance & View, Composition, Depth of Field, Panorama) and the 4 viewfinder renderers (Streetview, Picture, AR, VR) — i.e., viewport/rendering choice. (2) *What data is currently overlaid* — the 18 Ephemeris "pages," color-grouped into Sun & Moon (orange), Night Photography (purple), Special Interests (green), and Meteorology & Oceanography (blue); confirmed named pages include Rise & Set, Twilight, Sun/Moon Position, Sun/Moon Finder, Stars & Star Trails, Milky Way Center, Milky Way Seeker, Meteor Showers, Dark Sky, Light & Shadow, Rainbow, Tide, Cloud Distance, Exposure, Time-lapse, Sequence (the guides state 18 total but don't enumerate every page by name). A given viewfinder renders whatever the active Ephemeris page produces. This separation — renderer vs. active data overlay — is the central architectural insight worth replicating: build one scene-description/overlay layer that's agnostic to which of the 4 renderers is currently displaying it.

**The "Finder/Seeker" search primitive.** Recurs constantly: given a target region in some parameter space (azimuth×elevation window, tide height, star elevation/azimuth band) plus a date range and optional filters (moon phase, day-of-week, external constraints), return every matching datetime, each annotated with auxiliary state (sun elevation, moon phase) so results can be judged without extra taps. Seen in Sun/Moon Finder, Milky Way Seeker, meteor-shower planning, and Tide Search. Strongly suggests one shared, generalized constrained-ephemeris-search engine underneath the app rather than a bespoke implementation per feature.

**Shared "world state."** A single simulated current date/time + location + active light source (sun/moon auto-switch, with manual override) feeds nearly every module — Exposure's Scene Mode, Light & Shadow, Rainbow, Cloud Distance, and every Ephemeris page all read from this same clock/location, not independent inputs. The Date/Time bar's simulated clock is explicitly distinct from the device's real clock.

**Markers as the shared "world furniture."** A marker is a location + category/icon + name + rating + note + optional width/height + display flags + a "show ground contour" flag — referenced by the Plan (snap camera/scene pins to markers), by all 4 viewfinders (rendered as overlays), and by the Light/Shadow, Rainbow, and Cloud-Distance tools (as scene/reference points). Elevation data (online Google API vs. offline SRTM tiles) underlies markers' ground contours, the Plan's line-of-sight coloring, and the viewfinders' 3D terrain — one elevation-data concern threading through the whole app, including a real gotcha (ocean-floor depth vs. sea-level height for underwater points) that needs explicit datum-flagging in the data model.

**Consistent conventions worth carrying over.** A single coordinate-format chooser (7+ formats) reused everywhere coordinates appear; a single distance-unit toggle (US/metric); a single azimuth/elevation-angle representation (with dedicated icons) reused as camera direction, target search region, and marker bearing; a text/value color convention (editable vs. calculated vs. live vs. read-only) reused across every dense data screen; and a "pure geometry/astronomy computation, integrate with (don't fake) external weather/tide/park-hours data" boundary applied consistently to Rainbow, Cloud Distance, and Tide.
