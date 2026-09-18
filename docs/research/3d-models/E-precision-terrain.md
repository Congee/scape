Research date: 2026-09-13

# E — Higher-precision terrain than Terrarium (worldwide and per country)

Legend: **[V]** verified this session by curl/fetch of the live endpoint or primary doc; **[S]** from a search-result summary of a primary page; **[R]** recalled, not verified.

---

## 1. What Terrarium actually contains

Source of truth: `tilezen/joerd/docs/data-sources.md` and `attribution.md` **[V]**.

- Built 2016Q2 (v1), rebuilt 2017Q3 (v1.1). **"Regular updates are not planned."** The data is ~9 years old. **[V]**
- Per-zoom land sources at z10–15: SRTM globally, plus `NED/3DEP` 1/3″ and 1/9″ (US), `data.gov.uk` 2 m (UK), `data.gv.at` 10 m (AT), `Kartverket` 10 m (NO), `LINZ` 8 m (NZ), `INEGI` (MX), `NRCAN` (CA), `ArcticDEM` 5 m >60°N. EU-DEM 30 m is listed only at z9. **[V]**
- **But the tiles carry an `X-Imagery-Sources` header, and it contradicts the doc for the Alps.** Zermatt z13/z14/z15 all return `x-amz-meta-x-imagery-sources: eudem/eudem_dem_5deg_n45e005.tif` **[V]** — so the Matterhorn is **EU-DEM v1.1 (25 m grid, ~7 m vertical RMSE, itself a blend of SRTM + ASTER GDEM)**, not SRTM. Mt Rainier z14 returns `ned/ned19_n47x00_w122x00_wa_mounttrainier_2008.tif` **[V]** — NED 1/9″ ≈ 3 m lidar. This header is the cheapest possible per-region quality probe and is CORS-exposed (`Access-Control-Expose-Headers: x-amz-meta-x-imagery-sources`) **[V]**.
- Artefacts, per joerd's own "Known issues": "large variations in elevation in areas with large buildings", "resampling and merging artifacts along coastlines" **[V]**. SRTM is a **canopy/surface** model void-filled from coarser sources in steep terrain; EU-DEM smooths ridge crests because ASTER GDEM stacking averages. Terrarium's 1/256 m quantisation is irrelevant by comparison.
- CORS: `Access-Control-Allow-Origin: *` on GET **and** on OPTIONS preflight **[V]**. Note it is absent from a bare `HEAD` — don't test with `curl -sI`.

---

## 2. Does resolution beyond 10 m matter? (the arithmetic)

Angular size of a vertical error `h` at distance `d`, and one sensor pixel at 600 mm full-frame, 6000 px wide = **2.06″/px**; 300 mm = 4.12″/px. Moon disc = 1800″. **[V, computed]**

| Vertical/horizontal error | at 5 km | at 15 km | at 30 km | at 15 km, in 600 mm px | at 15 km, as fraction of moon |
|---|---|---|---|---|---|
| 30 m (SRTM/EU-DEM cell) | 20.6′ | **6.9′ (412″)** | 3.4′ | **200 px** | **23 %** |
| 10 m | 6.9′ | 2.3′ (137″) | 1.1′ | 67 px | 7.6 % |
| 5 m | 3.4′ | 1.15′ (69″) | 0.6′ | 33 px | 3.8 % |
| 3 m | 2.1′ | 0.7′ (41″) | 0.3′ | 20 px | 2.3 % |
| 1 m | 0.7′ | 0.23′ (14″) | 0.1′ | 6.7 px | 0.8 % |

One 600 mm pixel at 15 km subtends **0.15 m** vertically **[V, computed]**. Conclusions:

