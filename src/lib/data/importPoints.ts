import { categoryFrom, pointsFromGeoJson, type PointRecord } from '@core/io/points';

const text = (el: Element | null | undefined, tag: string): string | undefined => {
  const t = el?.getElementsByTagNameNS('*', tag)[0]?.textContent?.trim();
  return t || undefined;
};

function pointsFromKml(doc: Document): PointRecord[] {
  const out: PointRecord[] = [];
  const marks = doc.getElementsByTagNameNS('*', 'Placemark');
  for (let i = 0; i < marks.length; i++) {
    const pm = marks[i];
    const coords = pm.getElementsByTagNameNS('*', 'Point')[0]?.getElementsByTagNameNS('*', 'coordinates')[0]?.textContent?.trim();
    if (!coords) continue;
    const [lng, lat] = coords.split(/[,\s]+/).map(Number);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const r: PointRecord = { name: text(pm, 'name') ?? `Placemark ${i + 1}`, lat, lng };
    const desc = text(pm, 'description');
    if (desc) r.notes = desc;
    const data = pm.getElementsByTagNameNS('*', 'Data');
    for (let j = 0; j < data.length; j++) {
      const k = data[j].getAttribute('name');
      const v = text(data[j], 'value');
      if (!k || v === undefined) continue;
      if (k === 'category') r.category = categoryFrom(v);
      else if (k === 'heightM' || k === 'widthM' || k === 'rating') {
        const n = Number(v);
        if (Number.isFinite(n)) r[k] = n;
      } else if (k === 'showInViewfinder') r.showInViewfinder = v === 'true';
    }
    out.push(r);
  }
  return out;
}

function pointsFromGpx(doc: Document): PointRecord[] {
  const out: PointRecord[] = [];
  const wpts = doc.getElementsByTagNameNS('*', 'wpt');
  for (let i = 0; i < wpts.length; i++) {
    const w = wpts[i];
    const lat = Number(w.getAttribute('lat'));
    const lng = Number(w.getAttribute('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const r: PointRecord = { name: text(w, 'name') ?? `Waypoint ${i + 1}`, lat, lng };
    const desc = text(w, 'desc') ?? text(w, 'cmt');
    if (desc) r.notes = desc;
    const cat = categoryFrom(text(w, 'type'));
    if (cat) r.category = cat;
    out.push(r);
  }
  return out;
}

/** Points from a GeoJSON, KML or GPX file's text. Throws with a readable message on garbage. */
export function parsePointsText(content: string, filename: string): PointRecord[] {
  const trimmed = content.trimStart();
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (ext === 'json' || ext === 'geojson' || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const pts = pointsFromGeoJson(JSON.parse(trimmed));
    if (!pts.length) throw new Error('No point features found in the GeoJSON');
    return pts;
  }
  const doc = new DOMParser().parseFromString(content, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Not well-formed XML');
  const root = doc.documentElement.localName.toLowerCase();
  const pts = root === 'gpx' ? pointsFromGpx(doc) : root === 'kml' ? pointsFromKml(doc) : null;
  if (!pts) throw new Error(`Unsupported file: expected GeoJSON, KML or GPX, got <${root}>`);
  if (!pts.length) throw new Error('No points found in the file');
  return pts;
}
