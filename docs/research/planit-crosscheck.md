# PlanIt Pro 10.7.29 cross-check

Scape's astronomy and viewfinder output compared against PlanIt Pro 10.7.29 for one
scene. Source readings and screenshots were transcribed from the app directly.

## Scene

| | |
|---|---|
| Camera | 40.747952, −74.023685 (Castle Point, Hoboken NJ), 1.5 m / 4.92 ft above ground |
| Target | Edge / 30 Hudson Yards, 40.753918, −74.000996; ground 19.92 ft, height 1279.57 ft, width 740.86 ft, roof ≈ 1309.6 ft AMSL |
| Geometry | 1.26 mi at az 70.9° to the marker; PlanIt's own scene point is the roof at 1.31 mi, az 71.8°, +10.7° |
| Date / zone | 2026-10-26, America/New_York (EDT, UTC−4) |
| Instants | 7:01:25 PM (23:01:25 UTC) and 6:17:08 PM (22:17:08 UTC) |
| Camera | full frame 36 × 24 mm, 400 mm, f/8, landscape |

## Conventions found

| convention | PlanIt | Scape |
|---|---|---|
| Altitude above the horizon | refracted | refracted (`apparentAltitude`) |
| Altitude below the horizon | geometric | geometric below −0.833° |
| Sun rise/set | upper limb, −0.833° | same (`SearchRiseSet`) |
| **Moon rise/set** | **centre at apparent altitude 0°** | **upper limb** (`SearchRiseSet`) |
| Blue hour | sun geometric −4° … −8° | same range in `SkyFilter.BlueHour`; **no event kind** |
| Golden hour | sun −0.833° … +6° | same (`goldenAltitude: 6`) |
| Night | sun below −18° | `EventKind.AstroDusk` / `AstroDawn` |
| Observer AGL in rise/set | not applied | applied (`heightAboveGroundM` dips the horizon) |
| CoC | 2 × pixel pitch when "large prints" is on: √(36·24/45e6) = 0.00438 mm → 0.0088 mm | — |
| Finder sun-altitude column | refracted even below the horizon (≈ Sæmundsson, clamped ≥ 0 below ≈ −5.1°) | geometric below the horizon |

The last row is an internal PlanIt inconsistency: its twilight *thresholds* and its
Sun & Moon Position page are geometric, but the finder's Sun Altitude column is not.

## Instantaneous positions

"Reference" is astronomy-engine evaluated independently (`Equator` + `Horizon(…, '')`,
plus `Refraction('normal', alt)` above the horizon).

### 7:01:25 PM EDT

| quantity | PlanIt | Scape | reference | verdict |
|---|---|---|---|---|
| Sun alt / az | −12.3° / 263.7° | −12.26 / 263.71 | −12.26 / 263.71 | agree |
| Moon alt / az | +10.0° / 71.9° | +9.99 / 71.90 | +9.99 / 71.90 | agree |
| Moon illumination | 99.2 % | 98.98 % | 98.98 % | **PlanIt high by 0.22 pp** |
| Galactic Centre alt / az | +11.0° / 215.2° | +11.16 / 214.79 | of date 11.16 / 214.79; **J2000 raw 10.99 / 215.13** | **PlanIt does not precess** |

### 6:17:08 PM EDT

| quantity | PlanIt | Scape | reference | verdict |
|---|---|---|---|---|
| Sun alt / az | −4.0° / 256.7° | −4.00 / 256.68 | −4.00 / 256.68 | agree |
| Moon alt / az | +2.5° / 65.4° | +2.54 / 65.41 | +2.54 / 65.41 | agree |
| Moon illumination | 99.2 % | 99.04 % | 99.04 % | PlanIt high by 0.16 pp |
| Galactic Centre alt / az | +15.3° / 206.2° | +15.39 / 205.83 | of date 15.39 / 205.83; **J2000 raw 15.26 / 206.19** | **PlanIt does not precess** |
| Polaris alt / az | +40.6° / 0.9° | +40.54 / 0.76 | of date 40.54 / 0.76; **J2000 raw 40.61 / 0.95** | **PlanIt does not precess** |

