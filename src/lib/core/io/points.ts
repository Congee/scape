import type { Feature, FeatureCollection, Point } from 'geojson';
import { numberDigits } from '@core/geo/coords';
import type { Digits } from '@core/geo/geodesy';
import { MarkerCategory, MarkerShape, type SavedMarker } from '@core/plan';

/** A point read from or written to an interchange file; everything but the position is optional. */
export interface PointRecord {
  name: string;
  lat: number;
  lng: number;
  digits?: Digits;
  notes?: string;
  category?: MarkerCategory;
  heightM?: number;
  widthM?: number;
  shape?: MarkerShape;
  depthM?: number;
  rotationDeg?: number;
  rating?: number;
  showInViewfinder?: boolean;
}

export interface MarkerProps {
  name: string;
  category: MarkerCategory;
  heightM: number;
  widthM: number;
  shape?: MarkerShape;
  depthM?: number;
  rotationDeg?: number;
  rating: number;
  notes: string;
  showInViewfinder: boolean;
}

const CATEGORIES = new Set<string>(Object.values(MarkerCategory));

export function categoryFrom(v: unknown): MarkerCategory | undefined {
  if (typeof v !== 'string') return undefined;
  const hit = [...CATEGORIES].find((c) => c.toLowerCase() === v.trim().toLowerCase());
  return hit as MarkerCategory | undefined;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export function markersToGeoJson(markers: SavedMarker[]): FeatureCollection<Point, MarkerProps> {
  return {
    type: 'FeatureCollection',
    features: markers.map((m) => ({
      type: 'Feature',
      id: m.id,
      properties: { name: m.name, category: m.category, heightM: m.heightM, widthM: m.widthM, shape: m.shape, depthM: m.depthM, rotationDeg: m.rotationDeg, rating: m.rating, notes: m.notes, showInViewfinder: m.showInViewfinder },
      geometry: { type: 'Point', coordinates: [m.lng, m.lat] }
    }))
  };
}

function recordFromProps(lng: number, lat: number, props: Record<string, unknown> | null | undefined, fallbackName: string): PointRecord {
  const p = props ?? {};
  const r: PointRecord = { name: str(p.name) ?? str(p.Name) ?? str(p.title) ?? fallbackName, lat, lng, digits: { lat: numberDigits(lat), lng: numberDigits(lng) } };
  const notes = str(p.notes) ?? str(p.description) ?? str(p.desc);
  if (notes) r.notes = notes;
  const cat = categoryFrom(p.category) ?? categoryFrom(p.type);
  if (cat) r.category = cat;
  for (const k of ['heightM', 'widthM', 'depthM', 'rotationDeg', 'rating'] as const) {
    const v = num(p[k]);
    if (v !== undefined) r[k] = v;
  }
  if (typeof p.shape === 'string' && (Object.values(MarkerShape) as string[]).includes(p.shape)) r.shape = p.shape as MarkerShape;
  if (typeof p.showInViewfinder === 'boolean') r.showInViewfinder = p.showInViewfinder;
  return r;
}

/** Point features from any GeoJSON value; other geometries are skipped. */
export function pointsFromGeoJson(v: unknown): PointRecord[] {
  const out: PointRecord[] = [];
  const visit = (g: unknown, i: number) => {
    const o = g as { type?: string; features?: unknown[]; geometry?: unknown; properties?: Record<string, unknown>; coordinates?: unknown };
    if (!o || typeof o !== 'object') return;
    if (o.type === 'FeatureCollection' && Array.isArray(o.features)) {
      o.features.forEach((f, j) => visit(f, j));
    } else if (o.type === 'Feature') {
      const geom = o.geometry as { type?: string; coordinates?: unknown } | null;
      if (geom?.type === 'Point' && Array.isArray(geom.coordinates)) {
        const [lng, lat] = geom.coordinates as number[];
        if (Number.isFinite(lng) && Number.isFinite(lat)) out.push(recordFromProps(lng, lat, o.properties, `Point ${i + 1}`));
      }
    } else if (o.type === 'Point' && Array.isArray(o.coordinates)) {
      const [lng, lat] = o.coordinates as number[];
      if (Number.isFinite(lng) && Number.isFinite(lat)) out.push(recordFromProps(lng, lat, null, `Point ${i + 1}`));
    }
  };
  visit(v, 0);
  return out;
}

export function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
}

export function markersToKml(markers: SavedMarker[]): string {
  const placemarks = markers
    .map((m) => {
      const data = [
        ['category', m.category],
        ['heightM', String(m.heightM)],
        ['widthM', String(m.widthM)],
        ['rating', String(m.rating)],
        ['showInViewfinder', String(m.showInViewfinder)]
      ]
        .map(([k, v]) => `<Data name="${k}"><value>${escapeXml(v)}</value></Data>`)
        .join('');
      return `<Placemark><name>${escapeXml(m.name)}</name>${m.notes ? `<description>${escapeXml(m.notes)}</description>` : ''}<ExtendedData>${data}</ExtendedData><Point><coordinates>${m.lng},${m.lat},0</coordinates></Point></Placemark>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Scape markers</name>\n${placemarks}\n</Document></kml>\n`;
}

export function markersToGpx(markers: SavedMarker[]): string {
  const wpts = markers
    .map(
      (m) =>
        `<wpt lat="${m.lat}" lon="${m.lng}"><name>${escapeXml(m.name)}</name>${m.notes ? `<desc>${escapeXml(m.notes)}</desc>` : ''}<type>${escapeXml(m.category)}</type></wpt>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Scape" xmlns="http://www.topografix.com/GPX/1/1">\n${wpts}\n</gpx>\n`;
}

export type MarkerFeature = Feature<Point, MarkerProps>;
