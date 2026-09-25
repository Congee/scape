/**
 * DarkHours known-site basket: pinned points with a consensus Bortle class; a second check beside the SQM sites.
 * Sites, classes and bases from github.com/mbeher2200/DarkHours tests/test_darksky_known_sites.py (MIT); elevations from Open-Meteo.
 */

export interface BasketSite {
  name: string;
  lat: number;
  lng: number;
  elevM: number;
  /** Consensus Bortle class, 1–9. */
  bortle: number;
  basis: string;
}

export const BASKET: readonly BasketSite[] = [
  { name: 'Big Bend NP, TX', lat: 29.2705, lng: -103.3018, elevM: 1638, bortle: 1, basis: 'DarkSky Park, Gold Tier' },
  { name: 'Cosmic Campground, NM', lat: 33.4794, lng: -108.9214, elevM: 1630, bortle: 1, basis: 'DarkSky Sanctuary' },
  { name: 'Great Basin NP, NV', lat: 38.9833, lng: -114.3, elevM: 3568, bortle: 1, basis: 'DarkSky Park' },
  { name: 'Death Valley NP, CA', lat: 37.01, lng: -117.45, elevM: 656, bortle: 1, basis: 'DarkSky Park, Gold Tier' },
  { name: 'Natural Bridges NM, UT', lat: 37.6083, lng: -110.0137, elevM: 1877, bortle: 2, basis: 'first DarkSky Park (2007)' },
  { name: 'Great Sand Dunes NP, CO', lat: 37.7325, lng: -105.512, elevM: 2487, bortle: 2, basis: 'DarkSky Park' },
  { name: 'Bryce Canyon NP, UT', lat: 37.593, lng: -112.1871, elevM: 2506, bortle: 2, basis: 'DarkSky Park' },
  { name: 'Chaco Culture NHP, NM', lat: 36.0606, lng: -107.9559, elevM: 1885, bortle: 2, basis: 'DarkSky Park' },
  { name: 'Cherry Springs SP, PA', lat: 41.6626, lng: -77.8261, elevM: 690, bortle: 2, basis: 'DarkSky Park, Gold Tier' },
  { name: 'Zion NP, UT', lat: 37.2982, lng: -113.0263, elevM: 1775, bortle: 2, basis: 'DarkSky Park' },
  { name: 'Mont-Megantic, QC', lat: 45.455, lng: -71.152, elevM: 1105, bortle: 2, basis: 'first DarkSky Reserve (2007)' },
  { name: 'Joshua Tree NP, CA', lat: 33.74, lng: -115.815, elevM: 925, bortle: 3, basis: 'DarkSky Park' },
  { name: 'Headlands, MI', lat: 45.7808, lng: -84.7736, elevM: 203, bortle: 3, basis: 'DarkSky Park' },
  { name: 'Acadia NP, ME', lat: 44.329, lng: -68.183, elevM: 0, bortle: 3, basis: 'published classification' },
  { name: 'Cape Cod Ntl Seashore, MA', lat: 41.92, lng: -69.98, elevM: 26, bortle: 3, basis: 'published classification' },
  { name: 'Shenandoah NP, VA', lat: 38.522, lng: -78.437, elevM: 1077, bortle: 4, basis: 'DarkSky Park' },
  { name: 'Sterling Forest SP, NY', lat: 41.19, lng: -74.25, elevM: 295, bortle: 3, basis: 'darksky._dark_threshold docstring' },
  { name: 'Torrey, UT', lat: 38.299, lng: -111.419, elevM: 2085, bortle: 4, basis: 'Capitol Reef DarkSky gateway town' },
  { name: 'Flagstaff, AZ', lat: 35.1983, lng: -111.6513, elevM: 2105, bortle: 6, basis: 'first DarkSky City (2001)' },
  { name: 'Sedona, AZ', lat: 34.8697, lng: -111.761, elevM: 1325, bortle: 7, basis: 'DarkSky Community' },
  { name: 'Boulder, CO', lat: 40.015, lng: -105.2705, elevM: 1625, bortle: 8, basis: 'published classification' },
  { name: 'Tucson, AZ', lat: 32.2226, lng: -110.9747, elevM: 722, bortle: 8, basis: 'published classification' },
  { name: 'Phoenix, AZ', lat: 33.4484, lng: -112.074, elevM: 333, bortle: 9, basis: 'metro core' },
  { name: 'Denver, CO', lat: 39.7392, lng: -104.9903, elevM: 1599, bortle: 9, basis: 'metro core' },
  { name: 'Times Square, NY', lat: 40.758, lng: -73.9855, elevM: 135, bortle: 9, basis: 'metro core' }
];
