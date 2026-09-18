Research date: 2026-09-13

# Commercial and hosted 3D building / mesh services for Scape

Legend: **[V]** verified today by fetching the page; **[S]** from a search-result snippet today (source named, not directly fetched); **[M]** recalled, unverified.

## 1. Google Photorealistic 3D Tiles (Map Tiles API)

**Pricing [V]** — https://developers.google.com/maps/billing-and-pricing/pricing (page dated 2026-09-10):

| SKU | Free/month | Cap–100k | 100k–500k | 500k–1M | 1M–5M | 5M+ |
|---|---|---|---|---|---|---|
| Map Tiles API: Photorealistic 3D Tiles (`C6E1-98B2-DBD0`, Enterprise tier) | 1,000 | $6.00 / 1000 | $5.10 | $4.20 | $3.30 | $2.40 |

**Billing unit [V]** — https://developers.google.com/maps/documentation/tile/usage-and-billing: only **root tileset requests** are billed and quota'd. "Timed session tokens allow for up to three hours of renderer tile requests from a single root tileset request"; renderer-originating tile requests are **unlimited and unbilled** (rate limit 12,000 qpm). Daily cap: 10,000 root tileset queries/project/day.

**Cost per viewfinder session**: one root tileset request = **$0.006**, and all the mesh tiles pulled for the next three hours are free. 1,000 free sessions/month; 10,000 sessions ≈ $54/month. Financially this is the cheapest high-fidelity option by a wide margin.

**The blocker — caching/offline [V]** — https://developers.google.com/maps/documentation/tile/policies, verbatim: "you must not pre-fetch, index, store, or cache any Content except under the limited conditions stated in the terms… You may not use Map Tiles API for any non-visualization use cases, such as: Image analysis, Machine interpretation, Object detection or identification, **Geodata extraction or resale**, **Offline uses**, including for any of the above." Responses carry `Cache-Control`/`ETag` that must be honoured. This is incompatible with Scape's local-first OPFS caching *and* arguably with depth-testing geometry in a software rasteriser (that is closer to "machine interpretation / geodata extraction" than to visualization — a real legal risk worth a lawyer's read, not my call).

**Renderer and basemap [V]** — third-party renderers are explicitly contemplated by the policy page ("When using third-party renderers, maintain clear separation between Google's logo and the renderer's logo"). Tiles are OGC 3D Tiles / glTF; the policy page's own example shows `"generator": "draco_decoder"`, i.e. **Draco-compressed** glTF. Attribution: Google Maps logo *plus* the per-tile attribution strings, aggregated, sorted and displayed on one line, updated per frame. Hybrid visualizations (Google data + your own overlay) are allowed but must be visually disambiguated. Mixing with a non-Google basemap is not forbidden outright but the Google attribution must not be associated with non-Google data.

**Coverage [S]** — "over 2,500 cities across 49 countries" (mapsplatform.google.com marketing / Spatialized 2026 handbook). Coverage list for the 3D product: https://developers.google.com/maps/documentation/javascript/3d/coverage (not fetched). Manhattan is covered; Zermatt/Matterhorn is alpine terrain mesh — likely present but at much coarser LoD than a city. **Uncertain.**

**Street-level quality [M]** — it is the Google Earth photogrammetric mesh: a 300 m tower's overall massing and height are metrically good (sub-metre to a few metres), but edges, spires, antennas and thin structures are melted/rounded by photogrammetry. For "sun exactly behind the spire at 600 mm", the *spire* is exactly where the mesh is worst. Not verified with a measurement today.

**API key from a browser [V/S]** — https://developers.google.com/maps/documentation/tile/cloud-setup recommends restricting keys "to specific APIs and IP addresses"; HTTP-referrer restriction exists for browser keys [S: Google best-practices blog], but browsers commonly redact the `Referer` on cross-origin requests, and local/opaque schemes (a PWA, a `file:`/webview context) strip it entirely, which breaks referrer-restricted keys [S: mae.hexagon.com tutorial]. Practical consequence: a referrer-restricted key in a PWA is both leakable and fragile; a server proxy that mints session URLs is the safer pattern, which conflicts with "local-first". `https://tile.googleapis.com/v1/3dtiles/root.json` without a key returns **HTTP 404** [V] (no CORS headers exposed on the error).