**The J2000 hypothesis is confirmed.** Feeding Sgr A* (RA 17.76112 h, Dec −29.00781°)
and Polaris (RA 2.530301 h, Dec +89.264109°) straight into `Horizon` without precessing
to the date reproduces PlanIt's azimuths to **0.01°** at both instants, where the
of-date values differ by 0.14–0.41°. Scape precesses (`Equator(..., ofdate, topocentric)`)
and is correct; PlanIt is 26 years of precession behind.

## Day events, 2026-10-26

Scape run with `heightAboveGroundM: 1.5`, `goldenAltitude: 6`. PlanIt truncates to the minute.

| event | PlanIt | Scape | verdict |
|---|---|---|---|
| Astronomical dawn | 5:47 AM | 5:47:40 | agree |
| Nautical dawn | 6:19 AM | 6:19:27 | agree |
| Blue hour morning | 6:40 – 7:02 AM | *(no event kind)* | **Scape gap** |
| Civil dawn | 6:51 AM | 6:51:33 | agree |
| Sunrise | 7:19 AM, az 105.9° | 7:19:24, az 105.86 | agree |
| Golden hour ends | 7:57 AM | 7:57:52 | agree |
| Moonset | 9:12 AM (10/27), az 301.1° | 9:14:56, az 301.39 | **convention** |
| Sun transit | — | 12:40:02 | — |
| Golden hour begins | 5:22 PM | 5:21:40 | agree (PlanIt rounds up) |
| Moonrise | 6:00 PM, az 62.8° | 5:58:07, az 62.51 | **convention** |
| Sunset | 5:59 PM, az 253.9° | 6:00:07, az 253.94 | **AGL dip**, see below |
| Blue hour evening | 6:17 – 6:38 PM | *(no event kind)* | **Scape gap** |
| Civil dusk | 6:27 PM | 6:27:57 | agree |
| Nautical dusk | 7:00 PM | 7:00:00 | agree |
| Astronomical dusk | 7:31 PM | 7:31:45 | agree |

### Moon rise/set is a definition difference, confirmed numerically

Bisecting the moon's **centre apparent altitude** to zero gives:

| event | centre-apparent-0 crossing | azimuth | PlanIt |
|---|---|---|---|
| Moonrise | 5:59:59 PM | 62.802° | 6:00 PM, 62.8° |
| Moonset | 9:12:56 AM (10/27) | 301.071° | 9:12 AM, 301.1° |

Both reproduce PlanIt to the second and to 0.03° in azimuth. PlanIt uses the moon's
**centre at apparent altitude 0**; Scape's `SearchRiseSet` uses the **upper limb**
(centre at ≈ −0.57°). Neither is wrong; Scape should keep its choice deliberately.

### Sunset differs only because of the observer height

Scape's 6:00:07 PM vs PlanIt's 5:59 PM is the 1.5 m eye height dipping the horizon by
≈ 0.039°, worth ≈ 15 s. Without the dip Scape lands at 5:59:52, matching PlanIt.
Sunrise shifts the same 14 s the other way but stays inside the 7:19 minute.
PlanIt does not apply an AGL dip to sun rise/set even though its camera is at 4.92 ft.

## Sun/Moon Finder — moon, az 70–74°, alt 8–12°, 2026-10-26 → 2027-10-26

PlanIt query: Moonrise, altitude +10.0° ± 2.0, azimuth 72.0° ± 2.0. Both apps return
**36 results**, but they are not the same 36: each has one the other lacks.

Scape times are the **start of the stay** inside the window. Tolerances: time to the
minute, az/alt 0.1°, illumination 0.3 pp, sun altitude 0.2°.

