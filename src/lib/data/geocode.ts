import type { LngLat } from '@core/geo/geodesy';

export interface GeocodeHit extends LngLat {
  name: string;
  detail: string;
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: Record<string, string | undefined>;
}

/** Online place search via Photon (komoot). Returns [] when offline or on error. */
export async function geocode(query: string, signal?: AbortSignal): Promise<GeocodeHit[]> {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=7&lang=en`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const json = (await res.json()) as { features: PhotonFeature[] };
    return json.features.map((f) => {
      const p = f.properties;
      const detail = [p.street, p.city ?? p.county, p.state, p.country].filter((x) => x && x !== p.name).join(', ');
      return { name: p.name ?? p.city ?? p.country ?? 'Unnamed', detail, lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
    });
  } catch {
    return [];
  }
}
