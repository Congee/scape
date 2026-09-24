# Bundled tide stations

- `stations.json`: harmonic constituents (amplitude, GMT phase) and MSL−MLLW offset for every NOAA CO-OPS
  harmonic (type R) tide prediction station, from the CO-OPS metadata API
  (https://api.tidesandcurrents.noaa.gov/mdapi/prod/). NOAA data is a US government work in the public domain.
  Subordinate stations are left out. Built by `scripts/build-tides.ts`; loaded lazily by the Tools tab.
