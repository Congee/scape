# Bundled place index

- `cities.json`: every populated place above 5,000 people from the GeoNames `cities5000` dump
  (https://download.geonames.org/export/dump/), licensed CC BY 4.0
  (https://creativecommons.org/licenses/by/4.0/). This file is a derivative of that dump — name,
  coordinates, country code and population only, sorted by population — and carries the same licence.
  Built by `scripts/build-gazetteer.ts`. It backs offline place search when Photon is unreachable.