- **30 m data is catastrophic for this use case**: a quarter of a moon diameter of error, 200 px on the frame. A "moon behind the summit" alignment computed on EU-DEM can be visibly wrong.
- **The useful floor is ~2–5 m**, where error drops under 1′ ≈ 4 % of the moon. Below ~1 m the error is swamped by other terms anyway: atmospheric refraction near the horizon (0.1–0.5°, far larger than everything in this table), GPS camera position (3–10 m horizontal → at 15 km a 10 m position error on a ridge sloping 45° is itself ~2′), and the photographer's inability to stand on an exact point.
- Grid *spacing* matters as much as vertical accuracy: on a 45° ridge a 30 m horizontal cell is a 30 m vertical ambiguity. So "SRTM 30 m, ±6 m vertical RMSE" is really ±20–30 m of skyline for Scape's purposes.
- **Practical target: 1–2 m national DEMs where available, Copernicus GLO-30 as the global floor, and always correct refraction.** Going past 1 m buys nothing a photographer can use.

---

## 3. Global alternatives

| Dataset | Res / type | Licence | Browser-fetchable? | Notes |
|---|---|---|---|---|
| **Copernicus GLO-30** | 30 m **DSM** (TanDEM-X derived) | Free for any use incl. commercial, attribution; ESA/Copernicus DEM licence **[S]** | **No — S3 bucket has no CORS.** GET+Origin returns 206 with *no* `access-control-allow-origin`; OPTIONS preflight returns **403** **[V]** | `https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N45_00_E007_00_DEM/...tif`, COG, range-readable (42.6 MB per 1°×1° tile) **[V]**. STAC at `copernicus-dem-30m-stac.s3.amazonaws.com`. A few countries' tiles withheld. **Best global upgrade over Terrarium — no voids, far better in mountains — but must be proxied or re-tiled.** |
| GLO-90 | 90 m | same | same (no CORS) | not useful here |
| **ALOS AW3D30 v4** | 30 m DSM | JAXA, free, attribution; commercial permitted **[R]** | No public CORS endpoint found **[R]** | Via JAXA portal or OpenTopography. Comparable to GLO-30, generally slightly worse in steep terrain. |
| **NASADEM** | 30 m (SRTM reprocessed, voids filled with ASTER/ALOS) | Public domain (NASA/USGS) **[R]** | LP DAAC requires Earthdata login **[R]** | Better than raw SRTM but still SRTM-era, still canopy. |
| **TanDEM-X 30 m EDEM** | 30 m DSM, pole-to-pole | DLR: free of charge **for non-commercial/scientific**; commercial licence must be purchased separately **[S]** | download.geoservice.dlr.de, registration **[S]** | **Licence disqualifies a possibly-paid app.** GLO-30 is the same radar data under a usable licence. |
| **FABDEM V1-2** | 30 m, **bare-earth** (forest+buildings removed from GLO-30) | **CC BY-NC-SA 4.0 — non-commercial only**; commercial via Fathom (`fabdem@fathom.global`) **[S]** | data.bris download | Scientifically the nicest 30 m product; **NC + ShareAlike makes it unusable for a possibly-paid, possibly-open-source app.** |
| MERIT DEM | 90 m | CC BY-NC 4.0 / ODbL dual **[R]** | no | too coarse |

### Tiled services built from these

| Service | Price / free tier | CORS | Offline caching allowed? |
|---|---|---|---|
| **AWS Terrain Tiles (current)** | Free, no key, no quota | `*` on GET + preflight **[V]** | Yes — AWS Open Data, attribution only **[V]** |
| **MapTiler Terrain-RGB v2** | Free tier 100k tile requests/mo, **non-commercial only**; paid from $29/mo **[S]** | `*` present (403 without key) **[V]** | **No.** ToS prohibits "storing, saving, and/or redistributing any map content from a server-side cache" and "batch or excessive bulk download of map tiles"; exceptions only by custom licence **[S]** |
| **Mapbox Terrain-DEM v1 / Terrain-RGB v1** | Billed per map load on Standard/Custom plans **[S]** | yes | Offline only via Mapbox's own mobile SDKs' tile regions; the web ToS caching limit is the blocker **[S/R]** |
| **Cesium World Terrain** (quantized-mesh) | Free Community tier is **individual, non-commercial**; Commercial from **$149/mo** **[S]** | yes | streaming-oriented |
| **OpenTopography global API** | Free key: **50 calls/24 h non-academic**, 200 academic; Enterprise key priced on request **[S]** | `access-control-allow-origin: *` but **401 without key** **[V]** | Rate limits make it a build-time tool, not a runtime source |

