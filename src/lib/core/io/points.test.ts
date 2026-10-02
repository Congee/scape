import { describe, expect, it } from 'vitest';
import { MarkerCategory, type SavedMarker } from '@core/plan';
import { categoryFrom, escapeXml, markersToGeoJson, markersToGpx, markersToKml, pointsFromGeoJson } from './points';

const m: SavedMarker = {
  id: 'a',
  name: 'Half <Dome>',
  category: MarkerCategory.Peak,
  lat: 37.7459,
  lng: -119.5332,
  heightM: 0,
  widthM: 300,
  rating: 5,
  notes: 'Granite & light',
  showInViewfinder: true,
  createdAt: 1,
  updatedAt: 2
};

describe('points io', () => {
  it('round-trips markers through GeoJSON', () => {
    const fc = markersToGeoJson([m]);
    expect(fc.features[0].geometry.coordinates).toEqual([-119.5332, 37.7459]);
    const back = pointsFromGeoJson(JSON.parse(JSON.stringify(fc)));
    expect(back).toEqual([{ name: 'Half <Dome>', lat: 37.7459, lng: -119.5332, digits: { lat: 4, lng: 4 }, notes: 'Granite & light', category: 'Peak', heightM: 0, widthM: 300, rating: 5, showInViewfinder: true }]);
  });

  it('reads bare points and foreign property names, skipping lines', () => {
    const pts = pointsFromGeoJson({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { title: 'Cabin', type: 'building' }, geometry: { type: 'Point', coordinates: [10, 20] } },
        { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } },
        { type: 'Feature', properties: null, geometry: { type: 'Point', coordinates: [1, 2] } }
      ]
    });
    expect(pts).toHaveLength(2);
    expect(pts[0]).toMatchObject({ name: 'Cabin', category: MarkerCategory.Building, lat: 20, lng: 10 });
    expect(pts[1].name).toBe('Point 3');
    expect(categoryFrom('nonsense')).toBeUndefined();
  });

  it('writes escaped KML and GPX', () => {
    const kml = markersToKml([m]);
    expect(kml).toContain('<name>Half &lt;Dome&gt;</name>');
    expect(kml).toContain('<coordinates>-119.5332,37.7459,0</coordinates>');
    expect(kml).toContain('<Data name="category"><value>Peak</value></Data>');
    const gpx = markersToGpx([m]);
    expect(gpx).toContain('<wpt lat="37.7459" lon="-119.5332">');
    expect(gpx).toContain('<desc>Granite &amp; light</desc>');
    expect(escapeXml(`a"b'c`)).toBe('a&quot;b&apos;c');
  });
});
