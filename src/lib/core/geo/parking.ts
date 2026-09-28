/** Parking deep links for a camera spot: which services cover it, and whether the basemap says it is in town. */

import type { LngLat } from './geodesy';
import { SPOTANGELS_CITIES, SPOTHERO_CITIES, type CityPoint } from './parking.cities';

export const ParkingService = { SpotHero: 'SpotHero', SpotAngels: 'SpotAngels' } as const;
export type ParkingService = (typeof ParkingService)[keyof typeof ParkingService];

/** Settlement classes the basemap's place labels share across OpenMapTiles and Protomaps. */
export const PlaceClass = { City: 'city', Town: 'town', Neighbourhood: 'neighbourhood' } as const;
export type PlaceClass = (typeof PlaceClass)[keyof typeof PlaceClass];

export interface Place extends LngLat {
  cls: PlaceClass;
}

/** Both services list metros by their centre, and a metro reaches this far. */
export const COVERAGE_M = 25_000;

/** How close a label of each class puts the spot in town. */
export const URBAN_M: Record<PlaceClass, number> = { city: 10_000, town: 4_000, neighbourhood: 1_500 };

const CITIES: Record<ParkingService, readonly CityPoint[]> = { SpotHero: SPOTHERO_CITIES, SpotAngels: SPOTANGELS_CITIES };
const D2R = Math.PI / 180;
const R_M = 6_371_009;

/** Equirectangular distance; well within a percent at these ranges. */
function nearM(a: LngLat, lat: number, lng: number): number {
  const dLng = ((((lng - a.lng) % 360) + 540) % 360) - 180;
  const x = dLng * D2R * Math.cos(((a.lat + lat) / 2) * D2R);
  const y = (lat - a.lat) * D2R;
  return Math.hypot(x, y) * R_M;
}

/** Services listing a city within COVERAGE_M of `p`. */
export function servicesAt(p: LngLat): ParkingService[] {
  return Object.values(ParkingService).filter((s) => CITIES[s].some(([lat, lng]) => nearM(p, lat, lng) <= COVERAGE_M));
}

/** Class of a basemap place feature, or null for villages, regions and the like. */
export function placeClass(sourceLayer: string, props: Record<string, unknown>): PlaceClass | null {
  if (sourceLayer === 'place') {
    // OpenMapTiles.
    const c = props.class;
    if (c === 'city' || c === 'town') return c;
    return c === 'suburb' || c === 'quarter' || c === 'neighbourhood' ? PlaceClass.Neighbourhood : null;
  }
  if (sourceLayer === 'places') {
    // Protomaps.
    if (props.kind === 'neighbourhood' || props.kind === 'macrohood') return PlaceClass.Neighbourhood;
    const d = props.kind_detail;
    return props.kind === 'locality' && (d === 'city' || d === 'town') ? d : null;
  }
  return null;
}

/** In town when a city, town or neighbourhood label sits close enough to the spot. */
export function isUrban(p: LngLat, places: readonly Place[]): boolean {
  return places.some((q) => nearM(p, q.lat, q.lng) <= URBAN_M[q.cls]);
}

/** Services to link for `p`; `urban` null means the basemap could not tell, so coverage alone decides. */
export function parkingServices(p: LngLat, urban: boolean | null): ParkingService[] {
  return urban === false ? [] : servicesAt(p);
}

export function parkingUrl(s: ParkingService, p: LngLat): string {
  const lat = p.lat.toFixed(5);
  const lng = p.lng.toFixed(5);
  return s === ParkingService.SpotHero ? `https://spothero.com/search?latitude=${lat}&longitude=${lng}` : `https://www.spotangels.com/map?lat=${lat}&lng=${lng}&zoom=16&product=parking`;
}
