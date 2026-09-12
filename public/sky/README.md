# Bundled sky data

- `stars.bin`, `star-names.json`: 8,920 stars to magnitude 6.5 from the HYG Database v4.1
  (David Nash, https://github.com/astronexus/HYG-Database), licensed CC BY-SA 4.0. These files are a
  derivative of that database and carry the same licence. Built by `scripts/build-sky.ts`.
- `constellations.json`: constellation lines and label positions from d3-celestial (Olaf Frohn,
  https://github.com/ofrohn/d3-celestial), BSD-3-Clause; see `LICENSE.d3-celestial.txt`.
- `milkyway.jpg`: NASA/Goddard Space Flight Center Scientific Visualization Studio, "Deep Star Maps 2020"
  (https://svs.gsfc.nasa.gov/4851), Milky Way layer without stars, equatorial J2000 equirectangular,
  downsampled from the 4k OpenEXR to 2048 × 1024. Public domain. In the image RA 0h is at the centre
  and RA increases to the left; north is up.