| # | PlanIt date & time | Scape start | alt P/S | az P/S | moon % P/S | sun alt P/S |
|---|---|---|---|---|---|---|
| 1 | 10/26/2026 18:49 | 18:49:56 | 8.0 / 8.00 | 70.2 / 70.24 | 99.2 / 98.99 | −10.1 / −10.11 |
| — | *(absent)* | **11/01/2026 00:06:56** | — / 10.37 | — / 70.00 | — / 57.82 | — / −62.72 |
| 2 | 11/22/2026 15:42 | 15:42:38 | 8.0 / 8.00 | 73.7 / 73.69 | 95.6 / 95.46 | +7.5 / +7.49 |
| 3 | 11/23/2026 16:41 | 16:41:02 | 11.2 / 11.23 | 70.0 / 70.00 | 99.2 / 99.06 | −1.6 / **−2.30** |
| 4 | 11/28/2026 21:53 | 21:53:27 | 8.0 / 8.00 | 72.3 / 72.33 | 73.5 / 73.21 | −59.7 / −59.66 |
| 5 | 12/20/2026 14:11 | 14:11:05 | 8.0 / 8.00 | 70.3 / 70.31 | 85.1 / 84.95 | +18.4 / +18.38 |
| 6 | 12/25/2026 19:33 | 19:33:54 | 8.7 / 8.68 | 70.0 / 70.00 | 94.4 / 94.21 | −33.1 / −33.09 |
| 7 | 01/16/2027 12:06 | 12:06:23 | 8.0 / 8.00 | 72.9 / 72.95 | 59.4 / 59.32 | +28.4 / +28.40 |
| 8 | 01/17/2027 13:04 | 13:04:40 | 11.5 / 11.55 | 70.0 / 70.00 | 70.5 / 70.37 | +27.1 / +27.12 |
| 9 | 01/22/2027 18:17 | 18:17:00 | 8.0 / 8.00 | 72.6 / 72.58 | 99.7 / 99.67 | −14.3 / −14.33 |
| 10 | 02/13/2027 10:49 | 10:49:25 | 9.3 / 9.32 | 70.0 / 70.00 | 42.7 / 42.75 | +32.8 / +32.84 |
| 11 | 02/18/2027 15:54 | 15:54:20 | 9.2 / 9.23 | 70.0 / 70.00 | 93.8 / 93.69 | +16.6 / +16.57 |
| 12 | 03/12/2027 08:43 | 08:43:57 | 8.0 / 8.00 | 70.7 / 70.73 | 18.1 / 18.21 | +26.4 / +26.40 |
| 13 | 03/17/2027 14:51 | 14:51:18 | 11.9 / 11.85 | 70.0 / 70.00 | 73.4 / 73.37 | +41.5 / +41.53 |
| 14 | 03/18/2027 15:43 | 15:43:04 | 8.0 / 8.00 | 72.8 / 72.85 | 83.4 / 83.28 | +35.0 / +35.01 |
| 15 | 04/08/2027 07:45 | 07:45:04 | 8.0 / 8.00 | 73.0 / 73.04 | 2.7 / 2.84 | +13.7 / +13.67 |
| 16 | 04/09/2027 08:41 | 08:41:56 | 11.3 / 11.31 | 70.0 / 70.00 | 7.7 / 7.82 | +24.6 / +24.63 |
| 17 | 04/14/2027 13:31 | 13:31:45 | 8.0 / 8.00 | 70.9 / 70.87 | 58.9 / 58.94 | +57.8 / +57.81 |
| 18 | 05/06/2027 06:21 | 06:21:16 | 8.5 / 8.51 | 70.0 / 70.00 | 0.0 / 0.19 | +5.1 / +5.11 |
| 19 | 05/11/2027 11:27 | 11:27:19 | 8.7 / 8.75 | 70.0 / 70.00 | 32.5 / 32.63 | +60.8 / +60.77 |
| 20 | 06/02/2027 04:11 | 04:11:55 | 8.0 / 8.00 | 72.4 / 72.39 | 8.2 / 8.37 | −12.1 / −12.10 |
| 21 | 06/03/2027 05:14 | 05:14:30 | 11.9 / 11.88 | 70.0 / 70.00 | 2.9 / 3.06 | −2.1 / **−2.74** |
| 22 | 06/07/2027 09:24 | 09:24:45 | 10.9 / 10.91 | 70.0 / 70.00 | 10.6 / 10.66 | +42.6 / +42.65 |
| 23 | 06/08/2027 10:23 | 10:23:26 | 8.0 / 8.00 | 73.8 / 73.79 | 19.4 / 19.48 | +53.5 / +53.54 |
| 24 | 06/30/2027 02:48 | 02:48:32 | 9.0 / 9.02 | 70.0 / 70.00 | 19.7 / 19.73 | −21.3 / −21.25 |
| 25 | 07/05/2027 08:00 | 08:00:31 | 8.0 / 8.00 | 70.8 / 70.76 | 2.8 / 2.87 | +25.7 / +25.69 |
| 26 | 07/27/2027 00:38 | 00:38:44 | 8.0 / 8.00 | 71.4 / 71.42 | 45.1 / 44.96 | −29.7 / −29.73 |
| 27 | 08/01/2027 05:48 | 05:48:00 | 10.8 / 10.81 | 70.0 / 70.00 | 1.6 / 1.59 | −0.9 / **−1.61** |
| 28 | 08/22/2027 22:40 | 22:40:13 | 8.0 / 8.00 | 73.5 / 73.46 | 70.7 / 70.65 | −28.7 / −28.67 |
| 29 | 08/23/2027 23:29 | 23:29:26 | 10.5 / 10.45 | 70.0 / 70.00 | 60.5 / 60.37 | −34.1 / −34.12 |
| 30 | 08/29/2027 04:21 | 04:21:54 | 8.0 / 8.00 | 70.6 / 70.58 | 8.4 / 8.36 | −21.2 / −21.23 |
| 31 | 09/19/2027 21:19 | 21:19:29 | 8.4 / 8.42 | 70.0 / 70.00 | 83.6 / 83.50 | −26.5 / −26.51 |
| 32 | 09/25/2027 02:14 | 02:14:43 | 10.0 / 10.02 | 70.0 / 70.00 | 29.8 / 29.78 | −45.5 / −45.46 |
| 33 | 10/16/2027 19:18 | 19:18:29 | 8.0 / 8.00 | 71.6 / 71.62 | 97.9 / 97.68 | −12.9 / −12.88 |
| 34 | **10/17/2027 20:20** | *(absent)* | 12.0 / — | 70.0 / — | 93.5 / — | −24.9 / — |
| 35 | 10/22/2027 00:14 | 00:14:01 | 11.5 / 11.52 | 70.0 / 70.00 | 56.4 / 56.39 | −59.6 / −59.63 |
| 36 | 10/23/2027 01:05 | 01:05:10 | 8.0 / 8.00 | 72.6 / 72.56 | 44.6 / 44.62 | −60.1 / −60.07 |

