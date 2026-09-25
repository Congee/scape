# Fog sign calibration (fogcal.ts)

Ground truth: IEM ASOS METARs (NWS/ICAO, public domain), 2025-09-01 … 2026-08-31, 18 stations:
coastal SFO HAF MRY ACV BGR BHB, valley LIML LIPE LIPX FAT SCK MCE POU SWF, dry PHX LAS TUS ELP.
An hour is "fog or mist" when a report within ±30 min has FG, or BR / visibility < 1 km without rain or snow.
Forecast: Open-Meteo historical forecast API, `best_match`, nearest cell. Scored on the hours from sunrise −60 to +90 min
and sunset −90 to +60 min (32 447 station-hours). Fit on even days, checked on odd days.

| rule (fog or mist, odd days)                       | POD | precision | CSI   |
| -------------------------------------------------- | --- | --------- | ----- |
| old: code 45/48, vis < 1 km, spread < 1 °C & low ≥ 50% | 62% | 57%       | 0.421 |
| new: code 45/48, vis < 5 km, spread < 1 °C & low ≥ 80% | 66% | 58%       | 0.448 |
| recall-weighted (F2): vis < 4.5 km, spread < 2.5 °C & low ≥ 50% | 83% | 41% | 0.380 |
| precision-weighted (F0.5): vis < 3.5 km only       | 50% | 71%       | 0.416 |

- The new rule beats the old on both POD and precision; gains are largest in the Hudson and Central valleys (SWF 0.36 → 0.47, FAT 0.59 → 0.69).
- A wind-speed cap never improved the score, so the logic is unchanged. Code 45/48 adds nothing over vis < 5 km under `best_match`
  but is kept for models that serve no visibility.
- Against dense fog only (FG or < 1 km) both rules over-warn (precision 18%); vis < 1 km alone scores CSI 0.33 there.
- SFO scores ~0.05: the model puts marine stratus over the airport cell, but the airport rarely reports fog.

## Mist and fog split (fog.ts now)

Fog: code 45/48 or visibility < 1 km. Mist: visibility 1–5 km, or the spread sign without fog-level visibility.
Each class is scored against its own METAR class (fog: FG or < 1 km; mist: BR or the rest of "fog or mist"). Odd days:

| class, how                                      | POD | precision | CSI   |
| ----------------------------------------------- | --- | --------- | ----- |
| Fog, visibility served                          | 83% | 33%       | 0.310 |
| Mist, visibility served                         | 34% | 45%       | 0.238 |
| Fog, no visibility, spread sign → Mist          | 79% | 34%       | 0.310 |
| Mist, no visibility, spread sign → Mist         | 28% | 43%       | 0.207 |
| Fog, no visibility, spread sign → Fog           | 90% | 19%       | 0.188 |

- Without visibility the spread sign belongs to Mist: as Fog it halves fog precision and leaves Mist empty.
  The no-visibility rows blank best_match visibility, whose code 45/48 may itself lean on it; ECMWF's codes may score lower.
- The union (fog or mist) is unchanged: CSI 0.448. Mist is the weaker class.

Rerun: `bun scripts/weather/fogcal.ts fetch <dir> && bun scripts/weather/fogcal.ts score <dir>` (about 36 requests, 3 s apart).
