import { describe, expect, it } from 'vitest';
import { nearestTideStation, TideKind, type TideStationRef } from './tides';

const harmonic = (id: string, lat: number, lng: number): TideStationRef => ({ kind: TideKind.Harmonic, lat, lng, row: [id, id, lat, lng, 0, []] });
const subordinate = (id: string, lat: number, lng: number): TideStationRef => ({ kind: TideKind.Subordinate, lat, lng, row: [id, id, lat, lng, 'H', 0, 0, 1, 1, 'R'] });

describe('nearestTideStation', () => {
  const battery = harmonic('8518750', 40.7006, -74.0142);
  const hoboken = subordinate('8530645', 40.7417, -74.0267);
  const kamalo = subordinate('1614465', 21.049, -156.877);
  const stations = [battery, hoboken, kamalo];

  it('prefers a closer subordinate station over a farther harmonic one', () => {
    const hit = nearestTideStation(stations, { lat: 40.745, lng: -74.027 });
    expect(hit?.station).toBe(hoboken);
    expect(hit?.distM).toBeLessThan(500);
  });

  it('keeps a harmonic station closer than any subordinate one', () => {
    expect(nearestTideStation(stations, { lat: 40.702, lng: -74.015 })?.station).toBe(battery);
  });

  it('gives a tie to the harmonic station', () => {
    const twin = subordinate('X', battery.lat, battery.lng);
    expect(nearestTideStation([twin, battery], { lat: 40.71, lng: -74.0 })?.station).toBe(battery);
  });

  it('falls back to the nearest subordinate station when no harmonic one is in range', () => {
    expect(nearestTideStation(stations, { lat: 21.05, lng: -156.88 })?.station).toBe(kamalo);
  });

  it('finds nothing when neither kind is in range', () => {
    expect(nearestTideStation(stations, { lat: 39.74, lng: -104.99 })).toBeNull();
  });
});