**All 34 shared rows agree to the minute**, to ≤ 0.05° in altitude, ≤ 0.05° in azimuth
and ≤ 0.29 pp in illumination. Three sun-altitude cells differ by 0.64–0.71°; all three
have the sun between −3° and 0°, and PlanIt's value equals geometric + refraction to
0.06°. That is the finder-column convention noted above, not an error in either app.

### Row 34 is a PlanIt false positive

At 2027-10-17 20:20 EDT the rising moon crosses **alt 12.0° at +35 s (az 69.96°)** and
crosses **az 70.0° at +53 s (alt 12.06°)**. It leaves the altitude band 18 s *before*
entering the azimuth window, so it is never inside both at once. PlanIt lists it with
values snapped exactly to the box corner (+12.0°, 70.0°) — the signature of testing the
two constraints independently instead of jointly. **Scape is right to omit it.**

### The 11/01/2026 pass is a PlanIt miss

From 00:06:56 to 00:16:33 EDT the moon is demonstrably inside the box (az 70.0 → 71.2,
alt 10.4 → 12.0), a 9.6-minute stay — longer than several passes PlanIt *does* list
(row 13 lasts 52 s, row 23 lasts 81 s), so it is not a duration floor. 2026-11-01 is the
US DST fall-back date, the only such date inside the range; that is the likeliest cause
but is not proven. **Scape is right to include it.**

## Viewfinder

Scape aimed manually at az 71.45°, elev +9.85° to match PlanIt's frame, with a Box
marker (390 m tall, 226 m wide, 100 m deep, rotated 29°) at the target.

| quantity | PlanIt | Scape | note |
|---|---|---|---|
| Frame span | 5.19° × 3.47° | 5.2° × 3.4° | both 2·atan(18/400), 2·atan(12/400) |
| Frame azimuth | 68.8° – 74.1° | 68.8° – 74.1° | agree |
| Frame elevation | +8.13° – +11.59° | +8.1° – +11.6° | agree |
| Header sun | −12.3° / 263.7° | −12.26° / 263.71° | agree |
| Header moon | +10.0° / 71.9°, 99.2 % | +9.99° / 71.90°, 99.0 % | agree; illumination differs (above) |
| Header GC | +11.0° / 215.2° | +11.16° / 214.79° | PlanIt not precessed |
| Target azimuth | 70.9° (marker) | 70.85° | agree |
| Moon in frame | yes, just right of the deck | yes, same place | agree |

