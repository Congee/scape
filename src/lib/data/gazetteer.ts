import { withNumberDigits } from '@core/geo/coords';
import { rankCities, type City } from '@core/geo/gazetteer';
import type { GeocodeHit } from './geocode';

type Row = [name: string, lat: number, lng: number, country: string, population: number];

let pending: Promise<City[]> | null = null;

/** Fetched once and kept; a failed fetch is retried on the next search. */
function cities(): Promise<City[]> {
  pending ??= fetch('/gazetteer/cities.json')
    .then((res) => {
      if (!res.ok) throw new Error(`gazetteer ${res.status}`);
      return res.json() as Promise<{ cities: Row[] }>;
    })
    .then((d) => d.cities.map(([name, lat, lng, country, population]) => ({ name, lat, lng, country, population })))
    .catch(() => {
      pending = null;
      return [];
    });
  return pending;
}

let regions: Intl.DisplayNames | null = null;

function countryName(code: string): string {
  try {
    regions ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return regions.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Offline place search against the bundled GeoNames index. Returns [] rather than throwing. */
export async function searchGazetteer(query: string, limit = 8): Promise<GeocodeHit[]> {
  try {
    return rankCities(query, await cities(), limit).map((c) =>
      withNumberDigits({
        name: c.name,
        detail: `${countryName(c.country)} · offline`,
        lat: c.lat,
        lng: c.lng
      })
    );
  } catch {
    return [];
  }
}
