# GIBS runtime tiles vs the zenith model (2026-09-25)

Layer `VIIRS_SNPP_GapFilled_BRDF_Corrected_DayNightBand_Radiance`, epsg3857 z8 paletted PNG, per-pixel median of N nights
(newest 2026-09-20), bin midpoints, index 180 = saturated at 38.2 nW. `gibs_windows.py` builds them; `calibrate.ts --windows` scores.
Basket: 25 sites from DarkHours `tests/test_darksky_known_sites.py` (MIT), points only, in `basket.ts`.

Note: the current `SKYGLOW_PARAMS` (k 2.528e-5, λ 19) were already fitted on GIBS (epsg4326, 3-night median), not VNP46A4;
`calibrate.ts` on those old windows reproduces them (rms 0.54, Bortle 11/23).

## 23 SQM sites (8 nights, z8)

| method | k, λ | rms mag | Bortle hits |
|---|---|---|---|
| A kernel, current params | 2.528e-5, 19 | 0.56 | 12/23 |
| A kernel, refit | 2.04e-5, 119 | 0.55 | 10/23 |
| A + saturated gain (fit 2.36) | 1.54e-5, 35 | 0.51 | 9/23 |
| B DarkHours local 21.7 − 2.5·log10(L+0.6) | – | 0.92 | 8/23 |
| D hybrid min(A, B) | – | 0.88 | 7/23 |

Residuals (current fit, mag): Mong Kok +2.06, Potsdam −1.21, Vienna −0.47, the rest within ±0.4; pristine sites +0.2…+0.4.
B misreads suburbs by −1.5…−1.9 (Braunau, Grieskirchen, Freistadt, Potsdam): its own pixel ignores dark surroundings.

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

## Verdict

GIBS keeps the model as accurate as before: keep `SKYGLOW_PARAMS`, fetch 8 nights of z8 near + z6 far (~2.5 MB/site).
The saturation gain overfits (better rms, worse basket); not adopted.