### Height ruler

PlanIt's left ruler is `ground(19.92 ft) + D·tanθ` with D ≈ 6835 ft (1.294 mi) — its
scene point, ~60 m east of the marker. Scape's is `heightAtAngle(eyeM, D, θ)` =
`eyeM + D·tanθ + curvature`, with D = 2023 m (1.257 mi) to the marker.

| elevation | PlanIt ft | Scape ft |
|---|---|---|
| +8.5° | 1040.03 | 1006.80 |
| +9.0° | 1102.36 | 1066.10 |
| +9.5° | 1161.42 † | 1125.56 |
| +10.0° | 1223.75 | 1185.19 |
| +10.5° | 1286.09 | 1245.01 |
| +11.0° | 1348.43 | 1305.02 |
| +11.5° | 1410.76 | 1365.23 |

† breaks PlanIt's own uniform 62.33 ft per half-degree; likely a transcription slip.

Both rulers are **heights above sea level**. The 33–46 ft gap is entirely the 1.257 vs
1.294 mi distance (ratio 1.029, matching the slope ratio 123.0/119.7 ft per degree) plus
the ~5 ft datum offset between PlanIt's target-ground zero and Scape's camera-eye zero.
Scape additionally corrects for earth curvature, which PlanIt does not. Not a defect.

## PlanIt deviations

1. **No precession.** Galactic Centre and Polaris azimuths are computed from J2000
   coordinates fed straight into the horizontal transform: GC az +0.37° to +0.41° and
   Polaris az +0.14° off the of-date values, reproduced to 0.01° by the J2000-raw model.
2. **Moon illumination** reads 99.2 % where the true value is 98.98–99.04 % (+0.16 to
   +0.22 pp); possibly held from the full-moon instant, 2026-10-26 04:12:16 UTC.
3. **Finder corner false positive** (row 34): az and alt constraints tested
   independently, so a track that grazes the corner is reported with snapped values.
4. **Finder missed pass** (2026-11-01 00:06:56), a 9.6-minute stay on the DST fall-back date.
5. **Mixed altitude conventions**: geometric for twilight thresholds and the position
   page, refracted (even below the horizon) for the finder's Sun Altitude column.
6. **No AGL dip** on sun rise/set despite a stated 4.92 ft camera height.
7. **Milky Way Seeker** matches fixed compositions only; it takes no az/alt window.

## Scape gaps

1. **No blue hour.** `EventKind` has no blue-hour boundary even though
   `SkyFilter.BlueHour` already encodes PlanIt's −4° … −8° range. Not added here.
2. **Moon rise/set uses the upper limb**, PlanIt the centre — a ~2–3 minute difference.
   Deliberate, but worth surfacing in the UI.
3. ~~Moon disc drawn at a fixed mean semidiameter~~ — fixed, see below.
4. ~~Moon terminator inverted~~ — fixed, see below.

## Fixes made

| fix | file |
|---|---|
| **Moon terminator was inverted**: the canvas `anticlockwise` flag on the terminator ellipse used `(lit < 0.5) === (litSide < 0)` instead of `(lit > 0.5) === …`, so a 98.98 % moon painted a 0.75 % crescent and a crescent painted a gibbous. Extracted as `moonTerminator` / `litAreaFraction`. | `src/lib/core/astro/positions.ts`, `src/lib/ui/viewfinder/ViewfinderController.ts` |
| **Moon and sun discs used a fixed mean semidiameter** (0.259° / 0.2667°). On 2026-10-26 the moon's true semidiameter was 0.2724°, so the disc rendered 5 % small at a perigee full moon. New `semidiameterDeg(body, date, obs)` from the topocentric distance. | `src/lib/core/astro/positions.ts`, `src/lib/ui/viewfinder/ViewfinderController.ts` |

`SEMIDIAMETER_DEG` in `terrainEvents.ts` is unchanged: the mean value is fine for
terrain rise/set bracketing, where the ≤ 0.014° difference is far below DEM resolution.
