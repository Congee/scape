# GIBS runtime tiles vs the zenith model (2026-09-25)

Layer `VIIRS_SNPP_GapFilled_BRDF_Corrected_DayNightBand_Radiance`, epsg3857 z8 paletted PNG, per-pixel median of N nights
(newest 2026-09-20), bin midpoints, index 180 = saturated at 38.2 nW. Ref 91's `sourceValue` reads `[9.8,100)`, a typo for
`[9.8,10)` (its `value`, and the 0.1–0.2 steps around it); both decoders use gibs.ts's table. `gibs_windows.py` builds them; `calibrate.ts --windows` scores.
Basket: 25 sites from DarkHours `tests/test_darksky_known_sites.py` (MIT), points only, in `basket.ts`.

Note: the current `SKYGLOW_PARAMS` (k 2.528e-5, λ 19) were already fitted on GIBS (epsg4326, 3-night median), not VNP46A4;
`calibrate.ts` on those old windows reproduces them (rms 0.54, Bortle 11/23).

## 23 SQM sites (8 nights, z8 ≤ 32 km, z6 beyond)

| method | k, λ | rms mag | Bortle hits |
|---|---|---|---|
| A kernel, current params | 2.528e-5, 19 | 0.56 | 12/23 |
| A kernel, refit | 2.08e-5, 98 | 0.55 | 10/23 |
| A + saturated gain (fit 2.36) | 1.57e-5, 31 | 0.51 | 9/23 |
| B DarkHours local 21.7 − 2.5·log10(L+0.6) | – | 0.92 | 8/23 |
| D hybrid min(A, B) | – | 0.87 | 7/23 |

Residuals (current fit, mag): Mong Kok +2.06, Potsdam −1.21, Vienna −0.47, the rest within ±0.4; pristine sites +0.2…+0.4.
B misreads suburbs by −1.5…−1.9 (Braunau, Grieskirchen, Freistadt, Potsdam): its own pixel ignores dark surroundings.

The ref 91 fix touches ≤ 0.09 % of window pixels and moves current-params predictions by ≤ 0.06 mag (Pasching; basket
≤ 0.04, Torrey), mean 0.006; rms, Bortle and basket scores are unchanged, the refits move by a few % (λ 108 → 98).

## DarkHours basket (class labels, not measurements)

| method | exact | ±1 |
|---|---|---|
| A current params | 6/25 | 20/25 |
| A refit | 6/25 | 19/25 |
| A + saturated gain | 8/25 | 18/25 |
| B local | 13/25 | 22/25 |
| D hybrid min(A current, B) | 11/25 | 24/25 |

A misses are big US cities read as B6–7 (Denver, Phoenix, Boulder) and B2 sites read as B1. C (our kernel on VNP46A4) not run: no
local .h5, and LAADS downloads need an Earthdata login. Falchi / lightpollutionmap would give a measured-ground-truth zenith grid
for a better basket, but need licence decisions; not fetched.

## Cost per site-night (384 km reach)

| tiles | mean | range | MB mean | MB range |
|---|---|---|---|---|
| z8 everywhere | 58–69 | 36–100 | 1.6–1.9 | 0.2–5.3 |
| z8 ≤ 32 km, z6 beyond | 10–11 | 5–15 | 0.3 | 0.05–0.9 |

z6 beyond 32 km changes predictions by ≤ 0.01 mag. Night count (vs 8): 4 nights ≤ 0.17 mag (local pixel up to 0.71, cloud/moon
gaps), 16 nights ≤ 0.07 mag.

## Fewer far nights (z6 beyond 32 km), 2026-09-25

Same 8 nights and tiles; the far field reads k of them spread newest to oldest (`gibsFarNights`: 2 → nights 0, 7; 3 → 0, 4, 7;
4 → 0, 2, 5, 7), the near field all 8. `gibs_windows.py --far-nights k`. Change vs 8 far nights, current params:

| far nights | max Δ mag (SQM / basket) | rms Δ | Bortle flips | SQM rms, hits | tiles per cold point, mean (range) | MB mean (max) |
|---|---|---|---|---|---|---|
| 8 (baseline) | – | – | – | 0.56, 12/23 | 86 (48–120) | 2.50 (3.44) |
| 4 | 0.000 / 0.001 | 0.000 | 0 | 0.56, 12/23 | 52 (32–72) | 1.56 (2.34) |
| 3 | 0.001 / 0.001 | 0.000 | 0 | 0.56, 12/23 | 44 (26–60) | 1.30 (1.99) |
| 2 | 0.001 / 0.001 | 0.000 | 0 | 0.56, 12/23 | 36 (20–50) | 1.04 (1.66) |

Tiles and MB are SQM sites; the basket is similar (77 → 32 tiles). Far pixels do move (2 nights: window radiance +3–7 %), but
at λ 19 km light beyond 32 km weighs too little to show. The refit barely moves (2 nights: k 2.07e-5, λ 98; 3: λ 119, rms 0.55
both); basket scores unchanged. Adopted: 2 far nights, −59 % tiles and bytes per cold point; `SKYGLOW_PARAMS` kept.

## Verdict

GIBS keeps the model as accurate as before: keep `SKYGLOW_PARAMS`, fetch 8 nights of z8 near + 2 of z6 far (~1 MB/site).
The saturation gain overfits (better rms, worse basket); not adopted.