**Implication:** every commercial terrain tile service either forbids the offline caching a local-first PWA is built on, or restricts its free tier to non-commercial use. **Self-hosted re-tiling is the only path compatible with Scape's constraints.**

---

## 4. National DEMs — the ones that are actually reachable from a browser

Only four verified today serve high-res elevation over public HTTPS with `Access-Control-Allow-Origin: *` **and** HTTP range support:

| Country | Dataset | Res | Endpoint | CORS + range |
|---|---|---|---|---|
| **Switzerland** | **swissALTI3D** DTM | **0.5 m & 2 m** COG | `https://data.geo.admin.ch/ch.swisstopo.swissalti3d/swissalti3d_2019_{E}-{N}/swissalti3d_2019_{E}-{N}_0.5_2056_5728.tif` — discoverable via STAC `https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo.swissalti3d/items?bbox=...` | **`*` [V]**, 16.6 MB per 1 km² tile at 0.5 m **[V]** |
| **Switzerland** | **swisstopo quantized-mesh terrain** | up to **z18** | `https://3d.geo.admin.ch/ch.swisstopo.terrain.3d/v1/layer.json` → `20250101/{z}/{x}/{y}.terrain` (EPSG:4326 TMS, octvertexnormals) | **`*` [V]** — z12/z14/z16 all 200, 270–540 KB/tile **[V]** |
| **USA** | **3DEP 1 m** DTM COG | 1 m | `https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/{Project}/TIFF/USGS_1M_{zone}_x{c}y{r}_{Project}.tif` | **`*` + 206 range [V]** (276 MB test file), public domain, no requester-pays |
| **New Zealand** | LINZ 1 m DEM | 1 m | `https://nz-elevation.s3-ap-southeast-2.amazonaws.com/{region}/{survey}/dem_1m/2193/{tile}.tiff` + STAC sidecars | **`*` + 206 range [V]**, CC BY 4.0 |
| **Japan** | GSI `dem_png` / `dem5a_png` | ~10 m / 5 m | `https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png` | **`*` [V]**. Encoding: `x=R·2^16+G·2^8+B`, `h=x·0.01` (or `(x−2^24)·0.01` if `x>2^23`), `(128,0,0)`=nodata **[S]**. Licence: attribution to 国土地理院; some republication triggers a Survey Act **承認申請** approval — verify before shipping commercially **[S]** |

Everything else is **download-and-re-host only** (licences mostly fine, but no browser-readable endpoint):

