import { withNumberDigits } from '@core/geo/coords';
import type { LngLat } from '@core/geo/geodesy';
import { searchGazetteer } from './gazetteer';

export interface GeocodeHit extends LngLat {
  name: string;
  detail: string;
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: Record<string, string | undefined>;
}

const PHOTON_TIMEOUT_MS = 4000;

async function photon(query: string, signal?: AbortSignal): Promise<GeocodeHit[]> {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=7&lang=en`;
  const timeout = AbortSignal.timeout(PHOTON_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!res.ok) return [];
    const json = (await res.json()) as { features: PhotonFeature[] };
    return json.features.map((f) => {
      const p = f.properties;
      const detail = [p.street, p.city ?? p.county, p.state, p.country].filter((x) => x && x !== p.name).join(', ');
      return withNumberDigits({ name: p.name ?? p.city ?? p.country ?? 'Unnamed', detail, lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] });
    });
  } catch {
    return [];
  }
}

/** Place search via Photon (komoot), falling back to the bundled offline gazetteer. Never throws. */
export async function geocode(query: string, signal?: AbortSignal): Promise<GeocodeHit[]> {
  if (navigator.onLine !== false) {
    const hits = await photon(query, signal);
    if (hits.length > 0) return hits;
  }
  if (signal?.aborted) return [];
  return searchGazetteer(query);
}