## 2. Cesium ion

**Plans [V]** — https://cesium.com/platform/cesium-ion/pricing/ (fetched today):

| | Community | Commercial | Premium |
|---|---|---|---|
| Price | Free (individual) | $149/mo individual, $524/mo team | $499/mo individual, $874/mo team |
| Use | **Personal and non-commercial only** | "Commercial use within your organization *" | same |
| Storage | 10 GB | 100 GB | 500 GB |
| Streaming | 15 GB/mo | 150 GB/mo | 500 GB/mo |
| Google Photorealistic 3D Tiles | 1,000 root tiles/mo | 5,000/mo | 10,000/mo |
| Global imagery (Bing, Google, Azure preview) | 1,000 sessions/mo | 5,000/mo | 10,000/mo |

The asterisk matters: "**Contact us if you plan to integrate Cesium ion into solutions used outside your organization.**" A publicly distributed (free or paid) Scape is exactly that — the $149 plan does **not** cover it; it needs a negotiated integration licence. Going through ion for Google tiles also costs *more* per root tile than going direct ($149/5,000 = $0.030 vs $0.006).

**Offline [S]** — https://cesium.com/legal/terms-of-service/ and third-party-terms: you may not copy/store/redistribute Cesium Data Output for offline/disconnected use; caching only as a general HTTP cache honouring headers; third-party data may be cached only per HTTP headers. Asset "Archives" allow downloading *your own uploaded* assets, not Asset Depot/global content.

**Cesium OSM Buildings [V]** — https://cesium.com/platform/cesium-ion/content/cesium-osm-buildings/: 350M+ buildings from OSM, global, updated quarterly, 3D Tiles, rich per-building metadata. Critically, `cesium#estimatedHeight` is "computed from the number of levels… assuming a height of 3 meters per level and that all buildings have at least 1 level" — i.e. **flat-roof LoD1 extrusions with a guessed height**, the same class of data Scape already builds from OpenFreeMap. No roof shapes. Attribution: © OpenStreetMap contributors. **No accuracy gain over the status quo.**

Cesium World Terrain (global ~10 m, better in places) and Bing imagery are ion-gated under the same ToS; Bing imagery is also on Microsoft's retirement path (below).

## 3. Esri

- **OpenStreetMap 3D Buildings** (item `ca0470dbbddb4db28bad74ed39949e25`) is **in mature support since December 2024** and its upstream (OSM Daylight) has been sunset [V, ArcGIS item REST metadata].
- Replacement: **Open 3D Buildings**, item `c444b24b184c4523a5dc96248bfea4e1`, service `https://basemaps3d.arcgis.com/arcgis/rest/services/Open3D_Buildings_v1/SceneServer` [V]. Layer JSON: `layerType: 3DObject`, store profile `meshpyramids`, geometry `draco`-compressed, description "overture 2026-07-22.0", updated monthly. **Fields are only `height`, `building_levels`, `ObjectID`, `OSMID`, `OSMType`, `SrcID`, `name`, `building`, `source`** — no roof type/height/direction, so these are **LoD1 flat extrusions from Overture (OSM + Microsoft footprints)**, not LoD2.
- **CORS [V]**: `curl -sI -H 'Origin: http://localhost:5173' …/SceneServer?f=json` → `HTTP/2 200`, `access-control-allow-origin: *`. `…/layers/0/nodepages/0?f=json` returns 200 (6 KB) **with no token**. Technically consumable from a browser with a custom I3S decoder.
- **Licence [V]**: "This work is licensed under the Esri Master License Agreement" — *not* an open licence, despite the open upstream data. Attribution string: "Map data OpenStreetMap contributors, Microsoft Building Footprints, Scene Layer by Esri". Using this endpoint outside an ArcGIS entitlement is legally unsafe even though it is technically open. Esri free developer tier exists but is credit-metered and ties you to ArcGIS location services.
- Esri is enhancing 3D basemaps with **Maxar and TomTom** commercial elevation/buildings [S, esri.com blog "Enhanced 3D Layers in ArcGIS"]; those layers will be licence-gated, not free.
- ArcGIS Pro 3.5 ships an "Extract LOD2 Buildings" tool [S] — a desktop pipeline, not a data source.

## 4. Mapbox / MapTiler / Protomaps / OSM Buildings

