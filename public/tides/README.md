# Bundled tide stations

- `stations.json`: harmonic constituents (amplitude, GMT phase) and MSL−MLLW offset for every NOAA CO-OPS
  harmonic (type R) tide prediction station, from the CO-OPS metadata API
  (https://api.tidesandcurrents.noaa.gov/mdapi/prod/). NOAA data is a US government work in the public domain.
  Built by `scripts/build-tides.ts`; loaded lazily by the Tools and Timeline tabs.
- `subordinate.json`: every NOAA subordinate (type S) station whose reference is in `stations.json`, as its
  reference id and high/low time offsets (minutes) and height offsets (`R` ratio or `F` feet added), from the
  same API's `tidepredoffsets` endpoint. `bun scripts/build-tides.ts --subordinate` rebuilds only this file.
