import { describe, expect, it } from 'vitest';
import { isUrban, ParkingService, parkingServices, parkingUrl, PlaceClass, placeClass, servicesAt } from './parking';

const manhattan = { lat: 40.758, lng: -73.9855 };
const ruralSD = { lat: 44.37, lng: -98.85 };
const rotterdam = { lat: 51.9225, lng: 4.4792 };
const montreal = { lat: 45.5019, lng: -73.5674 };

describe('servicesAt', () => {
  it('covers Manhattan with both', () => expect(servicesAt(manhattan)).toEqual([ParkingService.SpotHero, ParkingService.SpotAngels]));
  it('covers nothing in rural South Dakota', () => expect(servicesAt(ruralSD)).toEqual([]));
  it('covers nothing in Rotterdam', () => expect(servicesAt(rotterdam)).toEqual([]));
  it('covers Montreal with SpotAngels only', () => expect(servicesAt(montreal)).toEqual([ParkingService.SpotAngels]));
});

describe('placeClass', () => {
  it('reads OpenMapTiles classes', () => {
    expect(placeClass('place', { class: 'city' })).toBe(PlaceClass.City);
    expect(placeClass('place', { class: 'town' })).toBe(PlaceClass.Town);
    expect(placeClass('place', { class: 'suburb' })).toBe(PlaceClass.Neighbourhood);
    expect(placeClass('place', { class: 'village' })).toBeNull();
    expect(placeClass('place', { class: 'state' })).toBeNull();
  });
  it('reads Protomaps kinds', () => {
    expect(placeClass('places', { kind: 'locality', kind_detail: 'city' })).toBe(PlaceClass.City);
    expect(placeClass('places', { kind: 'locality', kind_detail: 'hamlet' })).toBeNull();
    expect(placeClass('places', { kind: 'neighbourhood' })).toBe(PlaceClass.Neighbourhood);
    expect(placeClass('places', { kind: 'region' })).toBeNull();
  });
  it('ignores other layers', () => expect(placeClass('landuse', { class: 'city' })).toBeNull());
});

const p = { lat: 40, lng: -100 };
const at = (km: number, cls: PlaceClass) => ({ lat: 40 + km / 111.2, lng: -100, cls });

describe('isUrban', () => {
  it('is urban near a city label', () => expect(isUrban(p, [at(8, PlaceClass.City)])).toBe(true));
  it('scales reach by class', () => {
    expect(isUrban(p, [at(8, PlaceClass.Town)])).toBe(false);
    expect(isUrban(p, [at(3, PlaceClass.Town)])).toBe(true);
    expect(isUrban(p, [at(2, PlaceClass.Neighbourhood)])).toBe(false);
    expect(isUrban(p, [at(1, PlaceClass.Neighbourhood)])).toBe(true);
  });
  it('is rural with no labels', () => expect(isUrban(p, [])).toBe(false));
});

describe('parkingServices', () => {
  it('hides links when the basemap says rural', () => expect(parkingServices(manhattan, false)).toEqual([]));
  it('falls back to coverage when unknown', () => expect(parkingServices(manhattan, null)).toHaveLength(2));
  it('needs coverage even in town', () => expect(parkingServices(rotterdam, true)).toEqual([]));
});

describe('parkingUrl', () => {
  it('centres SpotHero on the spot', () => expect(parkingUrl(ParkingService.SpotHero, manhattan)).toBe('https://spothero.com/search?latitude=40.75800&longitude=-73.98550'));
  it('centres SpotAngels on the spot', () => expect(parkingUrl(ParkingService.SpotAngels, manhattan)).toBe('https://www.spotangels.com/map?lat=40.75800&lng=-73.98550&zoom=16&product=parking'));
});