| Provider | What the 3D actually is | Verdict |
|---|---|---|
| **Mapbox Standard** | OSM extrusions, plus ~10,000 **artist-made** landmark models in 370 cities and detailed facades in 8 cities (Munich, Berlin, Stuttgart, SF, NYC, Las Vegas, Helsinki, Tokyo); Mapbox calls the design philosophy "**symbolic realism** — recognizable without being so realistically designed that they distract" [S, mapbox.com/blog/global-cities-3d-landmarks] | Deliberately *not* metrically faithful; models are baked into the style, not exposed as fetchable geometry. Unusable as ground truth. |
| **MapTiler** | OSM `building` extrusions; a "Buildings" tileset with stable IDs, heights, entrances. Free tier 100k tile requests/mo; Cloud from $29/mo [S] | LoD1. No gain. |
| **Protomaps** | No 3D building geometry; height attributes only, plus Mapterhorn terrain. Open, self-hostable | No gain for buildings (excellent for the open-data slice). |
| **OSM Buildings (osmbuildings.org)** | Site is alive ("Powered by ONEGEO") but the legacy anonymous data API `https://data.osmbuildings.org/0.2/anonymous/tile/…` returns **HTTP 403** today [V]; `/developer/` returns an empty page [V] | Effectively dead as a free endpoint. Their LoD work is OSM `roof:shape` interpretation — the same thing Scape could do itself from raw OSM. |

## 5. Everything else (status verified at the headline level only)

| Provider | Status | Viability |
|---|---|---|
| **TomTom Orbis Maps** | Building-footprint layer with 2D/3D visualization = extrusions; freemium ~50k tile requests/day, pricing revised July 2026 [S, docs.tomtom.com/pricing] | Free-ish but LoD1. No accuracy gain. |
| **HERE** | Stylised 3D landmarks, enterprise licensing | Not viable; enterprise price class. |
| **Bing Maps 3D** | Bing Maps for Enterprise retired: Basic accounts shut down 2025-06-30, Enterprise until 2028-06-30; migrate to Azure Maps, which has **no** photorealistic 3D mesh product; the Windows-SDK 3D data services are not available elsewhere [S, blogs.bing.com 2025-01 / 2025-06] | Dead. |
| **Maxar Precision3D / Vivid / SYNTH3D** | Enterprise/government; no published pricing | Not viable; enterprise price class. |
| **Blackshark.ai** | Synthetic (AI-inferred) 3D buildings, partnered with Maxar Vivid; enterprise + an Unreal marketplace listing | Not viable for web; also *synthetic*, i.e. plausible not surveyed — wrong for sub-degree silhouettes. |
| **Nearmap / Vexcel (3D Cities) / Aerometrex / Cyclomedia / Bluesky** | True photogrammetric meshes, city-by-city, annual subscriptions or per-km² licences, no published prices, no self-serve API | Not viable; enterprise price class (typically thousands to tens of thousands per city per year). |
| **Apple** | No public 3D API | N/A. |

## 6. Pay-as-you-go per-building LoD2 meshes

Searched today: **no commercial pay-per-building LoD2/mesh marketplace exists** that an indie app could meter. Every commercial mesh provider sells area licences under contract. The only affordable route to true LoD2 roofs is national/municipal **open** data (Bavaria/NRW CityGML LoD2, Netherlands 3DBAG, Switzerland swissBUILDINGS3D, NYC's own model), which falls in the open-data slice of this research, not here.

## 7. Bottom line for Scape

- Only **one** commercial service on this list actually beats OSM extrusion: Google Photorealistic 3D Tiles. Everything else that is affordable (Cesium OSM Buildings, Esri Open 3D Buildings, MapTiler, TomTom, Mapbox extrusions) is the same LoD1 flat-roof data Scape already renders.
- Google is cheap enough ($0.006/session, 1,000 free/month) but its terms forbid offline storage, pre-fetching and geodata extraction — the three things a local-first depth-tested viewfinder does — and its photogrammetric mesh is weakest exactly on spires and antennas.
- Mapbox's landmark models are explicitly stylised, so "prettier 3D" from a maps vendor is not the same as "accurate silhouette".
- The Esri Overture endpoint is the one that is technically open (`access-control-allow-origin: *`, no token, Draco I3S) but legally closed (Esri MLA).