| Country | Dataset | Res | Licence | Access |
|---|---|---|---|---|
| Netherlands | AHN4/AHN5 | 0.5 m DTM+DSM | **CC0** | PDOK WCS `https://service.pdok.nl/rws/ahn/wcs/v1_0`, CORS `*` **[S]** |
| France | RGE ALTI / LiDAR HD | 1 m / COPC LAZ | Etalab 2.0 (commercial OK) | geoservices.ign.fr, 5×5 km tiles **[S]** |
| Germany | DGM1 per Land | 1 m | mostly DL-DE-Zero-2.0 / GeoNutzV **[S/R]** | 16 separate state portals; no unified endpoint |
| Austria | ALS-DGM | 1 m | OGD, attribution **[S]** | data.gv.at **[S]** |
| Spain | PNOA-LiDAR MDT | 0.5–2 m | CC BY 4.0 | centrodedescargas.cnig.es **[S]** |
| Italy | TINITALY v1.1 / regional | 10 m / 1 m | CC BY 4.0 / IODL **[S]** | tinitaly.pi.ingv.it; regional portals |
| Norway | Nasjonal høydemodell | 1 m | CC BY 4.0 | hoydedata.no **[S]** |
| Sweden / Finland / Denmark | 1 m / 2 m / 0.4 m | — | CC BY 4.0 / open **[S]** | Lantmäteriet (account), NLS, Dataforsyningen |
| UK | EA LIDAR Composite / Scotland / Wales | 1–2 m | **OGL v3** | environment.data.gov.uk, 5 km tiles **[S]** |
| Canada | HRDEM CanElevation | 1–2 m COG | OGL-Canada | STAC `datacube.services.geo.ca`; mountain coverage patchy **[S]** |
| Australia | ELVIS | 1–5 m | CC BY 4.0 | portal download only, 15 GB/request **[S]** |
| Slovenia / Czechia / Poland / Iceland | 1 m / DMR5G / NMT 1 m / ÍslandsDEM 10 m | — | open, wording unverified **[R]** | national portals |
| **Nepal, Chile, Peru, most of the Andes/Himalaya** | — | — | — | **Nothing open and high-res. GLO-30 is the ceiling. [S]** |

---

## 5. Is re-tiling a 1 m national DEM to Terrarium z16/z17 realistic?

Tile counts and sizes per 100 km², at latitude 46 **[V, computed]**:

| Zoom | m/px | tile ground size | tiles per 100 km² | @80 KB/tile | @150 KB/tile |
|---|---|---|---|---|---|
| z14 (today) | 6.8 | 1741 m | 33 | 2.6 MB | 4.8 MB |
| z15 | 3.4 | 870 m | 132 | 10 MB | 19 MB |
| **z16** | **1.7** | 435 m | 528 | **41 MB** | **77 MB** |
| z17 | 0.85 | 218 m | 2112 | 165 MB | 309 MB |

Source-side, a 50×50 km mountain region at 1 m float32 is **10 GB raw**, ~1.3–2.5 GB as compressed GeoTIFF; swissALTI3D at native 0.5 m would be ~2500 × 16.6 MB ≈ **40 GB** to pull **[V, computed]**.

**Verdict: yes, and z16 is the sweet spot.** z16 (1.7 m/px) already lands under the 2 m useful floor from §2, and the numbers are small: a generous Zermatt region of ~400 km² is **~165–300 MB** of z16 tiles, or ~40 MB if you stop at z15. That is a plausible OPFS download for a "precision region", sitting alongside Scape's existing offline regions. The build cost is one-off (GDAL: warp national DEM → EPSG:3857 → `rio rgbify`/`gdal2tiles` → Terrarium PNG, or PMTiles for a single-file region). Only the build pipeline touches the multi-GB source; the client never sees it.

Two cheaper variants worth weighing:
1. **Swiss shortcut**: swisstopo's quantized-mesh already exists at z18 with CORS `*` **[V]** — for Switzerland you can skip re-tiling entirely if the viewfinder can sample a TIN instead of a raster.
2. **COG-direct**: for CH/US/NZ the 1 m COGs are range-readable from the browser **[V]**, so the sweep could read overviews straight from source for the handful of tiles under the aim direction — no hosting at all, at the cost of a COG reader (~15 KB of IFD parsing) and unpredictable latency.

**Recommended stack**: keep Terrarium as the global floor; add **self-hosted Copernicus GLO-30 Terrarium tiles** to fix the 30 m-but-bad regions (GLO-30 is genuinely better than EU-DEM/SRTM and its licence is clean, but it must be re-hosted because the AWS bucket has no CORS **[V]**); add **per-region z16 Terrarium packs re-tiled from national 1 m DEMs** for the marquee mountains. Avoid MapTiler/Mapbox/Cesium (caching terms + non-commercial free tiers) and FABDEM/TanDEM-X EDEM (NC licences).
